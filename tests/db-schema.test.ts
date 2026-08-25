/**
 * What the Postgres schema PROMISES, asserted against a real Postgres.
 *
 * These are not tests of Postgres. Each one pins a design decision that the
 * plan argues for in prose and that a later "tidy-up" could quietly undo — a
 * composite key collapsed to a single column, a foreign key given a cascade,
 * a check constraint dropped because it was in the way. Prose cannot stop that;
 * a failing test can.
 *
 * See docs/plans/postgres-migration.md and docs/project/supabase-local.md.
 *
 * **These skip when there is no database**, so `npm test` still passes on a
 * fresh clone with no Docker. That is a deliberate trade and it has a cost:
 * skipped tests protect nothing, and a green run here does NOT mean the schema
 * was checked. Run `npm run db:start && npm run db:migrate` before trusting it.
 * The skip is reported loudly for that reason.
 *
 * Every test runs inside a transaction that is rolled back, so the database is
 * left exactly as found and the tests do not care what order they run in.
 */

import { afterAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { loadEnvLocal } from "../src/env.js";

loadEnvLocal();

const url = process.env.DATABASE_URL;

/**
 * The probe runs at MODULE LOAD, not in `beforeAll`, so that the skip is a real
 * vitest skip and the run reports "9 skipped" rather than "9 passed".
 *
 * The first version of this file did it the obvious way — a flag set in
 * `beforeAll`, and every test returning early when it was false. With no
 * database that reported **9 passed**, which is a green tick for having checked
 * nothing at all. See docs/reusable/silent-success.md; this file was one of its
 * examples within about four minutes of being written.
 */
let pool: Pool | undefined;
let reachable = false;

if (url) {
  pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
  try {
    const probe = await pool.query(
      "select to_regclass('spideryarn.block_identities') is not null as ready",
    );
    reachable = probe.rows[0]?.ready === true;
  } catch {
    reachable = false;
  }
}

afterAll(async () => {
  await pool?.end();
});

/**
 * Run `body` inside a transaction and always roll back.
 *
 * The rollback is in a `finally`, so it happens even when an assertion throws —
 * otherwise one failing test would leave rows behind and the next run would
 * fail for a different and much more confusing reason.
 */
async function inRollback(body: (c: PoolClient) => Promise<void>): Promise<void> {
  const client = await pool!.connect();
  try {
    await client.query("begin");
    await body(client);
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}

const OWNER = "11111111-1111-1111-1111-111111111111";
const ART_1 = "aaaaaaaa-0000-0000-0000-000000000001";
const ART_2 = "aaaaaaaa-0000-0000-0000-000000000002";
const REV_1 = "bbbbbbbb-0000-0000-0000-000000000001";

/** Two articles owned by one user, inside the caller's transaction. */
async function seed(c: PoolClient): Promise<void> {
  await c.query(
    `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at)
     values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
             'schema-test@example.invalid','x',now(),now())
     on conflict (id) do nothing`,
    [OWNER],
  );
  await c.query(
    `insert into spideryarn.articles (id, owner_id, slug)
     values ($1,$3,'schema-test-one'), ($2,$3,'schema-test-two')`,
    [ART_1, ART_2, OWNER],
  );
}

async function addBlock(
  c: PoolClient,
  articleId: string,
  revisionId: string,
  blockId: string,
  ordinal: number,
): Promise<void> {
  await c.query(
    `insert into spideryarn.revision_blocks
       (article_id, revision_id, block_id, ordinal, tag, kind, text, words, html, gistable)
     values ($1,$2,$3,$4,'p','text','hello',1,'<p>hello</p>',true)`,
    [articleId, revisionId, blockId, ordinal],
  );
}

/**
 * `it`, genuinely skipped when there is no migrated database.
 *
 * `skipIf` and not an early return: a skipped test is reported as skipped, and
 * a run that checked nothing must never look like a run that passed.
 */
const dbIt = it.skipIf(!reachable);

describe("the schema keeps the promises the plan makes", () => {
  dbIt("the same block id in two different articles is fine", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // The whole reason the primary key is composite. `spya-` ids collide
      // across a library at ~100 articles (postgres-migration.md), and every id
      // is resolved inside one article, so this MUST be allowed.
      await c.query(
        `insert into spideryarn.block_identities (article_id, block_id)
         values ($1,'spya-k3m9qt'), ($2,'spya-k3m9qt')`,
        [ART_1, ART_2],
      );
      const { rows } = await c.query(
        "select count(*)::int as n from spideryarn.block_identities where block_id='spya-k3m9qt'",
      );
      expect(rows[0].n).toBe(2);
    });
  });

  dbIt("a malformed block id is refused", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // `1`, `l`, `o` are not in the alphabet (src/ids.ts) — they are the
      // characters removed precisely because they are misread aloud.
      await expect(
        c.query("insert into spideryarn.block_identities (article_id, block_id) values ($1,$2)", [
          ART_1,
          "spya-1llloo",
        ]),
      ).rejects.toThrow(/block_identities_id_format/);
    });
  });

  dbIt("a block row cannot reference an id that was never minted", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'draft')",
        [REV_1, ART_1],
      );
      // This is what stage 3 re-minting instead of carrying ids forward looks
      // like from the database's side. It is the most expensive silent failure
      // available in this migration, so it must not be silent.
      await expect(addBlock(c, ART_1, REV_1, "spya-zzzzzz", 0)).rejects.toThrow(
        /revision_blocks_identity_fk/,
      );
    });
  });

  dbIt("two blocks cannot share an ordinal in one revision", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'draft')",
        [REV_1, ART_1],
      );
      await c.query(
        `insert into spideryarn.block_identities (article_id, block_id)
         values ($1,'spya-k3m9qt'), ($1,'spya-m4n8rs')`,
        [ART_1],
      );
      await addBlock(c, ART_1, REV_1, "spya-k3m9qt", 0);
      // Document order is data. Ids are random and carry no position, so a
      // duplicated ordinal is unrecoverable rather than merely untidy.
      await expect(addBlock(c, ART_1, REV_1, "spya-m4n8rs", 0)).rejects.toThrow(
        /revision_blocks_revision_ordinal/,
      );
    });
  });

  dbIt("a comment survives its block leaving the article", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'published')",
        [REV_1, ART_1],
      );
      await c.query(
        "insert into spideryarn.block_identities (article_id, block_id) values ($1,'spya-k3m9qt')",
        [ART_1],
      );
      await addBlock(c, ART_1, REV_1, "spya-k3m9qt", 0);
      await c.query(
        `insert into spideryarn.comments
           (article_id, id, owner_id, block_id, quote, start, status)
         values ($1,'c1',$2,'spya-k3m9qt','hello',0,'done')`,
        [ART_1, OWNER],
      );

      // The article is re-extracted and that paragraph does not survive.
      await c.query("delete from spideryarn.revision_blocks where article_id=$1", [ART_1]);

      // src/web/comment-nav.ts: such a comment sorts to the end rather than
      // being dropped, because "it is still the reader's question". An earlier
      // draft of this schema foreign-keyed comments to the current block rows,
      // which would have made that documented behaviour impossible.
      const { rows } = await c.query(
        "select count(*)::int as n from spideryarn.comments where article_id=$1",
        [ART_1],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  dbIt("an article cannot point at another article's revision", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'published')",
        [REV_1, ART_1],
      );
      // The pointer FK is composite for this reason. On the revision id alone
      // it would happily let article two publish article one's text.
      await expect(
        c.query("update spideryarn.articles set current_revision_id=$1 where id=$2", [
          REV_1,
          ART_2,
        ]),
      ).rejects.toThrow(/articles_current_revision_fk/);
    });
  });

  dbIt("there can only ever be one queue_state row", async () => {
    await inRollback(async (c) => {
      // Claiming locks this row before choosing a job, and that is the only
      // thing giving global concurrency 1 — `FOR UPDATE SKIP LOCKED` does not.
      // A second row would mean two workers locking different rows and both
      // proceeding, with nothing anywhere reporting a problem.
      await expect(c.query("insert into spideryarn.queue_state (id) values (2)")).rejects.toThrow(
        /queue_state_singleton/,
      );
    });
  });

  dbIt("the hand-written constraints survived migration", async () => {
    await inRollback(async (c) => {
      // drizzle-kit's snapshot does not know about drizzle/0001_*.sql, so a
      // future generated migration that drops and recreates one of these tables
      // takes these with it and says nothing. This is that alarm.
      const { rows } = await c.query(
        `select conname from pg_constraint
          where connamespace = 'spideryarn'::regnamespace
            and conname in ('articles_owner_fk','comments_owner_fk','jobs_owner_fk',
                            'articles_current_revision_fk')
          order by conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        "articles_current_revision_fk",
        "articles_owner_fk",
        "comments_owner_fk",
        "jobs_owner_fk",
      ]);
    });
  });

  dbIt("spideryarn is not exposed through the Data API", async () => {
    await inRollback(async (c) => {
      // PostgREST reads `[api].schemas` from config.toml, not the catalog, so
      // this asserts the next line of defence: the anon role cannot read the
      // tables even if the schema were exposed by accident.
      const { rows } = await c.query(
        `select has_table_privilege('anon','spideryarn.articles','select') as anon_can_read`,
      );
      expect(rows[0].anon_can_read).toBe(false);
    });
  });
});
