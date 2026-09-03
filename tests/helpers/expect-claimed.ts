/**
 * Assert a claim succeeded, and when it did not, say enough to tell a contended
 * run from a broken one.
 *
 * ## The problem it solves
 *
 * `expect(outcome.kind).toBe("claimed")` reports `expected 'busy' to be
 * 'claimed'` and discards `why`, which is the only field that distinguishes
 * *another process was in this database* from *`claim` has a bug*. Those want
 * opposite responses from whoever reads the run, and the assertion made them
 * one symptom — docs/reusable/silent-success.md, in its reporting form.
 *
 * ## Why it does not retry
 *
 * Because a retry makes a contended run green, and a green taken while somebody
 * else held the queue is not a statement about the product. GPT Sol, 2026-09-03:
 * retries "turn a contaminated run into an apparently valid green and can
 * conceal real queue regressions." Contention stays red and explains itself;
 * the fix for the contention is a private test database, not a louder assertion
 * — docs/plans/ (the test-isolation plan).
 *
 * ## Which reasons count as contention
 *
 * `claim` has four `busy` reasons. Two are read as contention:
 *
 * - **the `queue_state` singleton** (`another claim is being decided`) — `claim`
 *   takes it `for update nowait` (src/store/pg-jobs.ts), so any other claimant
 *   mid-decision refuses this one.
 * - **the concurrency cap** (`already running N of M jobs`) — counted across the
 *   whole `jobs` table.
 *
 * and two are not, because a suite causes them itself:
 *
 * - `another job on this article is ahead of it` — a test that queues two jobs
 *   on one article does this to itself.
 * - `another request is inside this job` — likewise, a test that claims a job
 *   twice.
 *
 * **This is a judgement about the call sites, not about the strings.** The
 * classification holds because of what is true of the callers today: they pass
 * a cap of 100, far above anything one file starts; the low-cap tests establish
 * fewer live jobs than their successful claim allows; claims are sequential;
 * and tests/helpers/run-lock.ts excludes peer job suites. Break any of those —
 * a future test that deliberately contends two claims on one singleton, or a
 * regression that leaks a hundred `running` rows inside one run — and a reason
 * in the first group would be this suite's own doing, reported as somebody
 * else's. GPT Sol, 2026-09-03, who was right that the first draft of this
 * comment claimed something intrinsic to the wording.
 */
import type { ClaimOutcome } from "../../src/store/jobs.js";
import type { Job } from "../../src/types.js";

/**
 * The banner. Exported so the test asserting this behaviour matches on the real
 * string rather than a copy of it that could drift — one source of truth.
 */
export const CONTENDED = "TEST DATABASE CONTENDED";

/**
 * Substrings of `why` that mean a foreign claimant rather than this suite.
 *
 * Matched as substrings because one of them interpolates counts
 * (`already running 3 of 100 jobs`), so an equality check would silently stop
 * matching the day the wording around the numbers changed — and silently
 * failing to notice contention is the whole thing this file exists to prevent.
 */
const FOREIGN = ["another claim is being decided", "already running"];

function isContention(why: string): boolean {
  return FOREIGN.some((fragment) => why.includes(fragment));
}

/**
 * Return the claimed job, or throw a message that names the reason.
 *
 * `label` says *which* claim, for the files that claim a dozen times in one
 * test; without it a failure names the file and the line and nothing about
 * intent.
 */
export function expectClaimed(outcome: ClaimOutcome, label?: string): Job {
  if (outcome.kind === "claimed") return outcome.job;

  const which = label ? ` (${label})` : "";

  if (outcome.kind === "busy" && isContention(outcome.why)) {
    throw new Error(
      `${CONTENDED}${which}: claim refused because "${outcome.why}".\n` +
        "Another process was inside this database — a dev server mid-ingest, another agent's\n" +
        "suite, or `running` rows leaked by a killed run. This run is NOT a valid product\n" +
        "verdict: re-run it against a database nobody else is using.\n" +
        "See docs/project/testing.md and tests/helpers/run-lock.ts.",
    );
  }

  const why = outcome.kind === "busy" ? `: "${outcome.why}"` : "";
  throw new Error(`Expected a claim to succeed${which}, but it was refused as ${outcome.kind}${why}.`);
}
