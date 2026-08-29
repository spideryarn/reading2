/**
 * The arc column — see docs/project/granularity-zoom.md#the-arc.
 *
 * Two things are worth testing here and they are both about *silence*. The arc
 * is a second artefact joined back onto the tree, so both of its failure modes
 * look like success: a cell that quietly misaligns the whole table, and a
 * sentence quietly attached to the wrong part. Neither raises anything, and
 * neither is visible to a reader who doesn't already know the article.
 *
 * The generation half (src/arc.ts) isn't tested — it's a model call, and
 * testing.md is clear about which side of that line we stay on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Arc, Block, Tree } from "../src/types.js";
import { buildArcColumn, buildGeometry } from "../src/web/tree.js";
import { partsOf, buildArc } from "../src/arc.js";

/** The arc's input fingerprint is not what these tests are about; see tests/arc-freshness.test.ts. */
const FIXTURE_HASH = "0000000000000000.0000000000000000.0000000000000000";

const blocks: Block[] = JSON.parse(readFileSync("example/blocks.json", "utf8")).blocks;
const tree: Tree = JSON.parse(readFileSync("example/tree.json", "utf8"));
const geometry = buildGeometry(tree, blocks);
const parts = partsOf(tree);

/** An arc that matches this tree exactly, as `npm run arc` would produce. */
const arc: Arc = buildArc(
  parts.map((_, i) => `arc sentence ${i + 1}`),
  tree,
  "example",
  FIXTURE_HASH,
);

describe("buildArc", () => {
  it("refuses a sentence count that doesn't match the parts", () => {
    expect(() => buildArc(["only one"], tree, "example", FIXTURE_HASH)).toThrow(/Refusing to guess/);
  });

  it("pairs each sentence with the part at the same index", () => {
    expect(arc.entries.map((e) => e.range)).toEqual(parts.map((p) => p.range));
  });
});

describe("buildArcColumn", () => {
  it("is null without an arc, so L0 falls back to the root", () => {
    expect(buildArcColumn(geometry, undefined)).toBeNull();
  });

  it("shares the parts' boundaries exactly", () => {
    const cells = buildArcColumn(geometry, arc)!;
    let row = 0;
    for (const part of geometry.cells[1]!) {
      expect(cells.get(row)?.rowSpan).toBe(part.rowSpan);
      expect(cells.get(row)?.node.id).toBe(part.node.id);
      row += part.rowSpan;
    }
  });

  /**
   * The one that would wreck the view rather than merely disappoint. A missing
   * `<td>` doesn't leave a gap in an HTML table — it pulls every later cell in
   * that row one column left, so a single unmatched part would silently slide
   * the prose under the Sections header for the rest of the article.
   */
  it("gives every part a cell even when the arc has no sentence for it", () => {
    const stale: Arc = { ...arc, entries: arc.entries.slice(0, 1) };
    const cells = buildArcColumn(geometry, stale)!;
    expect(cells.size).toBe(geometry.cells[1]!.length);
    expect([...cells.values()].reduce((n, c) => n + c.rowSpan, 0)).toBe(blocks.length);
    expect(cells.get(0)?.text).toBeDefined();
    expect([...cells.values()].filter((c) => c.text === undefined).length).toBe(
      parts.length - 1,
    );
  });

  /**
   * Node ids are positional (`n0007`) and a re-run of `npm run toc` renumbers
   * them, so matching on anything but the block range would hand every sentence
   * to a neighbouring part while still filling every cell.
   */
  it("drops an entry whose range no longer matches a part", () => {
    const moved: Arc = {
      ...arc,
      entries: arc.entries.map((e) => ({ ...e, range: [e.range[1], e.range[0]] as [string, string] })),
    };
    const cells = buildArcColumn(geometry, moved)!;
    expect([...cells.values()].every((c) => c.text === undefined)).toBe(true);
  });
});
