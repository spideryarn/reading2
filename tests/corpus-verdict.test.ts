/**
 * The two judgements `db:corpus-readiness` makes, fed the shapes they exist to
 * reject.
 *
 * Both had been green while wrong. An empty corpus passed both row checks by
 * having no rows to fail on, and printed `✓ ready` over the exact state a
 * botched refetch leaves behind; and the `--seed-a-bad-row` control reported
 * success whenever *anything* had failed, so check 1 could miss the row the
 * flag had planted and the control would still say the check works. GPT Sol,
 * 2026-08-31, code review §§ 3-4, and
 * docs/reusable/silent-success.md for why both are the same mistake.
 */

import { describe, expect, it } from "vitest";

import { controlVerdict, readinessFailures } from "../scripts/corpus-verdict.js";

const BOTH_PLANTED = { orphanedRevision: "rev-1", danglingSha: "sha-1" };

const FULL = { articles: 14, revisions: 14, refs: 14 };

describe("readinessFailures", () => {
  it("is empty on a corpus with rows and nothing wrong with them", () => {
    expect(readinessFailures(FULL, 0, 0)).toEqual([]);
  });

  /** The finding. Zero rows makes both per-row checks vacuous. */
  it("fails an entirely empty corpus rather than calling it ready", () => {
    expect(readinessFailures({ articles: 0, revisions: 0, refs: 0 }, 0, 0)).toEqual([
      "there are no articles at all",
      "there are no article revisions at all",
      "no revision names a source object",
    ]);
  });

  it("fails articles with no revisions behind them", () => {
    expect(readinessFailures({ articles: 14, revisions: 0, refs: 0 }, 0, 0)).toContain(
      "there are no article revisions at all",
    );
  });

  it("fails revisions that name no source object", () => {
    expect(readinessFailures({ articles: 14, revisions: 14, refs: 0 }, 0, 0)).toEqual([
      "no revision names a source object",
    ]);
  });

  it("still reports the per-row faults", () => {
    expect(readinessFailures(FULL, 2, 3)).toEqual([
      "2 revision(s) have stamped HTML and no extracted HTML",
      "3 source reference(s) could not be read back",
    ]);
  });
});

describe("controlVerdict", () => {
  it("passes only when each check named the exact fault planted for it", () => {
    expect(controlVerdict(BOTH_PLANTED, ["rev-1"], ["sha-1"]).sawIt).toBe(true);
  });

  /**
   * **The finding.** Check 1 misses the seed; check 2 fails for its own
   * unrelated reason; the old code read the shared counter and called the
   * control a success. A negative control that can pass without detecting
   * anything is worse than none, because it gets quoted as evidence.
   */
  it("fails when check 1 missed its seed even though check 2 found plenty", () => {
    const v = controlVerdict(BOTH_PLANTED, ["rev-2", "rev-3"], ["sha-1", "sha-9"]);
    expect(v.sawIt).toBe(false);
    expect(v.say).toContain("CHECK 1 DID NOT NAME revision rev-1");
  });

  /* And the same the other way round: check 2 missing its seed is not excused
     by check 1 having found its own. */
  it("fails when check 2 missed its seed even though check 1 found its own", () => {
    const v = controlVerdict(BOTH_PLANTED, ["rev-1"], ["sha-from-something-else"]);
    expect(v.sawIt).toBe(false);
    expect(v.say).toContain("CHECK 2 DID NOT NAME the dangling reference sha-1");
  });

  it("fails when neither check named anything at all", () => {
    expect(controlVerdict(BOTH_PLANTED, [], []).sawIt).toBe(false);
  });

  /** Nothing to seed is a control that could not be run, not one that passed. */
  it("fails when there was no revision to break", () => {
    const v = controlVerdict({ orphanedRevision: null, danglingSha: "sha-1" }, [], ["sha-1"]);
    expect(v.sawIt).toBe(false);
    expect(v.say).toContain("A control that cannot be run has not passed");
  });

  it("fails when no revision named a source object to break", () => {
    const v = controlVerdict({ orphanedRevision: "rev-1", danglingSha: null }, ["rev-1"], []);
    expect(v.sawIt).toBe(false);
    expect(v.say).toContain("check 2 has nothing to break");
  });
});
