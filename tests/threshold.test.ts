/**
 * The one threshold rule the three sliders share — src/web/threshold.ts.
 *
 * Glossary, Quotes and Search all now hide what is below the bar and say how
 * many, so the rule lives once and each caller passes its own score accessor.
 * What these tests are really protecting is the thing the plan calls this
 * feature's worst failure: **a count that disagrees with the list under it.**
 * `applyThreshold` returns one outcome in one pass so that the visible list,
 * the `N of M`, the hidden count and the foot line cannot drift apart, and
 * every assertion below checks the parts against each other rather than each
 * one on its own.
 *
 * docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md § Stage 2.
 */
import { describe, expect, it } from "vitest";
import { applyThreshold, hiddenNote, survivesThreshold } from "../src/web/threshold.js";

/** A score is all these tests are about, so an item is one. */
const scoreOf = (n: number | null | undefined) => n;

describe("survivesThreshold", () => {
  it("is inclusive at the bar, so the printed number means what it says", () => {
    // A row printed "0.30" must not vanish at a threshold of 0.30 — the reader
    // can see the number and would read that as a bug.
    expect(survivesThreshold(0.3, 0.3)).toBe(true);
    expect(survivesThreshold(0.29, 0.3)).toBe(false);
  });

  it("shows an unscored item at every position of the bar", () => {
    /* **Absent is not low**, and this is the one line in the feature that must
       not be got wrong. Greg, 2026-09-03: "In the interim, always show them."
       Showing it is the lossless direction — a thing the reader can see and
       judge, rather than one silently withheld on the strength of a missing
       field. */
    expect(survivesThreshold(undefined, 1)).toBe(true);
    expect(survivesThreshold(null, 100)).toBe(true);
    // And zero is a score, not an absence. `== null` and not `!`.
    expect(survivesThreshold(0, 0)).toBe(true);
    expect(survivesThreshold(0, 0.1)).toBe(false);
  });
});

describe("applyThreshold", () => {
  it("returns the list, the hidden count and the unscored count from one pass", () => {
    /* The whole point of an outcome object rather than a family of counting
       helpers. Every number the panel prints has to be derivable from this one
       result, and the assertions below are written as identities between the
       parts for exactly that reason. */
    const items = [0.9, 0.5, 0.2, 0.1, undefined, null];
    const out = applyThreshold(items, 0.5, scoreOf);
    expect(out.visible).toEqual([0.9, 0.5, undefined, null]);
    expect(out.hiddenCount).toBe(2);
    expect(out.unscoredCount).toBe(2);
    // The identity a drifting count would break.
    expect(out.visible.length + out.hiddenCount).toBe(items.length);
  });

  it("keeps the order it was given, so a filtered list is still in reading order", () => {
    const items = [0.2, 0.9, 0.1, 0.6];
    expect(applyThreshold(items, 0.5, scoreOf).visible).toEqual([0.9, 0.6]);
  });

  it("hides nothing and counts nothing when everything clears", () => {
    const out = applyThreshold([0.9, 0.8], 0.5, scoreOf);
    expect(out.hiddenCount).toBe(0);
    expect(out.unscoredCount).toBe(0);
    expect(out.visible).toHaveLength(2);
  });

  it("leaves a list of nothing but unscored items whole, at any bar", () => {
    /* The case Greg's interim rule is about, and the one that would look like a
       broken filter if it went the other way: every item survives, nothing is
       hidden, and the foot line therefore says nothing is hidden. */
    const out = applyThreshold([undefined, undefined, null], 1, scoreOf);
    expect(out.visible).toHaveLength(3);
    expect(out.hiddenCount).toBe(0);
    expect(out.unscoredCount).toBe(3);
    expect(hiddenNote(out.hiddenCount, 3, TERM)).toBe("Nothing is hidden by this threshold.");
  });

  it("can hide every scored item and still show the unscored ones", () => {
    const out = applyThreshold([0.9, undefined], 1, scoreOf);
    expect(out.visible).toEqual([undefined]);
    expect(out.hiddenCount).toBe(1);
    expect(out.unscoredCount).toBe(1);
  });

  it("is empty for an empty list rather than throwing", () => {
    const out = applyThreshold([], 0.5, scoreOf);
    expect(out).toEqual({ visible: [], hiddenCount: 0, unscoredCount: 0 });
  });

  it("does not mutate or alias the list it was given", () => {
    const items = [0.9, 0.1];
    const out = applyThreshold(items, 0.5, scoreOf);
    expect(items).toEqual([0.9, 0.1]);
    expect(out.visible).not.toBe(items);
  });
});

const TERM = { one: "term", many: "terms" };
const QUOTE = { one: "quote", many: "quotes" };

describe("hiddenNote", () => {
  /* The copy is specified verbatim in the plan, so it is asserted verbatim
     here. Two words are deliberately absent and each has a reason: **"clears"**,
     because an unscored item survives without clearing anything and the verb
     would be a small lie in the one place this feature has to be honest; and
     **"the rest"**, because that group is gone. */
  it("says how many are hidden, and how to get them back", () => {
    expect(hiddenNote(18, 40, TERM)).toBe(
      "18 terms are hidden by this threshold. Drag the slider left to show them.",
    );
  });

  it("says so when the bar is holding nothing back", () => {
    /* The silent-success guard — docs/reusable/silent-success.md. A slider that
       has stopped hiding anything looks exactly like a slider that has stopped
       working, and the difference has to be in words. No way back is offered
       because there is nothing to come back. */
    expect(hiddenNote(0, 40, TERM)).toBe("Nothing is hidden by this threshold.");
  });

  it("names the all-hidden case as all of them", () => {
    /* An empty list under a slider is ambiguous between *there is nothing here*
       and *you have hidden it all*, and those want opposite things done about
       them. This is the sentence that tells them apart. */
    expect(hiddenNote(18, 18, TERM)).toBe(
      "All 18 terms are hidden by this threshold. Drag the slider left to show them.",
    );
  });

  it("handles the singular in both the noun and the pronoun", () => {
    expect(hiddenNote(1, 5, TERM)).toBe(
      "1 term is hidden by this threshold. Drag the slider left to show it.",
    );
    // "All 1 term is hidden" is not English, so the count carries it alone.
    expect(hiddenNote(1, 1, QUOTE)).toBe(
      "1 quote is hidden by this threshold. Drag the slider left to show it.",
    );
  });

  it("takes its noun from the caller, because three panels count three things", () => {
    expect(hiddenNote(3, 9, QUOTE)).toMatch(/^3 quotes are hidden/);
  });

  it("never says 'clears' and never says 'the rest'", () => {
    for (const [hidden, total] of [
      [0, 5],
      [1, 5],
      [5, 5],
    ] as const) {
      const note = hiddenNote(hidden, total, TERM);
      expect(note).not.toMatch(/clears/i);
      expect(note).not.toMatch(/the rest/i);
    }
  });
});
