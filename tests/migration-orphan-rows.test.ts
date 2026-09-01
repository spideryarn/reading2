/**
 * `--forget-orphans`, and the three things that have to be true before it
 * deletes a ledger row.
 *
 * **The gate it had was "every journal timestamp now exists".** That is not a
 * statement about the rows being deleted at all, and GPT Sol's review of the
 * built code says so: another branch's migration can carry a stamp this journal
 * has never seen, and deleting its row destroys the one piece of evidence that
 * would explain the refusal it later causes — the guard correctly refuses, and
 * the thing you would need in order to understand the refusal is gone.
 * docs/plans/260831ag-migration-watermark-repair-code-review-sol.md § 5.
 *
 * So: an exact allowlist, matched on stamp **and** hash, with the migration
 * that subsumes them proved in the same run, and nothing left pending. Each of
 * those three is watched refusing below.
 */

import { describe, expect, it } from "vitest";

import { KNOWN_ORPHANS, planToForget } from "../scripts/migration-ledger.js";

const SUBSUMER = "0037_experimental_features_and_callout_blocks";
const row = (k: (typeof KNOWN_ORPHANS)[number]) => ({ hash: k.hash, created_at: k.when });
const BOTH = KNOWN_ORPHANS.map(row);

describe("the allowlist itself", () => {
  it("is exactly the two pre-renumbering local migrations", () => {
    expect(KNOWN_ORPHANS.map((k) => k.when)).toEqual([1788191337811, 1788194935325]);
  });

  it("carries a hash for each, because a stamp alone is only a clock reading", () => {
    for (const k of KNOWN_ORPHANS) expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says where each deleted file can still be read", () => {
    for (const k of KNOWN_ORPHANS) expect(k.wasIn).toContain("git show");
  });
});

describe("planToForget", () => {
  it("forgets both rows when all three conditions hold", () => {
    const p = planToForget(BOTH, [], [SUBSUMER]);
    expect(p.forget.map((k) => k.when)).toEqual([1788191337811, 1788194935325]);
    expect(p.say).toContain("nothing left pending");
  });

  it("has nothing to say when there are no orphans", () => {
    expect(planToForget([], [], [SUBSUMER]).forget).toEqual([]);
  });

  /* ── 1. the allowlist, by stamp AND hash ─────────────────────────── */

  /**
   * **The finding.** A row from another branch has a stamp this journal has
   * never heard of, and the old gate deleted it along with everything else.
   */
  it("refuses to delete a row that is not on the allowlist", () => {
    const p = planToForget([...BOTH, { hash: "f".repeat(64), created_at: 1788300000000 }], [], [SUBSUMER]);
    expect(p.forget).toEqual([]);
    expect(p.say).toContain("1788300000000");
    expect(p.say).toContain("not on");
  });

  /* And it refuses ALL of them, including the two it knows: a ledger with an
     unaccountable row is one to read, not to tidy. */
  it("refuses the known rows too while a stranger is beside them", () => {
    const p = planToForget([...BOTH, { hash: "f".repeat(64), created_at: 1 }], [], [SUBSUMER]);
    expect(p.forget).toEqual([]);
  });

  /**
   * **The hash is the half that matters.** A row stamped 1788191337811 by some
   * other machine's migration is not the row on the allowlist, and matching on
   * the timestamp alone would delete it.
   */
  it("refuses a row with an allowlisted stamp and a different hash", () => {
    const p = planToForget(
      [{ hash: "0".repeat(64), created_at: KNOWN_ORPHANS[0]!.when }],
      [],
      [SUBSUMER],
    );
    expect(p.forget).toEqual([]);
    expect(p.say).toContain("not on");
  });

  /* ── 2. the migration that subsumes them, proved in this run ─────── */

  it("refuses while the migration whose row claims their effects is not being recorded", () => {
    const p = planToForget(BOTH, [], []);
    expect(p.forget).toEqual([]);
    expect(p.say).toContain(SUBSUMER);
    expect(p.say).toContain("has not proved");
  });

  it("is not satisfied by some other migration being recorded", () => {
    expect(planToForget(BOTH, [], ["0036_drop_summary_column"]).forget).toEqual([]);
  });

  /* ── 3. nothing left pending ─────────────────────────────────────── */

  it("refuses while a journal entry would still be unapplied afterwards", () => {
    const p = planToForget(BOTH, [{ tag: "0039_something" }], [SUBSUMER]);
    expect(p.forget).toEqual([]);
    expect(p.say).toContain("0039_something");
  });

  /* ── provenance survives either way ──────────────────────────────── */

  it("prints where each row came from when it does delete them", () => {
    const say = planToForget(BOTH, [], [SUBSUMER]).say;
    expect(say).toContain("0032_experimental_features");
    expect(say).toContain("0033_callout_blocks");
    expect(say).toContain("git show 9a5ef58:drizzle/0033_callout_blocks.sql");
  });
});
