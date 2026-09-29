/**
 * **A missing label must never be drawn as a blank row.**
 *
 * `navLabel` is optional on a `TreeNode`, and until 2026-09-06 an absent one
 * meant exactly one thing — *deliberately unlabelled*, a caption or a
 * pull-quote. A paragraph row renders `navLabel ?? title`, and a leaf's
 * `title` is normally `""`, so a label that is merely **not written yet** comes
 * out as an empty row that reads as a paragraph the article could not name.
 * `src/web/tree.ts` already names the shape of it: *"a run of forty blank leaf
 * cells"*.
 *
 * docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md makes that
 * state real for a minute or two after every ingest, by taking the label pass
 * out of the blocking step, so the whole layer is withheld while the labels
 * are `pending` or `failed` (src/web/nav-labels.ts). This file tested
 * Hierarchy's `Paragraphs` column too, until that mode retired on 2026-09-29
 * (docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md).
 *
 * Each case asserts the withholding **and** that the same fixture draws the
 * labels when the status says `ready`. A fixture with no labels in it
 * withholds everything and would read as a pass — the shape
 * docs/reusable/silent-success.md is about. The `ready` half is the positive
 * control.
 *
 * The rule is `outlineProjection`, which is pure and is the one place that
 * decides both what rung 5 draws and which row is current (src/web/outline.ts).
 * `OutlinePanel` measures; the rule is here.
 */
import { describe, expect, it } from "vitest";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import { outlineProjection } from "../src/web/outline.js";
import { readArticleFromDir } from "./helpers/article-from-dir.js";
import type { NavLabelStatus } from "../src/types.js";

const DIR = "tests/fixtures/data-root/data/noema-mythology-of-conscious-ai";

describe("Structure's list face paragraph rung", () => {
  /** Rung 5's rows — level 3 is a paragraph (src/web/outline.ts § `OutlineRow.level`). */
  async function paragraphRows(status: NavLabelStatus): Promise<string[]> {
    const loaded = await readArticleFromDir(DIR);
    const geometry = buildGeometry(loaded.tree, loaded.blocks);
    /* Full depth, which is what StructureBand passes to the list face — the default
       of 2 stops above the paragraphs and there would be no rung 5 to withhold. */
    const root5 = buildSummaryTree(loaded.tree, loaded.blocks, geometry.leafDepth);
    const projection = outlineProjection({
      root: root5,
      supplementOf: geometry.supplementOf,
      arcByRow: null,
      focusRow: 0,
      rung: 5,
      /* What `OutlinePanel` computes as `allowParagraphs` — the window says yes,
         and the article's status is the other half. */
      allowParagraphs: status === "ready",
    });
    return projection.rows.filter((row) => row.level === 3).map((row) => row.text);
  }

  it("draws paragraph rows when the labels are ready", async () => {
    /* The positive control again: this fixture's current section has to be one
       whose paragraphs rung 5 would actually draw, or the case below asserts
       nothing at all. */
    expect(await paragraphRows("ready")).not.toHaveLength(0);
  });

  it("draws none at all while they are pending", async () => {
    /* Not "draws the ones that exist". A partly-drawn rung is what outline.ts
       calls a lie about the structure: a section of eight paragraphs coming out
       as two, with the shortfall reading as the article's own shape. */
    expect(await paragraphRows("pending")).toHaveLength(0);
  });

  it("draws none after a failure either", async () => {
    expect(await paragraphRows("failed")).toHaveLength(0);
  });
});
