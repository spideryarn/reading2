/**
 * The helper that turns a refused claim into a message worth reading.
 *
 * ## Why this exists
 *
 * Every job suite asserted `(await store.claim(…)).kind` against `"claimed"`
 * and threw the rest of the outcome away. When one of them went red on the
 * shared local database the whole report was:
 *
 *     expected 'busy' to be 'claimed'
 *
 * which names neither the reason nor the fact that the run was contended, and
 * so reads exactly like a product bug in `claim`. The reason string was sitting
 * in the value being discarded — `another claim is being decided` says a
 * foreign process held `spideryarn.queue_state`, and that is the whole
 * diagnosis.
 *
 * Measured on 2026-09-03, before this helper: `tests/store-jobs-parity.test.ts`
 * alone, three runs back to back on an otherwise unchanged tree, failed 2, then
 * 5, then 4 of its 90 tests — every one of them `expected 'busy' to be
 * 'claimed'`, and nothing in the output said which of the four `busy` reasons
 * it was or that another agent's dev server was ingesting at the time.
 *
 * ## What it deliberately does NOT do
 *
 * It does not retry. A retry would turn a contended run green, and a green that
 * was contended is not a verdict on the product — it is the failure this repo
 * keeps writing postmortems about (docs/reusable/silent-success.md). GPT Sol,
 * 2026-09-03, reviewing this exact choice: retries "turn a contaminated run
 * into an apparently valid green and can conceal real queue regressions."
 *
 * So contention stays **red**, and says so in words.
 */
import { describe, expect, it } from "vitest";

import type { ClaimOutcome } from "../src/store/jobs.js";
import type { Job } from "../src/types.js";
import { CONTENDED, expectClaimed } from "./helpers/expect-claimed.js";

const job = { id: "spya-test01", slug: "a-slug" } as unknown as Job;

describe("expectClaimed", () => {
  it("hands back the job it was given, so a caller can keep using it", () => {
    const claimed: ClaimOutcome = { kind: "claimed", job };
    expect(expectClaimed(claimed)).toBe(job);
  });

  /**
   * The two reasons that mean *somebody else was in the database*. Both are
   * about a claimant this process did not start, so both have to say that the
   * run is not a verdict rather than letting the reader believe `claim` is
   * broken.
   */
  it.each([
    ["another claim is being decided", "the queue_state singleton"],
    ["already running 3 of 100 jobs", "the concurrency cap"],
  ])("calls %s contention, and says the run is not a verdict", (why) => {
    const busy: ClaimOutcome = { kind: "busy", why };
    expect(() => expectClaimed(busy)).toThrow(CONTENDED);
    expect(() => expectClaimed(busy)).toThrow(why);
  });

  /**
   * A `busy` this suite caused itself — two jobs on one article, in a test that
   * queued them both — is a real failure of the test's own setup, so it must
   * NOT be dressed up as pollution. Naming everything contention would make the
   * banner meaningless the first time somebody wrote a genuine bug.
   */
  it.each([
    ["another job on this article is ahead of it", /ahead of it/],
    ["another request is inside this job", /inside this job/],
  ])("does not blame another process for %s, which a test does to itself", (why, shown) => {
    const busy: ClaimOutcome = { kind: "busy", why };
    expect(() => expectClaimed(busy)).toThrow(shown);
    expect(() => expectClaimed(busy)).not.toThrow(CONTENDED);
  });

  it("names the reason for every other refusal rather than just its kind", () => {
    expect(() => expectClaimed({ kind: "gone" })).toThrow(/gone/);
    expect(() => expectClaimed({ kind: "finished", job })).toThrow(/finished/);
    expect(() => expectClaimed({ kind: "stopping", job })).toThrow(/stopping/);
  });

  /** The label a caller passes so a failure says WHICH claim, not just that one failed. */
  it("carries the caller's label into the message", () => {
    expect(() => expectClaimed({ kind: "gone" }, "the second job on one article")).toThrow(
      /the second job on one article/,
    );
  });
});
