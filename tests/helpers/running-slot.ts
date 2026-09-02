/**
 * Wait for an article's job line to empty instead of failing on it.
 *
 * ## Why this exists
 *
 * Suites here share fixed fixture slugs, so two copies of one file — a second
 * `npm test` beside yours, a dev server mid-ingest, a real job — end up wanting
 * the same article at the same time. Everything under `data/<slug>/` and every
 * `article_revisions` row for that slug is shared between them, so the loser of
 * such a race does not get a useful failure: it gets somebody else's artefacts,
 * or `duplicate key value violates unique constraint` from whichever insert
 * happened to be second, pointing at the test that lost rather than at the
 * contention.
 *
 * That is not hypothetical. On 2026-08-28 a full-suite run failed three cases in
 * `tests/store-job-draft.test.ts` this way while its own logic was fine: the file
 * passed alone, passed beside its neighbours, and failed only under the load of
 * all 266 files. `tests/helpers/load-article.ts` had already met this and grown
 * the retry below; this is that code, lifted out so there is one of it rather
 * than one per suite that gets bitten.
 *
 * ## What it waits on, and why that changed
 *
 * **It used to wait on a constraint name, and that was the fragile part.** The
 * helper caught `jobs_active_slug` — unique on `(owner_id, slug)` over `queued`
 * and `running` — and retried. On 2026-09-02 that index was replaced by four
 * narrower ones so that an article could hold a *line* of jobs rather than one
 * (docs/plans/260902e-a-per-article-job-queue-that-appends-and-modes-that-start-themselves.md),
 * and a second `queued` insert on a busy slug stopped raising anything at all.
 * Not an error, not a wait — a success. Two suites would each have believed they
 * owned the fixture slug's only job and stomped each other's revisions, with
 * nothing anywhere going red. The exact shape of docs/reusable/silent-success.md,
 * and the reason this file was rewritten before the schema moved rather than
 * after.
 *
 * Nor is that only a `queued`-versus-`queued` problem: `jobs_one_running_per_slug`
 * covers `running` rows only, so a *queued* insert never conflicts with a running
 * holder either. Waiting on any of the four names, however carefully spelled,
 * would have caught neither.
 *
 * So it waits on **the thing the suites actually need — this article has no job
 * queued or running** — which is a property of the table rather than of whichever
 * index happens to arbitrate. `tests/running-slot.test.ts` holds that against a
 * real database; the mocked cases there hold the retry decision, and neither half
 * covers the other.
 *
 * **No owner.** The article rules are global on `slug`, because `articles.slug`
 * is — an owner-scoped wait would let a suite start work on an article somebody
 * else's job is inside.
 *
 * ## Why retry as well
 *
 * The look and the insert are two statements, and anything outside this test run
 * can land between them. Whichever of the queue's unique indexes then refuses is
 * contention rather than a bug, so all four are waited out. A name missing from
 * `CONTENDED` is a suite failing with `duplicate key` and pointing at itself.
 *
 * ## Why a lock as well as this
 *
 * This used to say "why retry *rather than* a lock", on the grounds that the
 * advisory lock in `tests/store-jobs-parity.test.ts` "covers copies of this file
 * and nothing else". Both halves are still true — a lock only excludes the
 * holders that agree to take it, and a real ingest on the same laptop never
 * will — but the conclusion was wrong, because waiting has a failure mode of its
 * own: **polling is unfair**, so under enough contention one caller starves and
 * spends the whole budget below. That is what the 20-second failures on
 * 2026-08-29 were.
 *
 * So the two divide the work, and `./run-lock.ts` explains the split:
 *
 * - the **lock** removes contention *between suites*, which is nearly all of it,
 *   and is the only thing that can serialise two copies of a file that shares
 *   fixed fixture slugs with itself;
 * - this **wait** covers everything that never took the lock.
 *
 * Keep both. Removing this one leaves the suites defenceless against anything
 * outside the test run; removing the lock brings the starvation back.
 *
 * ## Why the timeout message says what it says
 *
 * Waiting clears a *contended* line but never a **wedged** one, and "try again
 * later" is useless advice when the answer is "delete the stuck row". So the
 * message has to name both readings.
 */
import { violatesConstraint } from "../../src/store/db-errors.js";

/** 40 × 500ms. Long enough for another suite's fixture, short enough to report. */
const ATTEMPTS = 40;
const GAP_MS = 500;

/**
 * The unique indexes that arbitrate an article's queue, all four of them.
 *
 * A `23505` naming one of these is another claimant getting to the row first,
 * which is an ordinary outcome and not this suite's bug. Any other duplicate key
 * is rethrown untouched — see the cases in tests/running-slot.test.ts, where
 * that distinction is the whole decision.
 *
 * `src/db/schema.ts` § `jobs` is where these are defined and says what each is
 * for; if one is renamed there, this list is the other place it is written down.
 */
const CONTENDED = [
  "jobs_one_running_per_slug",
  "jobs_reserved_slug",
  "jobs_active_work",
  "jobs_active_source",
] as const;

/**
 * Is anything queued or running for this article, whoever it belongs to?
 *
 * **The import is dynamic** so that a suite which sets its environment up before
 * pulling in `src/db/client.js` — tests/blocks-baseline.test.ts does exactly
 * that — is not overtaken by this file's static imports.
 */
async function articleIsBusyInDb(slug: string): Promise<boolean> {
  const { getDb } = await import("../../src/db/client.js");
  const { jobs } = await import("../../src/db/schema.js");
  const { and, eq, inArray, sql } = await import("drizzle-orm");
  const [row] = await getDb()
    .select({ active: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.slug, slug), inArray(jobs.status, ["queued", "running"])));
  return (row?.active ?? 0) > 0;
}

export interface SlotOptions {
  /* Only the tests for this file pass these. They exist so the timeout case is
     testable at all: at the real numbers it takes 20 seconds to reach, and a
     branch nobody can afford to run is a branch nobody has seen work. */
  attempts?: number;
  gapMs?: number;
  /**
   * The look, as a seam — so the cases that are about the *retry decision* can
   * be driven with a fake insert and no database at all, which is what they were
   * always doing. Every real caller leaves it alone.
   */
  articleIsBusy?: (slug: string) => Promise<boolean>;
}

/**
 * Run `insert` once this article has no job queued or running, waiting if it has.
 *
 * `insert` is called afresh on every attempt rather than being retried as a
 * value, because a job wants a new id per attempt — and because an insert that
 * threw on a constraint wrote nothing, so there is nothing to undo.
 *
 * `slug` is the article being waited on, and it is also what the timeout names.
 */
export async function insertWhenSlotFree<T>(
  slug: string,
  insert: () => Promise<T>,
  { attempts = ATTEMPTS, gapMs = GAP_MS, articleIsBusy = articleIsBusyInDb }: SlotOptions = {},
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (!(await articleIsBusy(slug))) {
      try {
        return await insert();
      } catch (err) {
        /* `violatesConstraint` walks the whole error chain. Reading
           `err.cause.constraint` at one level misses Drizzle's wrapper, and a
           miss here rethrows contention as though it were a bug. */
        if (!CONTENDED.some((name) => violatesConstraint(err, name))) throw err;
      }
    }
    if (attempt >= attempts) {
      throw new Error(
        `could not start a job for "${slug}" in ${(attempts * gapMs) / 1000}s: this article ` +
          "already has a job queued or running. If nothing is actually working, a row is " +
          "wedged and waiting will not clear it — look for a `queued` or `running` row in " +
          "`jobs` and remove it.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
