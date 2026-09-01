/**
 * What the Postgres schema PROMISES, asserted against a real Postgres.
 *
 * These are not tests of Postgres. Each one pins a design decision that the
 * plan argues for in prose and that a later "tidy-up" could quietly undo — a
 * composite key collapsed to a single column, a foreign key given a cascade,
 * a check constraint dropped because it was in the way. Prose cannot stop that;
 * a failing test can.
 *
 * See docs/plans/260825f-postgres-migration.md and docs/project/supabase-local.md.
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
import type { PoolClient } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { UPLOAD_STATUSES } from "../src/source.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/**
 * The `await` is at MODULE LOAD, not in `beforeAll`, so that the skip is a real
 * vitest skip and the run reports "9 skipped" rather than "9 passed".
 *
 * The first version of this file did it the obvious way — a flag set in
 * `beforeAll`, and every test returning early when it was false. With no
 * database that reported **9 passed**, which is a green tick for having checked
 * nothing at all. See docs/reusable/silent-success.md; this file was one of its
 * examples within about four minutes of being written.
 *
 * It kept the probe but not the lesson: until the shared helper it was on a
 * **two-second** connect timeout and skipped **silently**. `keepPool` because
 * every test below runs its own SQL through this pool.
 */
const { reachable, pool } = await pgReady({
  suite: "tests/db-schema.test.ts",
  tables: ["spideryarn.block_identities"],
  keepPool: true,
});

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

/**
 * Run one statement expected to fail, without poisoning the transaction.
 *
 * Postgres aborts the whole transaction on any error, so a second expected
 * failure in the same transaction reports "current transaction is aborted"
 * rather than the constraint you were testing — and the assertion fails for a
 * reason that has nothing to do with what it was checking. A savepoint per
 * attempt keeps each one independent.
 */
async function expectViolation(
  c: PoolClient,
  constraint: RegExp,
  run: () => Promise<unknown>,
): Promise<void> {
  await c.query("savepoint attempt");
  await expect(run()).rejects.toThrow(constraint);
  await c.query("rollback to savepoint attempt");
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
      // across a library at ~100 articles (260825f-postgres-migration.md), and every id
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

  dbIt("the queue_state row cannot be deleted", async () => {
    await inRollback(async (c) => {
      // The CHECK stops a SECOND row. Nothing in SQL can stop the row going
      // missing — and that is the dangerous direction: claiming locks
      // queue_state FOR UPDATE, and locking zero rows succeeds silently, so
      // every worker would believe it held the queue. Hence a trigger.
      await expect(c.query("delete from spideryarn.queue_state")).rejects.toThrow(/permanent/);
    });
  });

  /**
   * **The schema no longer says how many jobs may run, and that is the change.**
   *
   * This case asserted that a second `running` insert violated
   * `jobs_only_one_running` — a unique index on the constant `(true)`, which was
   * global concurrency 1 across every owner. A unique index cannot express *at
   * most N*, and N is what the cap became on 2026-08-30
   * (drizzle/0032_jobs_concurrency_cap.sql), so the rule moved out of the schema
   * and into a count taken inside the `queue_state` lock — src/store/pg-jobs.ts
   * § `claim`, pinned by tests/store-jobs-parity.test.ts against both adapters.
   *
   * **So what is left here is the loss, said out loud.** Two running rows are
   * now something the database will accept, and the only thing that stops a
   * third, tenth or hundredth is application code taking a lock it could forget
   * to take. Asserting that the insert *succeeds* is what keeps this file honest
   * about that: a future change that quietly reinstates a schema-level cap would
   * turn this red and have to say why, and nobody reading the table's
   * constraints is left believing a guarantee that is not there.
   */
  dbIt("the schema allows two jobs to run at once — the cap is not in the database", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const running = (id: string) =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, attempt_id, lease_expires_at)
           values ($1,$2,$3,'[]'::jsonb,'running','w',gen_random_uuid(), now() + interval '1 minute')`,
          /* A slug each. `jobs_active_slug` still reserves one per article, so
             two running rows on one slug would be refused by *that* index and
             this would pass while saying nothing about the cap. */
          [id, OWNER, id],
        );
      await running("spya-aaaaaa");
      await expect(running("spya-bbbbbb")).resolves.toBeDefined();
    });
  });

  dbIt("a running job must carry its fencing token", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // A NULL attempt_id fences nothing while looking exactly like one that
      // does: every `where attempt_id = $1` matches no rows, which reads as
      // "someone else got there first" rather than as a bug.
      await expect(
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key)
           values ('spya-cccccc',$1,'s','[]'::jsonb,'running','w')`,
          [OWNER],
        ),
      ).rejects.toThrow(/jobs_running_is_fenced/);
    });
  });

  dbIt("the id CHECK accepts exactly what mintId can produce", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // The regex is ID_PATTERN.source, not a hand-copy. The hand-copied
      // version accepted a leading digit and accepted `1` — three shapes the
      // minter can never emit. A CHECK that is too permissive passes every test
      // written against real ids and admits garbage from everywhere else.
      const rejected = ["spya-2aaaaa", "spya-a1aaaa", "spya-aaaaa1"];
      for (const bad of rejected) {
        await expectViolation(c, /block_identities_id_format/, () =>
          c.query("insert into spideryarn.block_identities (article_id, block_id) values ($1,$2)", [
            ART_1,
            bad,
          ]),
        );
      }
      // `0` IS in the alphabet — dropping `o` is what makes keeping `0` safe.
      await c.query(
        "insert into spideryarn.block_identities (article_id, block_id) values ($1,'spya-a0aaaa')",
        [ART_1],
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
                            'articles_current_revision_fk','reader_profiles_owner_fk',
                            'uploads_owner_fk','feedback_owner_fk')
          order by conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        "articles_current_revision_fk",
        "articles_owner_fk",
        "comments_owner_fk",
        /* drizzle/0040. A bug report must outlive the account that filed it —
           see that migration on why RESTRICT means more here than elsewhere. */
        "feedback_owner_fk",
        "jobs_owner_fk",
        "reader_profiles_owner_fk",
        "uploads_owner_fk",
      ]);
    });
  });

  dbIt("one article cannot have two jobs in flight", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const queued = (id: string, work: string) =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key)
           values ($1,$2,'paper','[]'::jsonb,'queued',$3)`,
          [id, OWNER, work],
        );
      await queued("spya-dddddd", "w1");
      /* Both halves of what this index is for, in one assertion each.
         Same work is the de-duplication: two instances each accept one Add
         click and only one row survives, so the model call is paid for once.
         Different work is the slug reservation: two uploads both called
         `paper.pdf` cannot each choose `paper` and have the second publish into
         the first's article. */
      await expectViolation(c, /jobs_active_slug/, () => queued("spya-eeeeee", "w1"));
      await expectViolation(c, /jobs_active_slug/, () => queued("spya-ffffff", "w2"));
      // A finished job is history and does not hold the slug.
      await c.query("update spideryarn.jobs set status = 'done' where id = 'spya-dddddd'");
      await queued("spya-gggggg", "w1");
    });
  });

  dbIt("a job carries both halves of its upload or neither", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // `upload_id` is ON DELETE SET NULL, so without this a swept upload leaves
      // a filename with no id — a `JobUpload` the TypeScript type cannot express
      // and nothing downstream would think to check for.
      await expectViolation(c, /jobs_upload_both_or_neither/, () =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, upload_filename)
           values ('spya-hhhhhh',$1,'s','[]'::jsonb,'queued','w','paper.pdf')`,
          [OWNER],
        ),
      );
    });
  });

  dbIt("the uploads status CHECK lists exactly the statuses the type has", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /* **The table copied a TypeScript union, and a copy drifts.** A draft of
         this table listed four of the five — it left out `expired` — which would
         have passed every test and every migration and failed at the first
         expiry with a constraint violation nobody could read.

         So the assertion is against `NEXT`'s own keys rather than a list typed
         out again here, which would be a third copy with the same problem. Add a
         sixth status to src/source.ts and this goes red on a laptop. */
      for (const status of UPLOAD_STATUSES) {
        await c.query(
          `insert into spideryarn.uploads
             (id, owner_id, filename, claimed_bytes, claimed_sha256, status,
              grant_expires_at, sha256, bytes, reason)
           values (gen_random_uuid(), $1, 'a.pdf', 10, repeat('a',64), $2,
                   now() + interval '1 hour', repeat('b',64), 10, 'missing')`,
          [OWNER, status],
        );
      }
      await expectViolation(c, /uploads_status/, () =>
        c.query(
          `insert into spideryarn.uploads
             (id, owner_id, filename, claimed_bytes, claimed_sha256, status, grant_expires_at)
           values (gen_random_uuid(), $1, 'a.pdf', 10, repeat('a',64), 'settled', now())`,
          [OWNER],
        ),
      );
    });
  });

  dbIt("a terminal upload has to carry its evidence", async () => {
    await inRollback(async (c) => {
      await seed(c);
      // `verified` with no hash and `rejected` with no reason are states the
      // TypeScript type cannot express and this table could. Now it cannot
      // either — which matters because the hash is the whole difference between
      // a corruption check and a claim about which document we are holding.
      const bad = (status: string, extra: string) =>
        c.query(
          `insert into spideryarn.uploads
             (id, owner_id, filename, claimed_bytes, claimed_sha256, status, grant_expires_at${extra})
           values (gen_random_uuid(), $1, 'a.pdf', 10, repeat('a',64), $2, now() + interval '1 hour')`,
          [OWNER, status],
        );
      await expectViolation(c, /uploads_verified_has_evidence/, () => bad("verified", ""));
      await expectViolation(c, /uploads_rejected_has_reason/, () => bad("rejected", ""));
      // And the shape that must still be accepted, so the two above are not
      // passing because every insert here fails.
      await bad("pending", "");
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

  describe("the reference to a raw source document", () => {
    /**
     * Four constraints, and each one is here because the failure it prevents is
     * silent rather than loud. A revision's raw source is addressed by
     * `canonicalKey(sha, kind)` (src/source.ts), which is rendered into an
     * object name — so a row that is not a digest, or is half a pointer, names
     * an object that cannot exist, and nothing downstream would say so. It
     * would read as "this article has no source document", which is a thing
     * that legitimately happens. docs/plans/260827o-raw-bytes-in-storage.md.
     */
    const SHA = "a".repeat(64);

    dbIt("refuses a hash that is not one", async () => {
      await inRollback(async (c) => {
        await expectViolation(c, /raw_sources_sha256_format/, () =>
          c.query(
            "insert into spideryarn.raw_sources values ($1,'pdf',1,'application/pdf',now())",
            ["not-a-digest"],
          ),
        );
        /* Upper case is the interesting near-miss: a perfectly good SHA-256,
           written the other way, which would render a key that misses. */
        await expectViolation(c, /raw_sources_sha256_format/, () =>
          c.query(
            "insert into spideryarn.raw_sources values ($1,'pdf',1,'application/pdf',now())",
            ["A".repeat(64)],
          ),
        );
      });
    });

    dbIt("refuses a kind that names no decoder", async () => {
      await inRollback(async (c) => {
        await expectViolation(c, /raw_sources_kind/, () =>
          c.query("insert into spideryarn.raw_sources values ($1,'docx',1,'x',now())", [SHA]),
        );
      });
    });

    dbIt("refuses half a pointer", async () => {
      await inRollback(async (c) => {
        await seed(c);
        await c.query(
          "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'draft')",
          [REV_1, ART_1],
        );
        /* Either half alone. Both directions, because a CHECK written as one
           implication rather than an equality would pass one of them. */
        await expectViolation(c, /article_revisions_raw_source_both/, () =>
          c.query("update spideryarn.article_revisions set raw_source_sha256 = $1 where id = $2", [
            SHA,
            REV_1,
          ]),
        );
        await expectViolation(c, /article_revisions_raw_source_both/, () =>
          c.query("update spideryarn.article_revisions set raw_source_kind = 'pdf' where id = $1", [
            REV_1,
          ]),
        );
      });
    });

    dbIt("refuses a pointer to an object it has no record of", async () => {
      await inRollback(async (c) => {
        await seed(c);
        await c.query(
          "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'draft')",
          [REV_1, ART_1],
        );
        await expectViolation(c, /article_revisions_raw_source_fk/, () =>
          c.query(
            "update spideryarn.article_revisions set raw_source_sha256 = $1, raw_source_kind = 'pdf' where id = $2",
            [SHA, REV_1],
          ),
        );
      });
    });

    dbIt("accepts a whole pointer to a registered object", async () => {
      /* The other half, and it is not decoration: four rejections and no
         acceptance is indistinguishable from a constraint that refuses
         everything, which would fail closed and look like rigour. */
      await inRollback(async (c) => {
        await seed(c);
        await c.query(
          "insert into spideryarn.article_revisions (id, article_id, status) values ($1,$2,'draft')",
          [REV_1, ART_1],
        );
        await c.query(
          "insert into spideryarn.raw_sources values ($1,'pdf',1,'application/pdf',now())",
          [SHA],
        );
        await c.query(
          "update spideryarn.article_revisions set raw_source_sha256 = $1, raw_source_kind = 'pdf' where id = $2",
          [SHA, REV_1],
        );
        const back = await c.query(
          "select raw_source_sha256 from spideryarn.article_revisions where id = $1",
          [REV_1],
        );
        expect(back.rows[0].raw_source_sha256).toBe(SHA);
      });
    });

    dbIt("lets two revisions share one source document", async () => {
      /* Dedup is the point of naming an object after its contents: two readers
         with the same paper get one object. Nothing may stop the second
         reference. */
      await inRollback(async (c) => {
        await seed(c);
        await c.query(
          `insert into spideryarn.article_revisions (id, article_id, status)
           values ($1,$2,'draft'), ($3,$4,'draft')`,
          [REV_1, ART_1, "bbbbbbbb-0000-0000-0000-000000000002", ART_2],
        );
        await c.query(
          "insert into spideryarn.raw_sources values ($1,'pdf',1,'application/pdf',now())",
          [SHA],
        );
        /* **`where id = any(...)`, and the first version had no `where` at
           all.** It set the reference on every revision in the database — 12 of
           them on this laptop, from the real corpus — and only the surrounding
           rollback made that harmless. The count then came back 12 and the test
           failed, which is the good luck rather than the design: a test that
           asserted "at least 2" would have passed while writing over
           everything. Scope every write in a test to rows the test made. */
        const MINE = [REV_1, "bbbbbbbb-0000-0000-0000-000000000002"];
        await c.query(
          `update spideryarn.article_revisions
             set raw_source_sha256 = $1, raw_source_kind = 'pdf'
           where id = any($2::uuid[])`,
          [SHA, MINE],
        );
        const n = await c.query(
          `select count(*)::int as n from spideryarn.article_revisions
           where raw_source_sha256 = $1 and id = any($2::uuid[])`,
          [SHA, MINE],
        );
        expect(n.rows[0].n).toBe(2);
      });
    });
  });

});
