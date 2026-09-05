/**
 * What each column of the table is called, in the two places it is named —
 * docs/project/granularity-zoom.md#what-the-bar-calls-each-column.
 *
 * **It was three until 2026-09-05**, and the third is why this file exists: the
 * names were *different strings for the same column* (`L2` on the pill,
 * `Sections` in the header, a sentence in the tooltip), nothing on screen put
 * them side by side, and so a rename that landed in two of the three looked
 * entirely correct to whoever made it. `columnPill` has now folded into
 * `columnLabel` — the header row lost its height, so a full word in the bar is
 * the only place a column is named at all — which removes the string that was
 * hardest to keep married rather than the risk. `columnHint` is still built
 * *from* `columnLabel`, and that marriage is what the rest of this file checks.
 *
 * The double-`the` case below is not hypothetical. `columnHint` drops the
 * label into the middle of a sentence, so a label carrying its own article —
 * "The argument", which is what depth 0 returned from 2026-08-26 — produced
 * "Show or hide the the argument column" on the one pill Greg looked at most.
 *
 * **The `Arg` pill and the `hasArc` variants went on 2026-09-05**, when the L0
 * column left Hierarchy (layout.ts § `offerableGists`). What they were guarding
 * has not changed and is what the rest of this file still checks.
 */
import { describe, expect, it } from "vitest";
import { columnHint, columnLabel } from "../src/web/tree.js";

/** A three-deep tree: Article / Parts / Sections, with paragraphs at L3. */
const LEAF = 3;

describe("columnLabel", () => {
  it("names every rung in full, which is what the pills now wear", () => {
    expect(columnLabel(1, LEAF)).toBe("Parts");
    expect(columnLabel(2, LEAF)).toBe("Sections");
    expect(columnLabel(LEAF, LEAF)).toBe("Paragraphs");
  });

  it("says Paragraphs at whatever depth the leaves happen to be", () => {
    // The pill this replaced was `L{leafDepth}`, so it read differently on a
    // two-deep article than on a four-deep one — the whole reason it went.
    expect(columnLabel(2, 2)).toBe("Paragraphs");
    expect(columnLabel(5, 5)).toBe("Paragraphs");
  });

  /* Not offered as a column since 2026-09-05, but `?cols=0` still parses and
     the depth still exists in every tree, so the name has to stay true. */
  it("still names depth 0 for the addresses that can still reach it", () => {
    expect(columnLabel(0, LEAF)).toBe("Article");
  });
});

describe("columnHint", () => {
  it("reads as one sentence, with no article doubled in the middle", () => {
    expect(columnHint(2, LEAF)).toBe(
      "Show or hide the sections column — one sentence per section",
    );
    for (const depth of [0, 1, 2, LEAF]) {
      expect(columnHint(depth, LEAF)).not.toMatch(/the the/);
    }
  });

  it("names the same column the header does", () => {
    for (const depth of [0, 1, 2, LEAF]) {
      expect(columnHint(depth, LEAF)).toContain(columnLabel(depth, LEAF).toLowerCase());
    }
  });

  it("says the stride, which is the only thing that separates the columns", () => {
    expect(columnHint(1, LEAF)).toContain("per part");
    expect(columnHint(2, LEAF)).toContain("per section");
    expect(columnHint(LEAF, LEAF)).toContain("per paragraph");
  });
});
