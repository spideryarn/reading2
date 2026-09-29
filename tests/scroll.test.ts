/**
 * The pure half of scrolling — see src/web/scroll.ts.
 *
 * Pure decisions from scroll.ts live here; everything else in that file
 * measures the DOM or drives an animation, which this repo checks by hand
 * (docs/project/testing.md).
 */
import { describe, expect, it } from "vitest";
import { alignedOffset, arrivalTarget } from "../src/web/scroll.js";

/**
 * Where a pasted link lands — see src/web/scroll.ts § arrivalTarget.
 *
 * This is the arithmetic of a bug that needed no browser to find.
 * `/read/<slug>?note=<id>` opened the
 * dialog and left the passage it is about somewhere off screen, because `?at=`
 * was the only parameter that moved the page.
 */
const NOTE = "spya-k3m9qt";
const PASSAGE = "spya-p7w2dn";
const ELSEWHERE = "spya-tgnssb";
const COMMENTS = [
  { id: NOTE, blockId: PASSAGE },
  { id: "spya-h4r2wd", blockId: ELSEWHERE },
];

describe("arrivalTarget", () => {
  it("scrolls to the note's passage when the link carries no position", () => {
    // The bug. Before the fix this returned null, which is the top of the
    // article — a dialog about a paragraph the reader cannot see.
    expect(arrivalTarget(null, NOTE, COMMENTS)).toBe(PASSAGE);
  });

  it("lets the note beat a position that disagrees with it", () => {
    expect(arrivalTarget(ELSEWHERE, NOTE, COMMENTS)).toBe(PASSAGE);
  });

  it("is the position when there is no note", () => {
    expect(arrivalTarget(ELSEWHERE, null, COMMENTS)).toBe(ELSEWHERE);
    expect(arrivalTarget(null, null, COMMENTS)).toBe(null);
  });

  it("falls back to the position when the note names nothing we have", () => {
    // Two cases in one: the comments have not arrived yet, and the comment was
    // deleted. Neither is a reason to strand the reader at the top.
    expect(arrivalTarget(ELSEWHERE, NOTE, [])).toBe(ELSEWHERE);
    expect(arrivalTarget(null, "spya-999999", COMMENTS)).toBe(null);
  });
});

/* Plan 260929a § 3 (SPIDERYARN-READING2-4M): where a jump lands. */
describe("alignedOffset", () => {
  const base = { bar: 50, dock: 0, viewportH: 850, max: 10_000 };
  it("puts a top-aligned thing just under the bar", () => {
    expect(alignedOffset({ ...base, top: 2000, height: 100, align: "top" })).toBe(1950);
  });
  it("centres a thing that fits in the free area between the bar and the dock", () => {
    /* Free area 800; a 100px thing has 350 above it: 2000 - 50 - 350. */
    expect(alignedOffset({ ...base, top: 2000, height: 100, align: "centre" })).toBe(1600);
    /* A dock takes its height off the bottom of the free area. */
    expect(alignedOffset({ ...base, dock: 100, top: 2000, height: 100, align: "centre" })).toBe(1650);
  });
  it("puts a thing taller than the free area at the top, not its middle", () => {
    expect(alignedOffset({ ...base, top: 2000, height: 900, align: "centre" })).toBe(1950);
  });
  it("clamps to the page at both ends", () => {
    expect(alignedOffset({ ...base, top: 100, height: 20, align: "centre" })).toBe(0);
    expect(alignedOffset({ ...base, top: 20_000, height: 20, align: "centre" })).toBe(10_000);
  });
});
