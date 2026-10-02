// @vitest-environment jsdom
/**
 * **↓ steps over a folded section rather than into it** — and a jump that
 * lands in one unfolds it. Both halves of the one rule that folding asks of
 * the rest of the reading view (docs/plans/261002e-collapsible-headings-and-fold-all.md
 * § Is it substantial): `scrollToBlock` reveals, so `useArrowNav` must not ask
 * it to go anywhere folded, or ↓ would unfold every section it met.
 *
 * The harness is tests/keynav-handled.test.ts's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { clearFoldArticle, isFolded, setFoldArticle, toggleFold } from "../src/web/fold.js";

const jumps: string[] = [];
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return { ...real, scrollToBlock: (id: string) => void jumps.push(id) };
});

const { useArrowNav } = await import("../src/web/keynav.js");
type NavPlan = import("../src/web/keynav.js").NavPlan;

const block = (i: number, heading = false): Block => ({
  id: `spya-b${i}` as BlockId,
  tag: heading ? "h2" : "p",
  kind: heading ? "heading" : "text",
  ...(heading ? { level: 2 } : {}),
  text: `block ${i}`,
  words: 20,
  html: "<p></p>",
  gistable: true,
});

/* b0 heading, b1 b2 under it, b3 heading, b4 under it. */
const blocks = [block(0, true), block(1), block(2), block(3, true), block(4)];
const plan: NavPlan = { starts: [[0, 1, 2, 3, 4]] };

let container: HTMLDivElement;
let root: Root;

function Harness() {
  useArrowNav(plan, blocks, 0);
  return null;
}

beforeEach(async () => {
  jumps.length = 0;
  setFoldArticle("slug", blocks);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearFoldArticle();
});

function down(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  });
}

describe("↓ and a folded section", () => {
  it("steps into the section when it is open (the control)", () => {
    down();
    expect(jumps).toEqual(["spya-b1"]);
  });

  it("steps over it to the next visible row when it is folded", () => {
    toggleFold("spya-b0" as BlockId);
    down();
    expect(jumps).toEqual(["spya-b3"]);
  });
});

describe("a folded row is never where the reader is", () => {
  it("is skipped by activeSectionIndex even when it ties last", async () => {
    const { activeSectionIndex } = await import("../src/web/position.js");
    /* Row 0 visible; rows 1–2 a folded last section, sitting at the bottom of
       row 0 with no visible row after them to break the tie. */
    const tops = [0, 50, 50];
    expect(activeSectionIndex(tops, 100)).toBe(2);
    expect(activeSectionIndex(tops, 100, (i) => i > 0)).toBe(0);
  });

  it("chooses the first visible sparse start, and has no answer when all starts are folded", async () => {
    const { activeSectionIndex } = await import("../src/web/position.js");
    const tops = [50, 150, 250];
    expect(activeSectionIndex(tops, 100, (i) => i === 0)).toBe(1);
    expect(activeSectionIndex(tops, 100, () => true)).toBe(-1);
  });

  it("is never on screen, so an 'already there' check cannot skip the jump that unfolds it", async () => {
    const { isBlockOnScreen, whereIsBlock } =
      await vi.importActual<typeof import("../src/web/scroll.js")>("../src/web/scroll.js");
    globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
    const table = document.createElement("table");
    table.innerHTML = '<tbody><tr data-block="spya-b2"><td class="text">x</td></tr></tbody>';
    document.body.append(table);
    try {
      /* jsdom's zero rectangle is inside the viewport — the shape a folded
         row has in a browser — so the control is that it counts as here. */
      expect(isBlockOnScreen("spya-b2")).toBe(true);
      expect(whereIsBlock("spya-b2")).toBe("here");
      toggleFold("spya-b0" as BlockId);
      expect(isBlockOnScreen("spya-b2")).toBe(false);
      expect(whereIsBlock("spya-b2")).toBe("away");
    } finally {
      table.remove();
    }
  });
});

describe("a jump into a folded section", () => {
  it("unfolds it before the scroll measures the row", async () => {
    const { scrollToBlock } =
      await vi.importActual<typeof import("../src/web/scroll.js")>("../src/web/scroll.js");
    /* jsdom has no `CSS.escape`; the shim tests/block-flash.test.ts uses. */
    globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
    toggleFold("spya-b0" as BlockId);
    expect(isFolded("spya-b2")).toBe(true);
    scrollToBlock("spya-b2", "auto");
    expect(isFolded("spya-b2")).toBe(false);
  });
});
