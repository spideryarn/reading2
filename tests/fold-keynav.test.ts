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

/**
 * **The masthead's echo is hidden and is not a fold** (fold.ts § `isFoldedAway`;
 * Greg, spya-t6cdve;
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md).
 * Block 0 is the echo and is also where the first section starts, so ↑ must
 * still be able to ask for it: `scrollToBlock` then goes to the top of the
 * page (below). Filtered out like a folded start, ↑ from inside the first
 * section had nowhere to go.
 */
describe("↑ and the masthead's echo", () => {
  const up = () =>
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    });
  /* Sections start at b0 (the echo heading) and b3. */
  const sections: NavPlan = { starts: [[0, 3]] };
  function BySection() {
    useArrowNav(sections, blocks, 0);
    return null;
  }

  /** The reader on row `at`: every row before it above the line, the echo rows with no height. */
  function standOn(at: number, echo: number): () => void {
    const table = document.createElement("table");
    table.innerHTML = `<tbody>${blocks.map((b) => `<tr data-block="${b.id}"><td></td></tr>`).join("")}</tbody>`;
    document.body.append(table);
    const rows = [...table.querySelectorAll("tr")];
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const i = rows.indexOf(this as HTMLTableRowElement);
      const top = i < 0 ? 0 : (Math.max(i, echo) - at) * 100;
      return { top, bottom: top + (i < echo ? 0 : 100), height: i < echo ? 0 : 100 } as DOMRect;
    });
    return () => {
      spy.mockRestore();
      table.remove();
    };
  }

  it("reaches the start of the first section from inside it", async () => {
    setFoldArticle("slug", blocks, new Set(["spya-b0" as BlockId]));
    const leave = standOn(2, 1);
    await act(async () => root.render(createElement(BySection)));
    try {
      up();
      expect(jumps).toEqual(["spya-b0"]);
    } finally {
      leave();
    }
  });

  it("still has nowhere to go when that start is folded away (the control)", async () => {
    /* b1 to b4 under one folded heading, and a plan whose starts are all inside it. */
    const under: NavPlan = { starts: [[1, 4]] };
    function Under() {
      useArrowNav(under, blocks, 0);
      return null;
    }
    const all = blocks.map((b, i) => (i === 3 ? block(3) : b));
    setFoldArticle("slug", all);
    toggleFold("spya-b0" as BlockId);
    await act(async () => root.render(createElement(Under)));
    up();
    down();
    expect(jumps).toEqual([]);
  });

  it("ends at the top of the page: the jump to an echo row measures no row", async () => {
    const real = await vi.importActual<typeof import("../src/web/scroll.js")>("../src/web/scroll.js");
    globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
    setFoldArticle("slug", blocks, new Set(["spya-b0" as BlockId]));
    const leave = standOn(2, 1);
    let y = 300;
    /* Tall enough to scroll: `scrollToBlock` clamps to the page, and jsdom's
       zero-height document would send every destination to 0. */
    const tall = vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
    const scrollY = vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((o: ScrollToOptions) => {
      y = o.top ?? y;
    }) as typeof window.scrollTo);
    try {
      const outcomes: string[] = [];
      real.scrollToBlock("spya-b0", "auto", (o) => outcomes.push(o));
      expect(y).toBe(0);
      /* The control: a visible row is measured, and it is not at the top. */
      real.scrollToBlock("spya-b3", "auto");
      expect(y).not.toBe(0);
      real.scrollToBlock("spya-b0", "auto", (o) => outcomes.push(o), { align: "centre" });
      expect(y).toBe(0);
      expect(real.arrivalAnchor()).toBeNull();
      real.abandonScroll();
      expect(isFolded("spya-b0")).toBe(true);
    } finally {
      real.abandonScroll();
      scrollTo.mockRestore();
      tall.mockRestore();
      scrollY.mockRestore();
      leave();
    }
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

/**
 * **`measureRow` answers row 0 when no row can**, which its callers assume
 * (jump-history.ts, ReturnChip.tsx, DiagramPanel's `measuredRow ?? atRow`).
 * Folding taught `activeSectionIndex` to answer -1 when handed a `skip` and no
 * eligible row, and that -1 reached DiagramPanel as a real row, so its footer
 * card described nothing — caught by diagram-panel-hover.test.tsx.
 */
describe("measureRow with nothing to measure", () => {
  it("answers 0 rather than -1 when the page has no article rows", async () => {
    const { measureRow } = await import("../src/web/keynav.js");
    document.body.innerHTML = "";
    expect(measureRow()).toBe(0);
  });
});
