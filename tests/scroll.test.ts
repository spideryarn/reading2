/**
 * The pure half of scrolling — see src/web/scroll.ts.
 *
 * Only `screenTarget` is here, and deliberately: everything else in that file
 * measures the DOM or drives an animation, which this repo checks by hand
 * (docs/project/testing.md). But the screenful step is five lines of
 * arithmetic that have already been wrong twice, in ways no browser was needed
 * to catch — so they are pinned.
 */
import { describe, expect, it } from "vitest";
import { arrivalTarget, screenTarget } from "../src/web/scroll.js";

/** A 900px viewport with a 84px header and a 40px dock: 776px of usable screen. */
const VIEW = 900;
const TOP = 84;
const DOCK = 40;
const MAX = 10_000;
const at = (from: number, dir: -1 | 1) =>
  screenTarget(from, VIEW, TOP, DOCK, MAX, dir);

describe("screenTarget", () => {
  it("moves one usable screen, not one viewport", () => {
    expect(at(1000, 1)).toBe(1776);
    expect(at(1000, -1)).toBe(224);
  });

  it("subtracts the bottom obstruction as well as the top", () => {
    // The bug this pins: with only the header subtracted the step is 816, and
    // the 40px behind the dock is skipped every time — invisibly, and worse the
    // more often you do it.
    expect(screenTarget(0, VIEW, TOP, 0, MAX, 1)).toBe(816);
    expect(screenTarget(0, VIEW, TOP, DOCK, MAX, 1)).toBe(776);
  });

  it("chains: two steps go exactly twice as far as one", () => {
    // `from` is the previous step's destination, not the animated position, so
    // repeated gestures cannot lose ground to an unfinished animation.
    const once = at(0, 1);
    expect(at(once, 1)).toBe(once * 2);
  });

  it("stops at the end of the article", () => {
    expect(at(MAX - 100, 1)).toBe(MAX);
    expect(at(MAX, 1)).toBe(MAX);
  });

  it("stops at the top", () => {
    expect(at(100, -1)).toBe(0);
    expect(at(0, -1)).toBe(0);
  });

  it("handles a document shorter than the viewport", () => {
    // `max` goes negative when the article does not fill the screen. Clamping
    // to it directly would scroll to a negative offset.
    expect(screenTarget(0, VIEW, TOP, DOCK, -300, 1)).toBe(0);
  });

  it("still moves when the furniture is taller than the viewport", () => {
    // Absurd, but reachable with a huge default font size — and a step of zero
    // or less would make the gesture dead, or send it the wrong way.
    expect(screenTarget(500, 100, 200, 200, MAX, 1)).toBe(501);
    expect(screenTarget(500, 100, 200, 200, MAX, -1)).toBe(499);
  });
});

/**
 * Where a pasted link lands — see src/web/scroll.ts § arrivalTarget.
 *
 * Pinned here for the same reason `screenTarget` is: it is the arithmetic of a
 * bug that needed no browser to find. `/read/<slug>?note=<id>` opened the
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
