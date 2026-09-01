/**
 * **A failed forced refresh loses the work it completed, and reports success.**
 *
 * The fourth fault of docs/plans/260831b-finish-the-database-move.md § *Stage 3
 * — the flip*, found by GPT Sol on 2026-08-31, and the whole of what this file
 * is about. It is four steps of fixture and nothing in the finished code says it
 * was ever wrong, which is why it is a file of its own with the sequence written
 * out rather than four more cases at the bottom of tests/jobs.test.ts.
 *
 * The sequence, once the pipeline commits through Postgres:
 *
 * 1. Published revision R1 exists.
 * 2. A forced job writes new `fetch`, `extract` and `blocks` into a **draft**,
 *    then fails at `hierarchy`.
 * 3. The failed draft is discarded (`failRevisionIn`, src/store/pg-session.ts).
 *    Everything those three steps produced goes with it. The reader is still on
 *    R1, which is the draft's whole purpose.
 * 4. Retry forces from the first step that did not *finish* — `hierarchy`.
 * 5. The retry's own draft is copied from **R1** again, so `fetch`, `extract`
 *    and `blocks` all find R1's artefacts current and skip, and `hierarchy` runs over
 *    the old article. **The job reports success and the refresh is gone**, with
 *    a row of green ticks over it. docs/reusable/silent-success.md.
 *
 * Note that step 5 is not a filesystem fault that the flip inherits — it is one
 * the flip *creates*. On a laptop the three steps really did write their files
 * and a retry finds them, so nothing is lost. In Postgres the draft is the only
 * place they ever were.
 *
 * ## What was decided, and what was not
 *
 * **Greg's decision 8, 2026-08-31: a failed refresh starts over.** `forceForRetry`
 * re-forces every step the *original request* forced, rather than only the ones
 * that did not finish, and `cascadeForce` takes it from there. The alternative —
 * retaining the failed draft so the retry can adopt its completed work — was
 * costed and moved to that plan's § *Appendix: someday maybe*.
 *
 * **The cost is real and is not mitigated here.** A refresh that fails at `hierarchy`
 * re-fetches, re-extracts and, for a PDF, pays for the transcription a second
 * time. The obvious saving is the per-chunk checkpoints src/pdf-read.ts already
 * writes, and they do not help on a deployment: they land under `dataDir`, which
 * is a job-scoped `/tmp` the next job cannot see. That is landing D2, and it is a
 * reason to want D2 sooner rather than an argument against decision 8.
 *
 * ## Why these are unit tests, and where the wiring is tested
 *
 * `forceForRetry` and `cascadeForce` are the two pure functions the whole fault
 * turns on, and this file is about what they answer.
 *
 * **What it deliberately does not prove is that anything calls them.** Case 2
 * composes them by hand, the way `enqueue` does, so it would stay green if
 * `retryJob` stopped passing the force set on, if `enqueue` dropped it, or if
 * the flags never reached the record — GPT Sol,
 * docs/plans/260831b-stage3-items3and4-review-sol.md finding 4. That is
 * `tests/retry-is-only-for-a-failed-job.test.ts`, which drives a real forced job
 * to a real failure over fake steps and then reads the retry's flags back out of
 * `data/_jobs/`.
 *
 * **An earlier version of this note said such a test would need a network fetch
 * and a paid `hierarchy` call, and that was wrong.** Injected stages reproduce the
 * discarded-draft sequence for nothing; only the *article read back at the end*
 * would have wanted the real pipeline, and it is not what the fault is about.
 */
import { describe, expect, it } from "vitest";

import { cascadeForce, forceForRetry } from "../src/jobs.js";
import { STEPS } from "../src/pipeline.js";
import type { JobStep, StepName } from "../src/types.js";

/** A step of a job that was **not** forced — an ordinary ingest's. */
const plain = (name: StepName, status: JobStep["status"]): JobStep => ({
  name,
  label: STEPS[name].label,
  status,
});

/** A step of a job that *was* forced. `enqueue` sets this from `cascadeForce`. */
const forced = (name: StepName, status: JobStep["status"]): JobStep => ({
  ...plain(name, status),
  force: true,
});

/**
 * The job the fault is about: the shelf's refresh button, dead at `hierarchy`.
 *
 * `{ slug, force: ["fetch"] }` is literally what src/web/ShelfEntry.tsx sends,
 * and `cascadeForce` turns it into a force flag on every step of the job — which
 * is why all five carry one here.
 */
const REFRESH_THAT_DIED_AT_HIERARCHY: JobStep[] = [
  forced("fetch", "done"),
  forced("extract", "done"),
  forced("blocks", "done"),
  forced("hierarchy", "error"),
  forced("assets", "pending"),
];

describe("a retry after a failed forced refresh", () => {
  /* --------------------------------------------------------------- 1 -- */

  /**
   * **The fault itself, at the one function that decides it.**
   *
   * Forcing `hierarchy` alone is the answer that reads as thrift and behaves as data
   * loss: the three steps above it finished into a draft that no longer exists,
   * so "they are already done" is a statement about a revision the retry cannot
   * see. The retry has to acquire the article again.
   */
  it("re-forces the steps whose work went with the discarded draft", () => {
    expect(forceForRetry(REFRESH_THAT_DIED_AT_HIERARCHY)).toEqual([
      "fetch",
      "extract",
      "blocks",
      "hierarchy",
      "assets",
    ]);
    /* The half that matters most, said on its own so a partial fix cannot pass:
       the retry must go back to the *front* of what was forced. */
    expect(forceForRetry(REFRESH_THAT_DIED_AT_HIERARCHY)[0]).toBe("fetch");
  });

  /* --------------------------------------------------------------- 2 -- */

  /**
   * **The same thing composed the way `enqueue` composes it**, because
   * `forceForRetry`'s answer is not what the new job runs — `cascadeForce` is.
   *
   * This is the assertion that would have caught a `forceForRetry` returning
   * something `cascadeForce` then dropped on the floor: a name that is not in
   * the job's own step list is quietly discarded, and the retry would come out
   * forcing nothing at all while every test of the first function passed.
   */
  it("makes the new job re-run every step the refresh had asked for", () => {
    const names = REFRESH_THAT_DIED_AT_HIERARCHY.map((s) => s.name);
    const forcedAgain = cascadeForce(names, new Set(forceForRetry(REFRESH_THAT_DIED_AT_HIERARCHY)));
    expect([...forcedAgain]).toEqual(["fetch", "extract", "blocks", "hierarchy", "assets"]);
  });

  /* --------------------------------------------------------------- 3 -- */

  /**
   * **The guard on the other side, and it is about money.**
   *
   * An ordinary failure — nothing forced — still forces nothing. The steps that
   * succeeded wrote into a draft this job still owns, or published, and skipping
   * them is the whole of what Retry means. A fix for the fault above that also
   * re-ran these would buy a model call on every retry in the app.
   */
  it("still forces nothing when the original was not a refresh", () => {
    expect(
      forceForRetry([
        plain("fetch", "done"),
        plain("extract", "done"),
        plain("blocks", "done"),
        plain("hierarchy", "error"),
      ]),
    ).toEqual([]);
  });

  /* --------------------------------------------------------------- 4 -- */

  /**
   * A refresh that died at its very first step is unchanged by any of this: the
   * earliest forced step and the earliest unfinished step are the same one.
   */
  it("forces from the front when the refresh died at `fetch`", () => {
    expect(forceForRetry([forced("fetch", "error"), forced("extract", "pending")])).toEqual([
      "fetch",
      "extract",
    ]);
  });

  /* --------------------------------------------------------------- 5 -- */

  /**
   * **Every step finished and the job still failed**, which is the case the old
   * rule got exactly backwards.
   *
   * A job whose steps are all `done` reaches Retry only if something *after* the
   * steps failed — the publication itself, which is where the draft is turned
   * into the article (`publishRevisionIn`, src/store/pg-revisions.ts). Nothing
   * was published, so the draft was failed and every one of those completed
   * steps is gone. The old rule looked for an unfinished step, found none, and
   * forced nothing: the retry then skipped all five and republished R1.
   */
  it("re-forces a refresh whose steps all finished and whose publication did not", () => {
    expect(
      forceForRetry([forced("fetch", "done"), forced("extract", "skipped")]),
    ).toEqual(["fetch", "extract"]);
  });

  /* --------------------------------------------------------------- 6 -- */

  /**
   * **Why the whole forced set, rather than the earliest of them.**
   *
   * `forceForRetry`'s own comment makes this argument and nothing exercised it
   * until now: `cascadeForce` refuses to sweep in a step in
   * `FORCE_ONLY_WHEN_NAMED` (src/pipeline.ts) that nobody named, so handing it
   * the first forced step alone reconstructs four of these five and silently
   * drops `tweets` — the one the reader explicitly asked to be redone.
   *
   * Both halves are here because only the pair says anything: the cascade from
   * `fetch` is what the thrifty version would have asked for, and the cascade
   * over the whole set is what the retry actually asks for.
   */
  it("keeps a `tweets` the reader named, which the cascade cannot put back", () => {
    const refresh = [...REFRESH_THAT_DIED_AT_HIERARCHY, forced("tweets", "pending")];
    const names = refresh.map((s) => s.name);

    expect(
      [...cascadeForce(names, new Set(["fetch"]))],
      "the cascade sweeps in by position, and `tweets` is exempt from that",
    ).not.toContain("tweets");

    expect(forceForRetry(refresh)).toContain("tweets");
    expect([...cascadeForce(names, new Set(forceForRetry(refresh)))]).toEqual(names);
  });
});
