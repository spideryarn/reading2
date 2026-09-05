/**
 * **A slug-named job may only be queued by the reader who owns the article.**
 *
 * `POST /api/jobs {slug, steps:["ideas"]}` validated the shape of the slug and
 * nothing else — `parseJobRequest` in src/routes.ts, and the handler went
 * straight to `enqueue`. So owner B could queue work against owner A's article
 * and walk away, and until 2026-09-02 that was merely wasteful: the job failed
 * closed at claim, because `lockOrCreateArticle` cannot find or insert a slug
 * that belongs to somebody else (`PublishRefused`, src/store/pg-revisions.ts).
 *
 * The per-article queue makes it a wedge. A job may claim only when no *older*
 * active row exists for the same slug, and that rule is **global** on the slug
 * because `articles.slug` is; every job list and every Stop is owner-scoped. So
 * B's row sits at the head of A's line for ever — B has gone, and A cannot drive
 * a job that is not A's. The row that would remove itself in milliseconds never
 * gets the chance, because nothing ever claims it.
 *
 * GPT Sol's first blocker on
 * docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md,
 * answered in § 1f: **enqueue requires ownership of a slug-named target.**
 *
 * ## Why this is not the mutex test, and why the plan's first draft was wrong
 *
 * *"Two owners cannot run the same slug at once"* would pass without any of
 * this: the running mutex has always stopped that. What it misses is exactly the
 * case that hurts — an **invisible queued row**, which runs nothing, holds no
 * slot, and blocks one article's line indefinitely. So the assertion is that the
 * row **cannot be created**, not that it cannot run.
 *
 * ## Why Postgres, and only Postgres
 *
 * The filesystem store has no owner column on an article, so it has no second
 * reader, and a store with no second reader cannot express *"somebody who is not
 * the owner"* (docs/project/database.md). `src/store/index.ts` refuses to boot
 * on it in production. There is no B to keep out, so the check is a no-op there
 * by construction rather than by omission.
 *
 * ## Watched red
 *
 * 2026-09-02, with the ownership check taken out of `enqueue`:
 * *"promise resolved { id: 'spya-dk6jhn', … } instead of rejecting"* — Bob got a
 * queued job on Alice's article, which is the wedge in one line.
 *
 * Skips loudly when there is no database; see tests/helpers/pg-ready.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { getDb } from "../src/db/client.js";
import { jobs as jobsTable } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { enqueue } from "../src/jobs.js";
import { DEV_OWNER_ID, type OwnerId, runAsOwner } from "../src/owner.js";
import { TEST_SUB } from "./helpers/authed.js";
import { pgReady } from "./helpers/pg-ready.js";
import { scratchArticleInPg, type ScratchArticle } from "./helpers/scratch-article.js";

loadEnvLocal();

await pgReady({
  suite: "tests/enqueue-owns-the-article.test.ts",
  tables: ["spideryarn.articles", "spideryarn.jobs"],
});

/**
 * **Two readers that really exist**, because `jobs.owner_id` has a foreign key
 * into `auth.users` and a made-up uuid fails the insert rather than the check.
 * These are the pair `scripts/setup-local.ts` seeds on every dev machine —
 * `dev@spideryarn.local` and `dev-admin@spideryarn.local`.
 */
const ALICE = DEV_OWNER_ID;
const BOB = TEST_SUB as OwnerId;

/** Its own slug, so nothing here collides with another suite's fixtures. */
const SLUG = "test-enqueue-owns-alices-article";
/** A name nobody has, for the case that is deliberately allowed. */
const NOBODYS = "test-enqueue-owns-nobodys-article";

let alices: ScratchArticle | undefined;
let vercel: string | undefined;

beforeAll(async () => {
  /**
   * **`VERCEL`, so `enqueue` does not start driving what it queues.**
   *
   * `pump` returns immediately when it is set (src/jobs.ts), and the successful
   * case below really does create a job — which would otherwise run `ideas`
   * against a live article. Set here rather than hoisted, because `pump` reads
   * it when it is called rather than at import.
   */
  vercel = process.env.VERCEL;
  process.env.VERCEL = "1";
  alices = await scratchArticleInPg(SLUG, { ownerId: ALICE });
}, 120_000);

afterAll(async () => {
  if (vercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = vercel;
  /* Jobs first: a job row's `draft_revision_id` is a foreign key into the
     revision the article delete is trying to cascade away. */
  for (const slug of [SLUG, NOBODYS]) {
    await getDb().delete(jobsTable).where(eq(jobsTable.slug, slug));
  }
  await alices?.remove();
});

describe("enqueue, on an article somebody else owns", () => {
  it("refuses Bob, and says nothing about whose it is", async () => {
    /* **404, not 403** — docs/project/auth.md § whose data is it. A 403 would
       confirm that the article exists, which is the one fact a stranger holding
       a guessed slug does not have. */
    await expect(
      runAsOwner(BOB, () => enqueue({ slug: SLUG, steps: ["ideas"] })),
    ).rejects.toMatchObject({ status: 404 });

    /* **And no row was written**, which is the whole point: a job that fails at
       claim would still be sitting at the head of Alice's line. */
    const rows = await getDb().select().from(jobsTable).where(eq(jobsTable.slug, SLUG));
    expect(
      rows.filter((r) => r.ownerId === BOB),
      "a job of Bob's is in Alice's article's line",
    ).toEqual([]);
  });

  it("lets Alice queue work on her own article", async () => {
    /* The control, and it is not decoration: a check that refused *everybody*
       would pass the case above while breaking every mode button in the reading
       view. */
    const job = await runAsOwner(ALICE, () => enqueue({ slug: SLUG, steps: ["ideas"] }));
    expect(job.slug).toBe(SLUG);
    expect(job.ownerId).toBe(ALICE);
    expect(job.status).toBe("queued");
  });

  /**
   * **This expectation reversed on 2026-09-05, deliberately.**
   *
   * It used to read *"allows a slug nobody has, because there is nobody to take
   * it from"*, and the reasoning was sound as far as it went: every minted slug
   * ends in a random short id (src/ingest.ts § `slugWithShortId`), so no other
   * reader can ever come to want the name, and a job on a slug nobody has blocks
   * nothing but itself. Refusing it looked like a second, unrelated rule about
   * what a slug may name.
   *
   * What that missed is what a bare-slug request **means**. It carries no URL
   * and no upload, so it is not claiming a name — it is saying *run this on my
   * existing article*. Letting it name an article that does not exist turns a
   * typo into a purchase: `npm run blocks -- typoo` created an `articles` row,
   * failed the step inside it, and left the row and a failed revision on the
   * reader's shelf. Measured 2026-09-03, and the reason the check moved into
   * `enqueue` rather than staying a pre-check in `scripts/stage.ts`, where it was
   * first written. Stage E of
   * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
   *
   * **Watched red before the reversal**, on the code as it stood: *"Error: No
   * such article. ❯ Module.enqueue src/jobs.ts"* — the old case failing on the
   * new rule, which is the only way to know the two cases really are the same
   * question with opposite answers.
   *
   * **The privacy rule is unchanged and is in fact now stricter.** The refusal
   * used to consult `slugIsTaken`, the one deliberately unfiltered global
   * lookup, so "nobody has it" and "somebody else has it" were merely *treated*
   * alike; the only question asked now is `articleExists`, which is owner-scoped,
   * so they are indistinguishable by construction. Same sentence, same 404,
   * whichever it was — docs/project/auth.md § whose data is it.
   */
  it("refuses a slug nobody has, because a bare slug means an article you have", async () => {
    await expect(
      runAsOwner(BOB, () => enqueue({ slug: NOBODYS, steps: ["ideas"] })),
    ).rejects.toMatchObject({ status: 404 });

    /* **And the same sentence as the case above**, which is the whole of the
       privacy claim: a stranger holding a guessed slug cannot tell an article
       that is somebody else's from one that has never existed. */
    await expect(
      runAsOwner(BOB, () => enqueue({ slug: NOBODYS, steps: ["ideas"] })),
    ).rejects.toThrow("No such article.");

    /* No row, for the same reason the first case checks: a refusal that still
       inserted would leave the wreck this rule exists to prevent. */
    const rows = await getDb().select().from(jobsTable).where(eq(jobsTable.slug, NOBODYS));
    expect(rows, "a job was written for an article nobody has").toEqual([]);
  });
});
