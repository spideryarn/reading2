// @vitest-environment jsdom
/**
 * **The card actually opens on a Structure row, and only on the rows the reader
 * can see.**
 *
 * `tests/structure-card.test.ts` decides *what* a card is allowed to say, with
 * no DOM. This file asks the one question a reader asks — after resting the
 * pointer on a row, is there a card — and the one question the projection cannot
 * answer: whether the **measuring copies** got tooltips too.
 *
 * That second one is the reason this file exists rather than being three more
 * cases over there. `StructurePanel` renders every row **twice**: once
 * `aria-hidden`, out of flow, as the full unwindowed list whose heights the
 * capacity walk reads, and once visibly. A `<Tooltip>` on `Row` without a way to
 * turn it off would put tens of extra Floating UI instances behind
 * `aria-hidden="true"`, each with an `aria-describedby` pointing at a panel a
 * screen reader is told to ignore — and nothing would report it, because the
 * visible cards would work perfectly.
 *
 * **What jsdom cannot say here.** No layout, so every height is 0 and the
 * capacity stays unmeasured, which is why both columns draw whole below. Whether
 * the wrapper changed a measured row's box — the claim that matters most and the
 * one this panel's history is made of — is a browser question
 * (docs/project/browser-testing.md).
 *
 * docs/plans/260916b-rich-tooltips-on-structure-mode-rows.md
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StructurePanel } from "../src/web/StructurePanel.js";
import { buildGeometry, buildSummaryTree } from "../src/web/tree.js";
import type { Block, BlockId, NodeId, Tree, TreeNode } from "../src/types.js";

/** Past `DELAY.open` (240ms) in Tooltip.tsx, with room to spare. */
const AFTER_THE_OPEN_DELAY = 500;
/** Past the 80ms exit transition, so a card being torn down is not miscounted. */
const AFTER_THE_CLOSE_DELAY = 300;

/**
 * Two parts, each with two sections, so there is a part the reader is **not**
 * in — which is the only kind of part whose card has anything to offer.
 */
function fixture(): { tree: Tree; blocks: Block[] } {
  const nodes: Record<NodeId, TreeNode> = {};
  const blocks: Block[] = [];
  const id = (n: number) => `spya-c${String(n).padStart(4, "0")}` as BlockId;
  let b = 0;

  const block = () => {
    blocks.push({
      id: id(b),
      tag: "p",
      kind: "text",
      text: `block ${b}`,
      words: 40,
      html: `<p>block ${b}</p>`,
      gistable: true,
    });
    return b++;
  };

  const part = (key: string, title: string, gist: string, sectionTitles: string[]) => {
    const first = b;
    const sectionIds: NodeId[] = [];
    sectionTitles.forEach((st, i) => {
      const s0 = block();
      const s1 = block();
      const sid = `${key}-s${i}` as NodeId;
      nodes[sid] = {
        id: sid,
        depth: 2,
        parent: key as NodeId,
        children: [],
        range: [id(s0), id(s1)],
        title: st,
        gist: `What ${st} establishes.`,
      };
      sectionIds.push(sid);
    });
    nodes[key as NodeId] = {
      id: key as NodeId,
      depth: 1,
      parent: "n-r" as NodeId,
      children: sectionIds,
      range: [id(first), id(b - 1)],
      title,
      gist,
    };
    return first;
  };

  const p1First = part("n-p1", "PART ONE TITLE", "WHAT PART ONE ESTABLISHES.", [
    "ONE ALPHA",
    "ONE BETA",
  ]);
  part("n-p2", "PART TWO TITLE", "WHAT PART TWO ESTABLISHES.", ["TWO ALPHA", "TWO BETA"]);
  /* A second part the reader is not in, so two rows have cards — what the
     group test at the end needs. */
  part("n-p3", "PART THREE TITLE", "WHAT PART THREE ESTABLISHES.", ["THREE ALPHA", "THREE BETA"]);

  nodes["n-r" as NodeId] = {
    id: "n-r" as NodeId,
    depth: 0,
    parent: null,
    children: ["n-p1" as NodeId, "n-p2" as NodeId, "n-p3" as NodeId],
    range: [id(0), id(b - 1)],
    title: "Root",
    gist: "The root's gist.",
  };

  void p1First;
  return { tree: { version: "1", generator: "test", slug: "t", rootId: "n-r", nodes }, blocks };
}

const { tree, blocks } = fixture();
const geometry = buildGeometry(tree, blocks);
const summaryRoot = buildSummaryTree(tree, blocks, geometry.leafDepth);

/* The reader stands in part two, so PART ONE is the part with a card. Derived
   from the fixture rather than written as a number, so a change to part one's
   length cannot quietly move the reader and leave every assertion passing about
   the wrong row. */
const IN_PART_TWO = blocks.findIndex((x) => x.id === tree.nodes["n-p2" as NodeId]?.range[0]);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let reactRoot: Root;

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  reactRoot = createRoot(host);
});

afterEach(() => {
  act(() => reactRoot.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render() {
  act(() => {
    reactRoot.render(
      <StructurePanel
        root={summaryRoot}
        focusRow={IN_PART_TWO}
        allowParagraphs={true}
        onJump={() => {}}
      />,
    );
  });
}

/**
 * The buttons of the **visible** column A.
 *
 * `:scope > .struct-side` and not `.struct-side`: the measuring copies are a
 * direct child of the grid, come first in the DOM, and an unscoped query would
 * hand back the hidden list — over which every assertion in this file would pass
 * while the reader saw nothing. The same trap
 * tests/structure-panel-draws-both-columns.test.tsx documents.
 */
function visibleColumnA(): HTMLElement[] {
  const side = host.querySelector(".struct-grid > .struct-side");
  return [...(side?.querySelectorAll<HTMLElement>(".struct-row") ?? [])];
}

function measuringRows(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>(".struct-measure .struct-row")];
}

/**
 * A **native** `mouseenter`. `useHover` binds straight to the DOM reference
 * rather than through React's delegation, so a synthetic event would never reach
 * it and the test would go green for the wrong reason.
 */
function hover(el: HTMLElement | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  act(() => {
    /* Past the group's 400ms instant-phase timeout as well as its close delay:
       a card that disappears just after the click is still a failed tap. */
    vi.advanceTimersByTime(1_000);
  });
}

const cards = () => document.querySelectorAll(".tooltip");

function rowNamed(rows: HTMLElement[], text: string): HTMLElement {
  const found = rows.find((r) => r.querySelector(".struct-text")?.textContent === text);
  if (!found) {
    const had = rows.map((r) => r.querySelector(".struct-text")?.textContent).join(", ");
    throw new Error(`no row "${text}" — rows were: ${had}`);
  }
  return found;
}

it("opens a card carrying the gist of a part the reader is not standing in", () => {
  render();
  hover(rowNamed(visibleColumnA(), "PART ONE TITLE"));
  expect(cards()).toHaveLength(1);
  const text = cards()[0]?.textContent ?? "";
  expect(text).toContain("WHAT PART ONE ESTABLISHES.");
  /* And what is inside it, which is the half the panel cannot show for any part
     but the current one — column B is the current part's sections and nobody
     else's. */
  expect(text).toContain("ONE ALPHA");
  expect(text).toContain("ONE BETA");
});

/**
 * **The row the reader is on has the least to say.** Its gist is printed on the
 * row by rung 2 and its sections fill column B, so there is nothing left — and
 * a card that says only what is already on screen is worse than no card
 * (docs/project/tooltips.md).
 */
it("opens nothing on the current part, whose gist and sections are both drawn", () => {
  render();
  hover(rowNamed(visibleColumnA(), "PART TWO TITLE"));
  expect(cards()).toHaveLength(0);
});

/**
 * The hidden copies exist to be measured and for no other reason. A tooltip on
 * one is an instance nobody can open, behind `aria-hidden="true"`, pointing an
 * `aria-describedby` at a panel the accessibility tree has been told to ignore.
 */
it("puts no tooltip on the measuring copies", () => {
  render();
  const hidden = measuringRows();
  expect(hidden.length).toBeGreaterThan(0);
  hover(rowNamed(hidden, "PART ONE TITLE"));
  expect(cards()).toHaveLength(0);
});

/**
 * **A finger's first tap opens the card; the second goes there** — the rule in
 * docs/project/touch.md, which these cards lacked until 2026-10-03 (Greg,
 * spya-a868zs; plan 261003c). Replay the whole iPad-shaped stream: touch
 * pointer hover and lift events, compatibility mouse events, then the click,
 * which says `mouse` on iOS 18.2 and later (WebKit bug 282988). Leaving those
 * middle events out is the class of synthetic test that missed the glossary
 * card closing itself after every tap (touch.md).
 */
function fire(el: Element, type: string, pointerType: string, detail = 1) {
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: type !== "pointerleave",
      cancelable: true,
      detail,
      pointerType,
      pointerId: 1,
    }),
  );
}

function tap(el: Element, down: "touch" | "mouse", click = "mouse") {
  act(() => {
    if (down === "touch") {
      fire(el, "pointerover", "touch");
      fire(el, "pointerdown", "touch");
      fire(el, "pointerup", "touch");
      fire(el, "pointerout", "touch");
      fire(el, "pointerleave", "touch");
      el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseenter"));
      el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    } else {
      fire(el, "pointerdown", "mouse");
      fire(el, "pointerup", "mouse");
    }
    fire(el, "click", click);
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
}

function renderCounting(): BlockId[] {
  const jumps: BlockId[] = [];
  act(() => {
    reactRoot.render(
      <StructurePanel
        root={summaryRoot}
        focusRow={IN_PART_TWO}
        allowParagraphs={true}
        onJump={(id) => jumps.push(id)}
      />,
    );
  });
  return jumps;
}

it("on a finger, the first tap on a row opens its card and the second goes there", () => {
  const jumps = renderCounting();
  const row = rowNamed(visibleColumnA(), "PART ONE TITLE");
  tap(row, "touch");
  expect(jumps, "the first tap reads the row, it does not move the article").toHaveLength(0);
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.textContent).toContain("WHAT PART ONE ESTABLISHES.");
  expect(cards()[0]?.textContent).toContain("Tap again to go here");
  tap(row, "touch");
  expect(jumps).toHaveLength(1);
});

it("a mouse click goes there at once, and its card never says tap again", () => {
  const jumps = renderCounting();
  const row = rowNamed(visibleColumnA(), "PART ONE TITLE");
  hover(row);
  expect(cards()[0]?.textContent ?? "").not.toContain("Tap again");
  tap(row, "mouse");
  expect(jumps).toHaveLength(1);
});

it("a keyboard's click goes there at once", () => {
  const jumps = renderCounting();
  const row = rowNamed(visibleColumnA(), "PART ONE TITLE");
  act(() => {
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
  });
  expect(jumps).toHaveLength(1);
});

it("a row with no card goes there on the first tap", () => {
  const jumps = renderCounting();
  tap(rowNamed(visibleColumnA(), "PART TWO TITLE"), "touch");
  expect(jumps).toHaveLength(1);
  expect(cards()).toHaveLength(0);
});

it("a scroll closes a card a finger opened", () => {
  renderCounting();
  tap(rowNamed(visibleColumnA(), "PART ONE TITLE"), "touch");
  expect(cards()).toHaveLength(1);
  act(() => {
    host.dispatchEvent(new Event("scroll"));
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(0);
});

/**
 * **Two rows in the one real `TooltipGroup`** — the class a single-row test
 * cannot see (docs/postmortems/260828g-spine-hover-cards.md): a group closes
 * every other member when one opens, and a close that lands on the wrong row's
 * state takes the new card away. Each row owns its state here, so moving a
 * finger from one row to the next must leave the second open and its second
 * tap must still jump. GPT Sol, plan review of 261003c.
 */
it("a finger moving from one row's card to another's keeps the second, and its second tap goes there", () => {
  const jumps = renderCounting();
  const a = rowNamed(visibleColumnA(), "PART ONE TITLE");
  const b = rowNamed(visibleColumnA(), "PART THREE TITLE");
  /* No `hover` first: it leaves its card open in jsdom (there is no
     `mouseleave`), and a press that begins with the card open commits by
     design (useTapReveal.ts) — which a finger, that never hovers, cannot do. */
  tap(a, "touch");
  tap(b, "touch");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(jumps).toHaveLength(0);
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.textContent).toContain("Tap again to go here");
  tap(b, "touch");
  expect(jumps).toHaveLength(1);
});
