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
import { CHECKPOINT_NAMESPACES } from "../src/store/checkpoints.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

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
const { pool } = await pgReady({
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
  await seedAuthUser(c, {
    id: OWNER,
    email: "schema-test@example.invalid",
    onConflictDoNothing: true,
  });
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
describe("the schema keeps the promises the plan makes", () => {
  it("the same block id in two different articles is fine", async () => {
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

  it("a malformed block id is refused", async () => {
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

  it("a block row cannot reference an id that was never minted", async () => {
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

  it("two blocks cannot share an ordinal in one revision", async () => {
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

  it("a comment survives its block leaving the article", async () => {
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

  it("a comment anchor is either a selection pair or a free whole-block bookmark", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        "insert into spideryarn.block_identities (article_id, block_id) values ($1,'spya-k3m9qt')",
        [ART_1],
      );

      /* The new value itself: both nullable columns absent, and `none` says no
         model call was ever attempted. */
      await c.query(
        `insert into spideryarn.comments
           (article_id, id, owner_id, block_id, status)
         values ($1,'whole',$2,'spya-k3m9qt','none')`,
        [ART_1, OWNER],
      );
      const { rows } = await c.query(
        "select quote, start from spideryarn.comments where article_id=$1 and id='whole'",
        [ART_1],
      );
      expect(rows[0]).toEqual({ quote: null, start: null });

      /* Each half is refused independently. Otherwise one direction could be
         wired correctly while the other still admitted a mark that cannot be
         resolved. */
      await expectViolation(c, /comments_anchor_pair/, () =>
        c.query(
          `insert into spideryarn.comments
             (article_id, id, owner_id, block_id, quote, status)
           values ($1,'half-quote',$2,'spya-k3m9qt','hello','none')`,
          [ART_1, OWNER],
        ),
      );
      await expectViolation(c, /comments_anchor_pair/, () =>
        c.query(
          `insert into spideryarn.comments
             (article_id, id, owner_id, block_id, start, status)
           values ($1,'half-start',$2,'spya-k3m9qt',0,'none')`,
          [ART_1, OWNER],
        ),
      );

      await expectViolation(c, /comments_whole_block_is_free/, () =>
        c.query(
          `insert into spideryarn.comments
             (article_id, id, owner_id, block_id, status)
           values ($1,'whole-pending',$2,'spya-k3m9qt','pending')`,
          [ART_1, OWNER],
        ),
      );
    });
  });

  it("an article cannot point at another article's revision", async () => {
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

  it("there can only ever be one queue_state row", async () => {
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

  /**
   * **The one thing standing between a delete and somebody's bill.**
   *
   * `ingest_events.article_id` is `on delete set null`, and usage is priced live
   * from `articles.visibility` — a public ingest costs half a slot, a private one
   * a full one. So without this trigger, destroying a public article turns its
   * charged rows unresolvable, an unresolvable row is charged full price, and the
   * owner's usage goes **up** for having thrown something away.
   *
   * It is here rather than only in tests/billing-half-units.test.ts because the
   * trigger is drift: drizzle's snapshot knows the column and knows nothing about
   * the trigger, exactly like the guards in 0001, so a generated migration that
   * dropped and recreated `articles` would take it away in silence. **This is the
   * assertion that would notice** — do not delete it for looking like a test of
   * Postgres, which is what the header of this file is about.
   */
  it("deleting an article freezes what it cost onto its charged rows", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query("update spideryarn.articles set visibility = 'public' where id = $1", [ART_1]);
      /* The id is carried rather than the row re-found by owner, so a leftover
         row from some killed run cannot make this pass or fail for a reason that
         is not about the trigger. */
      const charged = await c.query<{ id: string }>(
        `insert into spideryarn.ingest_events (owner_id, succeeded_at, article_id)
         values ($1, now(), $2) returning id`,
        [OWNER, ART_1],
      );
      const eventId = charged.rows[0]!.id;
      const priceOf = async () =>
        (
          await c.query<{ article_id: string | null; v: string | null }>(
            `select article_id, article_visibility_at_delete as v
               from spideryarn.ingest_events where id = $1`,
            [eventId],
          )
        ).rows;

      /* Null while the article exists: there is nothing here for
         `articles.visibility` to disagree with, which is the whole reason a
         deletion-only snapshot is not a competing source of truth. */
      expect(await priceOf()).toEqual([{ article_id: ART_1, v: null }]);

      await c.query("delete from spideryarn.articles where id = $1", [ART_1]);

      /* And the row survives the delete with its price on it — `set null`, so
         the ledger may not lose an ingest, and the article it can no longer
         reach is remembered as having been public. */
      expect(await priceOf()).toEqual([{ article_id: null, v: "public" }]);
    });
  });

  /**
   * **Postgres does not index the referencing side of a foreign key**, and this
   * one is read on the way out of existence: the freeze trigger's
   * `update ... where article_id = OLD.id` has to find an article's charged rows.
   * The ledger is append-only and unbounded, so without an index that is a
   * sequential scan per article deleted — and the way it eventually fails is a
   * delete hitting the runtime role's two-minute statement timeout, which is not
   * a failure anybody would connect back to a missing index. GPT Sol's F7,
   * 2026-09-07.
   *
   * **Partial on `is not null`**, because the rows that can never match are
   * exactly the ones with no article, and those are the ones that accumulate.
   *
   * Unlike the triggers, an index *is* in drizzle's snapshot, so this is not a
   * drift guard against a regenerated table — it pins the `where` clause, which
   * is the part a later edit would drop without anything looking wrong.
   */
  it("the ledger's article_id is indexed, so deleting an article does not scan it", async () => {
    const { rows } = await pool!.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'spideryarn'
          and tablename = 'ingest_events'
          and indexname = 'ingest_events_article_id_live'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toMatch(/WHERE \(article_id IS NOT NULL\)/);
  });

  /**
   * **"The two are never both readable" is a constraint now, not a comment.**
   *
   * `article_visibility_at_delete` is only safe as a *second* answer to what an
   * ingest cost because it is unreadable while the live one exists. The original
   * CHECK restricted the vocabulary and nothing else, so a row could carry a
   * live public article and a frozen `'private'` at the same time — harmless
   * today, because the `coalesce` in `isPublicPrice` puts the live column first,
   * and a trap for whoever changes that order later. GPT Sol's F9, 2026-09-07.
   *
   * What makes the constraint possible is that the freeze trigger now unlinks
   * and stamps in ONE statement, instead of stamping and leaving the foreign
   * key's `on delete set null` to unlink afterwards.
   */
  it("a charged row may not carry both a live article and a frozen price", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await expectViolation(c, /ingest_events_frozen_only_after_unlink/, () =>
        c.query(
          `insert into spideryarn.ingest_events
             (owner_id, succeeded_at, article_id, article_visibility_at_delete)
           values ($1, now(), $2, 'private')`,
          [OWNER, ART_1],
        ),
      );

      /* And it cannot be reached the other way round either. Stamping a price
         onto a row whose article is still there is the exact write every comment
         about this column calls impossible. */
      const charged = await c.query<{ id: string }>(
        `insert into spideryarn.ingest_events (owner_id, succeeded_at, article_id)
         values ($1, now(), $2) returning id`,
        [OWNER, ART_1],
      );
      const eventId = charged.rows[0]!.id;
      await expectViolation(c, /ingest_events_frozen_only_after_unlink/, () =>
        c.query(
          `update spideryarn.ingest_events
              set article_visibility_at_delete = 'private' where id = $1`,
          [eventId],
        ),
      );
    });
  });

  /**
   * **Losing the article without recording what it was must fail loudly.**
   *
   * Nothing in the product writes this, and that is the point: a stray
   * `update ingest_events set article_id = null` — an operator at three in the
   * morning, or the freeze trigger having drifted away — turns a half-price
   * public charge into a full-price unresolvable one, and nothing about the
   * resulting row looks wrong afterwards. GPT Sol's F8, 2026-09-07.
   *
   * The second half of this case is as load-bearing as the first: the guard must
   * NOT refuse the legitimate unlink, which arrives carrying the frozen price in
   * the same statement. A guard that also broke deletion would be found within
   * the hour; one that quietly allowed the stray write would not.
   */
  it("a charged row cannot lose its article without recording what it was", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const charged = await c.query<{ id: string }>(
        `insert into spideryarn.ingest_events (owner_id, succeeded_at, article_id)
         values ($1, now(), $2) returning id`,
        [OWNER, ART_1],
      );
      const eventId = charged.rows[0]!.id;

      await expectViolation(c, /without a frozen price/, () =>
        c.query("update spideryarn.ingest_events set article_id = null where id = $1", [eventId]),
      );

      /* Both columns in one statement: the shape the freeze trigger uses. */
      await c.query(
        `update spideryarn.ingest_events
            set article_id = null, article_visibility_at_delete = 'public'
          where id = $1`,
        [eventId],
      );
      const { rows } = await c.query<{ article_id: string | null; v: string | null }>(
        `select article_id, article_visibility_at_delete as v
           from spideryarn.ingest_events where id = $1`,
        [eventId],
      );
      expect(rows).toEqual([{ article_id: null, v: "public" }]);
    });
  });

  it("the queue_state row cannot be deleted", async () => {
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
  it("the schema allows two jobs to run at once — the cap is not in the database", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const running = (id: string) =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, attempt_id, lease_expires_at)
           values ($1,$2,$3,'[]'::jsonb,'running','w',gen_random_uuid(), now() + interval '1 minute')`,
          /* A slug each. `jobs_one_running_per_slug` allows one *running* row
             per article, so two on one slug would be refused by *that* index and
             this would pass while saying nothing about the cap. (It said
             `jobs_active_slug` until 2026-09-02; the index changed, the reason
             the slugs differ did not.) */
          [id, OWNER, id],
        );
      await running("spya-aaaaaa");
      await expect(running("spya-bbbbbb")).resolves.toBeDefined();
    });
  });

  it("a running job must carry its fencing token", async () => {
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

  it("the id CHECK accepts exactly what mintId can produce", async () => {
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

  it("the hand-written constraints survived migration", async () => {
    await inRollback(async (c) => {
      // drizzle-kit's snapshot does not know about drizzle/0001_*.sql, so a
      // future generated migration that drops and recreates one of these tables
      // takes these with it and says nothing. This is that alarm.
      const { rows } = await c.query(
        `select conname from pg_constraint
          where connamespace = 'spideryarn'::regnamespace
            and conname in ('articles_owner_fk','comments_owner_fk','jobs_owner_fk',
                            'articles_current_revision_fk','reader_profiles_owner_fk',
                            'uploads_owner_fk','feedback_owner_fk',
                            'billing_accounts_owner_fk','ingest_events_owner_fk',
                            'jobs_ingest_event_fk','realtime_sessions_owner_fk',
                            'rate_limit_events_owner_fk','link_summaries_owner_fk')
          order by conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual([
        "articles_current_revision_fk",
        "articles_owner_fk",
        /* Both owner keys from drizzle/20260902163433. The second matters most:
           the ledger is the record of what an account was charged for, so a
           delete that took it silently would take the evidence with it. */
        "billing_accounts_owner_fk",
        "comments_owner_fk",
        /* drizzle/0040. A bug report must outlive the account that filed it —
           see that migration on why RESTRICT means more here than elsewhere. */
        "feedback_owner_fk",
        "ingest_events_owner_fk",
        /* The composite one, and the reason it is composite: a job carries
           `(ingest_event_id, owner_id)` into `ingest_events (id, owner_id)`, so
           one owner's job cannot spend another owner's quota slot. */
        "jobs_ingest_event_fk",
        "jobs_owner_fk",
        /* drizzle/20260905191017, and the second of the two CASCADEs in this
           list rather than a RESTRICT. A summary of where a link goes is a
           cache — one paragraph, rewritten whenever the article, the profile or
           the prompt moves, worth nothing once the reader is gone. Restricting
           a delete on it would mean an account could not be removed until its
           last hover expired. */
        "link_summaries_owner_fk",
        /* drizzle/20260905172650, and the first CASCADE. Bookkeeping: one row
           per outbound fetch a pointer caused, deleted by the limiter itself as
           soon as it falls out of the rolling window. It arrived with stage 2 of
           the link panel and was not added here then, which is exactly the
           omission this test exists to catch. */
        "rate_limit_events_owner_fk",
        "reader_profiles_owner_fk",
        /* drizzle/20260902150952. The parent of every realtime `ai_calls` row —
           and the reason RESTRICT here is doubly load-bearing: `ai_calls`
           references this table with RESTRICT too, so the record of what a live
           conversation cost cannot be deleted from either end by accident. */
        "realtime_sessions_owner_fk",
        "uploads_owner_fk",
      ]);
    });
  });

  /**
   * **This case used to be its own opposite**, and it is worth saying why.
   *
   * It was *"one article cannot have two jobs in flight"*, asserting
   * `jobs_active_slug` — unique on `(owner_id, slug)` over `queued` and
   * `running` — which did three jobs at once and so refused a second, *different*
   * request for one article at enqueue. Greg asked for that to become a line
   * rather than a refusal (2026-09-02), so the index became four narrower ones
   * and the behaviour this asserted became the behaviour that must not happen.
   *
   * Different work on one article now goes in. What still cannot: the same work
   * twice.
   */
  it("one article takes a line of different jobs, but not the same one twice", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const queued = (id: string, work: string) =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key)
           values ($1,$2,'paper','[]'::jsonb,'queued',$3)`,
          [id, OWNER, work],
        );
      await queued("spya-dddddd", "w1");

      /* De-duplication: two instances each accept one Add click and only one row
         survives, so the model call is paid for once. */
      await expectViolation(c, /jobs_active_work/, () => queued("spya-eeeeee", "w1"));

      /* And *different* work appends. This is the line: run Ideas while Glossary
         is going and it waits its turn rather than being refused. */
      await queued("spya-ffffff", "w2");

      // A finished job is history and de-duplicates nothing.
      await c.query("update spideryarn.jobs set status = 'done' where id = 'spya-dddddd'");
      await queued("spya-gggggg", "w1");
    });
  });

  /**
   * **De-duplication lets go of a stopped job; the running mutex does not.**
   *
   * `jobs_active_work` excludes `cancelling` rows so that a request cannot
   * collapse onto a job the reader has just stopped and vanish into it. The
   * mutex and the name reservation keep covering that row until it is terminal,
   * because its claimant is still inside the article. Two predicates that differ
   * by one word, and a "tidy-up" that made them agree would break one of them
   * silently — GPT Sol, 2026-09-02.
   */
  it("a stopped job stops de-duplicating before it stops holding the article", async () => {
    await inRollback(async (c) => {
      await seed(c);
      await c.query(
        `insert into spideryarn.jobs
           (id, owner_id, slug, steps, status, work_key, cancelling,
            attempt_id, lease_expires_at, reserves_name)
         values ('spya-dddddd',$1,'paper','[]'::jsonb,'running','w1',true,
                 gen_random_uuid(), now() + interval '10 minutes', true)`,
        [OWNER],
      );

      // The same work goes in, because that job is about to end.
      await c.query(
        `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key)
         values ('spya-eeeeee',$1,'paper','[]'::jsonb,'queued','w1')`,
        [OWNER],
      );
      // Its name is still spoken for, and so is the article itself.
      await expectViolation(c, /jobs_reserved_slug/, () =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, reserves_name)
           values ('spya-ffffff',$1,'paper','[]'::jsonb,'queued','w3',true)`,
          [OWNER],
        ),
      );
    });
  });

  /**
   * **The article mutex and the name reservation are global on `slug`**, and
   * that is a different scope from de-duplication on purpose.
   *
   * `articles.slug` is globally unique because it is the URL contract
   * (`/read/<slug>`), so two owners can build toward one name. Whose request it
   * is decides de-duplication; nothing about whose request it is decides who
   * gets the article. Between 2026-08-30 and 2026-09-02 nothing enforced this
   * at all: `jobs_only_one_running` had gone and `jobs_active_slug` was
   * owner-scoped.
   */
  it("two owners cannot run, or claim the name of, one article at once", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const other = "22222222-2222-2222-2222-222222222222";
      await seedAuthUser(c, {
        id: other,
        email: "schema-test-two@example.invalid",
        onConflictDoNothing: true,
      });
      const running = (id: string, owner: string) =>
        c.query(
          `insert into spideryarn.jobs
             (id, owner_id, slug, steps, status, work_key, attempt_id, lease_expires_at)
           values ($1,$2,'paper','[]'::jsonb,'running','w-'||$1,
                   gen_random_uuid(), now() + interval '10 minutes')`,
          [id, owner],
        );
      await running("spya-dddddd", OWNER);
      await expectViolation(c, /jobs_one_running_per_slug/, () => running("spya-eeeeee", other));

      const reserving = (id: string, owner: string) =>
        c.query(
          `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, reserves_name)
           values ($1,$2,'letter','[]'::jsonb,'queued','w-'||$1,true)`,
          [id, owner],
        );
      await reserving("spya-ffffff", OWNER);
      await expectViolation(c, /jobs_reserved_slug/, () => reserving("spya-gggggg", other));
    });
  });

  /**
   * **One active mint per address**, which is the race no other index catches.
   *
   * Two pastes of one URL at the same instant both look, both find nothing, and
   * both mint a slug ending in a random short id — so every key that contains
   * the slug lets them through and the reader gets two articles for one address.
   * Only `url_key` connects them.
   *
   * The three rows that must *not* collide are the interesting half: a null
   * address (an upload, and two uploads of one file are two documents), a
   * non-reserving row (a late step that happens to carry the article's URL), and
   * another owner's (Greg, 2026-08-26: reuse the source, add a per-user
   * article).
   */
  it("one owner cannot have two active jobs minting an article for one address", async () => {
    await inRollback(async (c) => {
      await seed(c);
      const other = "22222222-2222-2222-2222-222222222222";
      await seedAuthUser(c, {
        id: other,
        email: "schema-test-two@example.invalid",
        onConflictDoNothing: true,
      });
      const mint = (id: string, slug: string, owner: string, key: string | null, reserves = true) =>
        c.query(
          `insert into spideryarn.jobs
             (id, owner_id, slug, steps, status, work_key, reserves_name, url_key)
           values ($1,$2,$3,'[]'::jsonb,'queued','w-'||$1,$4,$5)`,
          [id, owner, slug, reserves, key],
        );
      await mint("spya-dddddd", "paper-a3f9k1", OWNER, "example.test/p");
      await expectViolation(c, /jobs_active_source/, () =>
        mint("spya-eeeeee", "paper-x7d2m4", OWNER, "example.test/p"),
      );

      // Two uploads carry no address, and a null equals nothing in an index.
      await mint("spya-ffffff", "one-k2m4n6", OWNER, null);
      await mint("spya-gggggg", "two-p8r0s2", OWNER, null);
      // A job that is not claiming a name is outside the index entirely.
      await mint("spya-hhhhhh", "paper-a3f9k1", OWNER, "example.test/p", false);
      // And it is one person's request, not a fact about the address.
      await mint("spya-jjjjjj", "paper-q5t7v9", other, "example.test/p");
    });
  });

  /**
   * **`cancelling` belongs to a running job and to nothing else.**
   *
   * Stop on a queued job settles it terminal in the same statement; every
   * transition out of `running` clears the flag. So a queued row carrying it is
   * a state the cancellation API cannot produce — and one nothing could clear:
   * it would sit outside `jobs_active_work`, so no request would ever
   * de-duplicate onto it, while still blocking its article's line as a
   * predecessor for ever. GPT Sol raised it as a suggestion, 2026-09-02, and it
   * was taken because the alternative is a comment asking every future
   * transition to remember.
   */
  it("only a running job may be stopping", async () => {
    await inRollback(async (c) => {
      await seed(c);
      for (const status of ["queued", "done", "error", "cancelled"]) {
        await expectViolation(c, /jobs_cancelling_is_running/, () =>
          c.query(
            `insert into spideryarn.jobs (id, owner_id, slug, steps, status, work_key, cancelling)
             values ('spya-dddddd',$1,'paper','[]'::jsonb,$2,'w1',true)`,
            [OWNER, status],
          ),
        );
      }
      await c.query(
        `insert into spideryarn.jobs
           (id, owner_id, slug, steps, status, work_key, cancelling, attempt_id, lease_expires_at)
         values ('spya-dddddd',$1,'paper','[]'::jsonb,'running','w1',true,
                 gen_random_uuid(), now() + interval '10 minutes')`,
        [OWNER],
      );
    });
  });

  it("a job carries both halves of its upload or neither", async () => {
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

  it("the uploads status CHECK lists exactly the statuses the type has", async () => {
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

  it("a terminal upload has to carry its evidence", async () => {
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

  it("the checkpoints namespace CHECK lists exactly the namespaces the type has", async () => {
    await inRollback(async (c) => {
      await seed(c);
      /**
       * **Two hand-kept copies of one list, with nothing between them until
       * now.** `CheckpointNamespace` (src/store/checkpoints.ts) is the union;
       * the CHECK on this table is the other copy, and adding a name to the
       * first without the second is a write Postgres refuses.
       *
       * That combination is worse than an ordinary constraint violation,
       * because **both callers deliberately swallow a failed checkpoint write**
       * — a write that throws is meant to cost one re-buy rather than the run,
       * so it is logged at `warn` and the stage carries on. The only symptom of
       * a namespace declared and never accepted is therefore a cache that never
       * hits and a bill that goes up. docs/reusable/silent-success.md; and it
       * came within one migration of happening when `hierarchy-deepen` was added
       * on 2026-09-05.
       *
       * Asserted against `CHECKPOINT_NAMESPACES` itself rather than a list typed
       * out again here, which would be a third copy with the same problem.
       */
      for (const namespace of CHECKPOINT_NAMESPACES) {
        await c.query(
          `insert into spideryarn.checkpoints (article_id, namespace, key, value)
           values ($1, $2, $3, '{}'::jsonb)`,
          [ART_1, namespace, `k${namespace.replace(/[^a-z0-9]/g, "")}`],
        );
      }
      /* The control: a table that refused everything, or one whose CHECK had
         been dropped in the way, could not pass both halves. */
      await expectViolation(c, /checkpoints_namespace/, () =>
        c.query(
          `insert into spideryarn.checkpoints (article_id, namespace, key, value)
           values ($1, 'hierarchy-invented', 'k0', '{}'::jsonb)`,
          [ART_1],
        ),
      );
    });
  });

  it("spideryarn is not exposed through the Data API", async () => {
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

    it("refuses a hash that is not one", async () => {
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

    it("refuses a kind that names no decoder", async () => {
      await inRollback(async (c) => {
        await expectViolation(c, /raw_sources_kind/, () =>
          c.query("insert into spideryarn.raw_sources values ($1,'docx',1,'x',now())", [SHA]),
        );
      });
    });

    it("refuses half a pointer", async () => {
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

    it("refuses a pointer to an object it has no record of", async () => {
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

    it("accepts a whole pointer to a registered object", async () => {
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

    it("lets two revisions share one source document", async () => {
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
