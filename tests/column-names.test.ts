/**
 * What each column of the table is called, in the three places it is named —
 * docs/project/granularity-zoom.md#what-the-bar-calls-each-column.
 *
 * Worth a test for one reason: the three names are *different strings for the
 * same column* (`Arg` on the pill, `Argument` in the header, a sentence in the
 * tooltip), and nothing on screen puts them side by side, so a rename that
 * lands in two of the three looks entirely correct to whoever made it. The
 * tooltip is built from the header label to keep them married; this is the
 * check that the marriage holds and that the pill is not left behind.
 *
 * The double-`the` case below is not hypothetical. `columnHint` drops the
 * label into the middle of a sentence, so a label carrying its own article —
 * "The argument", which is what this returned from 2026-08-26 — produced
 * "Show or hide the the argument column" on the one pill Greg looks at most.
 */
import { describe, expect, it } from "vitest";
import { columnHint, columnLabel, columnPill } from "../src/web/tree.js";

/** A three-deep tree: Article / Parts / Sections, with paragraphs at L3. */
const LEAF = 3;

describe("columnPill", () => {
  it("names the two ends of the ladder and numbers the middle", () => {
    expect(columnPill(0, LEAF)).toBe("Arg");
    expect(columnPill(1, LEAF)).toBe("L1");
    expect(columnPill(2, LEAF)).toBe("L2");
    expect(columnPill(LEAF, LEAF)).toBe("Para");
  });

  it("says Para at whatever depth the leaves happen to be", () => {
    // The pill this replaced was `L{leafDepth}`, so it read differently on a
    // two-deep article than on a four-deep one — the whole reason it went.
    expect(columnPill(2, 2)).toBe("Para");
    expect(columnPill(5, 5)).toBe("Para");
  });

  it("keeps the arc's name on an article whose arc has not been generated", () => {
    // `columnPill` is not given `hasArc` at all, which is the point: furniture
    // does not move because a pipeline stage was skipped.
    expect(columnPill(0, LEAF)).toBe("Arg");
  });
});

describe("columnHint", () => {
  it("reads as one sentence, with no article doubled in the middle", () => {
    expect(columnHint(0, LEAF, true)).toBe(
      "Show or hide the argument column — one sentence per part on where the argument stands",
    );
    expect(columnHint(0, LEAF, true)).not.toMatch(/the the/);
  });

  it("tells the truth about a column with no arc behind it", () => {
    expect(columnHint(0, LEAF, false)).toBe(
      "Show or hide the article column — the whole piece in one sentence",
    );
  });

  it("names the same column the header does", () => {
    for (const depth of [0, 1, 2, LEAF]) {
      expect(columnHint(depth, LEAF, true)).toContain(
        columnLabel(depth, LEAF, true).toLowerCase(),
      );
    }
  });

  it("says the stride, which is the only thing that separates the columns", () => {
    expect(columnHint(1, LEAF)).toContain("per part");
    expect(columnHint(2, LEAF)).toContain("per section");
    expect(columnHint(LEAF, LEAF)).toContain("per paragraph");
  });
});
