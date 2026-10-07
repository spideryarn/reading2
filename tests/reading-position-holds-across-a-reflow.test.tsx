// @vitest-environment jsdom
/**
 * **Turn the phone and you are still reading the same section.**
 *
 * Sentry SPIDERYARN-READING2-41, 2026-09-12 — Greg: *"if I switch from portrait
 * to landscape or if I click on things, it takes me to other bits of the
 * article and I sort of lose my place."* The clicks are the return chip's half
 * (tests/return-chip.test.tsx); the rotation is this one, and it is **not** a
 * jump — nothing moved the reader, the article moved underneath them — so no
 * chip can answer it. Stage 3 of
 * docs/plans/260916a-back-to-where-you-were-survives-a-mode-change.md.
 *
 * ## What the browser does, and what we used to do on top of it
 *
 * A rotation keeps `window.scrollY` in **pixels** and reflows the prose to a
 * new measure, so the pixel the reader was looking at is now a different
 * paragraph. `useReadingPosition`'s spy effect is keyed on `layoutKey`, which
 * carries the window width (Reader.tsx), and calls `measure()` the moment it
 * re-runs — so the app's response to a reflow was to *write down where the
 * reflow had left the reader*, overwriting the one record of where they had
 * been. The reader lost their place and the address agreed with the loss.
 *
 * The fix is the other way round: on a layout change the address is the truth
 * and the page is put back to it.
 *
 * ## How this is faked
 *
 * jsdom has no layout, so rects and the scroll offset are stubbed: every row is
 * `rowHeight` tall, `top` is `row * rowHeight - scrollY`, and `window.scrollTo`
 * moves `scrollY` the way a browser would. Changing `rowHeight` between renders
 * *is* the reflow — the same content at a different measure — which is exactly
 * what a rotation does to the prose column. `scrollHeight` is stubbed too, or
 * `scrollToBlock`'s clamp against a zero-height document would send every
 * destination to 0 and every assertion here would pass for the wrong reason.
 */
import { act, createElement, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import type { Section } from "../src/web/position.js";
import {
  abandonScroll,
  arrivalAnchor,
  clearArrivalAnchor,
  glideTarget,
  scrollToBlock,
} from "../src/web/scroll.js";
import {
  clearFoldArticle,
  isFolded,
  setFoldArticle,
  toggleFold,
  toggleFrontMatter,
  useFoldArticle,
} from "../src/web/fold.js";
import { useReadingPosition } from "../src/web/reader/useReadingPosition.js";

enableHistorySync();

/* React's own switch for `act`, which vitest does not set — the same two lines
   every component test here opens with. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom has no `CSS.escape`, which `blockRow` uses to build its selector. Block
   ids are `spya-` plus base32 (docs/project/block-ids.md), so identity is the
   honest stand-in — tests/scroll-glide.test.ts does the same. */
globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;

/* The alphabet src/ids.ts mints from, so `?at=` parses these rather than
   dropping them — a rejected id would make every assertion here vacuous. */
const DIGITS = "abcdefghjk";
const block = (row: number) =>
  `spya-para${String(row)
    .padStart(2, "0")
    .split("")
    .map((d) => DIGITS.charAt(Number(d)))
    .join("")}` as BlockId;

const ROWS = 30;
const BLOCKS: Block[] = Array.from({ length: ROWS }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));

/** Three sections, so that crossing a boundary is observable. */
const SECTIONS: Section[] = [
  { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Where it opens", titleVoice: "ai" },
  { row: 12, blockId: block(12), nodeId: "n0002" as NodeId, title: "The middle bit", titleVoice: "ai" },
  { row: 24, blockId: block(24), nodeId: "n0003" as NodeId, title: "How it ends", titleVoice: "ai" },
];

/* ------------------------------------------------------- the fake viewport -- */

const PORTRAIT = 100;
/** Narrower measure, fewer lines per paragraph: the same article, shorter. */
const LANDSCAPE = 40;

let rowHeight = PORTRAIT;
let scrollY = 0;
/** How many leading rows are the masthead's echo: drawn with no height. */
let echoRows = 0;
let scrollTo: ReturnType<typeof vi.fn>;

function rowIndexOf(el: Element): number | null {
  const id = (el as HTMLElement).dataset?.block;
  if (id === undefined) return null;
  const i = BLOCKS.findIndex((b) => b.id === id);
  return i === -1 ? null : i;
}

let host: HTMLDivElement;
let root: Root;

/** The hook under test, with `layoutKey` driven from a prop. */
function Harness({ layoutKey, sections }: { layoutKey: string; sections: Section[] }): ReactNode {
  useReadingPosition(sections, BLOCKS, layoutKey);
  return null;
}

function render(layoutKey: string, sections: Section[] = SECTIONS): void {
  act(() =>
    root.render(createElement(NuqsAdapter, null, createElement(Harness, { layoutKey, sections }))),
  );
}

/** Let nuqs's 300ms position debounce flush, and React settle after it. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

/** Let a scroll-frame measurement run without letting the 300ms URL write land. */
async function measureFrame(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 32));
  });
}

const atNow = () => new URLSearchParams(location.search).get("at");

beforeEach(() => {
  rowHeight = PORTRAIT;
  scrollY = 0;
  echoRows = 0;

  document.body.replaceChildren();
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (const b of BLOCKS) {
    const tr = document.createElement("tr");
    tr.dataset.block = b.id;
    tbody.append(tr);
  }
  table.append(tbody);
  document.body.append(table);

  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const i = rowIndexOf(this);
    /* A hidden row has no height and sits at the top of the next visible one
       (fold.ts § Why the cells are hidden): the masthead's echo, below. */
    const echo = i !== null && i < echoRows;
    const height = echo ? 0 : rowHeight;
    const top = i === null ? 0 : (echo ? echoRows : i) * rowHeight - scrollY;
    return { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockImplementation(
    () => ROWS * rowHeight,
  );
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => scrollY });
  /* **Short enough that every row here is reachable.** `scrollToBlock` clamps
     its destination to `scrollHeight - innerHeight` (scroll.ts), so a tall
     viewport over a short landscape document would clamp the deepest
     destination and the assertion would read as a broken anchor rather than as
     a fixture that cannot hold the position it asks about. */
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 200 });
  scrollTo = vi.fn((arg: unknown) => {
    const top = typeof arg === "object" && arg !== null ? (arg as ScrollToOptions).top : arg;
    if (typeof top === "number") scrollY = top;
    window.dispatchEvent(new Event("scroll"));
  });
  Object.defineProperty(window, "scrollTo", { configurable: true, value: scrollTo });

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  /* **A glide is module state in scroll.ts, not component state**, so one left
     running by a test that deliberately starts one goes on calling
     `window.scrollTo` inside the *next* test's fixture. Found by mutating the
     anchor and watching an unrelated case go red beside the intended one —
     which is the failure looking like signal, and exactly what an isolation
     leak does to a mutation check. */
  abandonScroll();
  clearArrivalAnchor();
  clearFoldArticle();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ tests -- */

describe("a reflow under a reader who is staying put", () => {
  /**
   * The case from the report. In portrait the reader is in § The middle bit;
   * at the landscape measure the very same `scrollY` is past the start of
   * § How it ends, so the spy — left to itself — writes that down and the
   * section the reader was in is gone from the only place it was recorded.
   */
  it("keeps ?at= naming the section the reader was in", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();
    expect(atNow()).toBe(block(12));

    /* The rotation: the same scroll offset, a shorter article. */
    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();

    expect(atNow()).toBe(block(12));
  });

  /** And the reader is actually moved back to it, not merely described as
      being there — an address that disagrees with the page is the same bug
      wearing the other face. */
  it("puts the page back under the block ?at= names", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();
    scrollTo.mockClear();

    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();

    expect(scrollTo).toHaveBeenCalled();
    /* No sticky bar in this DOM, so the destination is the row's own document
       top: 12 rows at the landscape measure. */
    expect(scrollY).toBe(12 * LANDSCAPE);
  });

  /**
   * The spy records its answer in `synced` before nuqs's 300ms debounce puts
   * it in the address. A rotation inside that window must hold the newer
   * measured section, not pull the reader back to the older `?at=` and then
   * let the restarted spy overwrite the queued answer.
   */
  it("keeps a position the spy measured before its URL write has landed", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();

    scrollY = 24 * PORTRAIT;
    window.dispatchEvent(new Event("scroll"));
    await measureFrame();
    expect(atNow(), "the position write should still be queued").toBe(block(12));

    rowHeight = LANDSCAPE;
    render("landscape");
    expect(scrollY).toBe(24 * LANDSCAPE);

    await settle();
    expect(atNow()).toBe(block(24));
  });

  /**
   * **Not on the first render.** Arrival belongs to the restore effect, which
   * has just scrolled to `?at=` itself; a second mover here would be two
   * things scrolling the same page on mount, and the pair would disagree the
   * moment either changed.
   */
  it("does not scroll twice on arrival", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  /**
   * **When the address moved too, this is not the mover.**
   *
   * A Back or Forward step can change `?at=` *and* the layout in one commit —
   * the reader jumped from a mode, pressed Back, and the mode going away
   * changes `layoutKey`. The restore effect owns that move, because it owns
   * arrival, Back, Forward and pasted links alike. Two movers on one page would
   * disagree the moment either changed, and the first draft of this guard —
   * "skip the first render" — would not have caught it, because the render in
   * question is not the first. GPT Sol's fourth finding on the plan, 2026-09-16.
   *
   * One scroll, not two, is the whole assertion.
   */
  it("leaves the move to the restore effect when ?at= changed as well", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();
    scrollTo.mockClear();

    /* Both at once, as a history traversal out of a mode delivers them. */
    history.replaceState(null, "", `/read/x?at=${block(24)}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollY).toBe(24 * LANDSCAPE);
  });

  /**
   * **A reflow during a jump, which is the same bug one layer down.**
   *
   * `scrollToBlock` works out a destination in **pixels** and hands it to
   * `glide`, which spends about 200ms travelling to that number. Reflow the
   * article mid-flight and the number describes a layout that no longer exists,
   * so the glide lands somewhere arbitrary and the spy writes *that* down.
   *
   * The plan's first draft made this worse rather than better, by skipping the
   * re-anchor whenever a glide was in flight — which is exactly when the stale
   * number needs overriding. GPT Sol's second finding, 2026-09-16. So a layout
   * change abandons the glide first and then moves instantly: no pixel is left
   * to land on.
   */
  it("abandons a glide whose destination the reflow has invalidated", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();

    /* A jump in flight, aimed at a pixel measured in the portrait layout.
       `scrollY` is moved back to the top **first**, because `glide` returns
       early when the destination is less than a pixel away — and after
       `settle()` the page is already sitting on it, so a glide started from
       there would never begin and the test would pass without exercising
       anything. */
    scrollY = 0;
    scrollToBlock(block(12), "smooth");
    expect(glideTarget()).not.toBeNull();

    rowHeight = LANDSCAPE;
    render("landscape");

    expect(glideTarget()).toBeNull();
    expect(scrollY).toBe(12 * LANDSCAPE);
  });

  /**
   * **The case that makes `abandonScroll` more than a tidy-up.**
   *
   * Every path of `scrollToBlock` cancels an in-flight glide except one:
   * `if (!row) return`, a `?at=` naming a block this article no longer has
   * after a re-extraction. Without the explicit abandon, that is a stale pixel
   * destination with nothing left to stop it — so the reader, having rotated,
   * would be carried off to a position measured in the layout they had just
   * left, by a jump they could no longer see the target of.
   */
  it("abandons the glide even when ?at= names a block that has gone", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    render("portrait");
    await settle();

    scrollY = 0;
    scrollToBlock(block(12), "smooth");
    expect(glideTarget()).not.toBeNull();

    /* The article is re-extracted under the reader: the row `?at=` names is no
       longer in the table, so `scrollToBlock` will decline to move at all. */
    document.querySelector(`tr[data-block="${block(12)}"]`)?.remove();

    rowHeight = LANDSCAPE;
    render("landscape");

    expect(glideTarget()).toBeNull();
  });

  /**
   * **And nothing to hold at the top of the article.** No `?at=` means the
   * reader is above the first section, which is where the browser's own scroll
   * restoration is already right and where `positionToWrite` deliberately
   * writes nothing.
   */
  it("leaves a reader at the top alone", async () => {
    history.replaceState(null, "", "/read/x");
    render("portrait");
    await settle();
    scrollTo.mockClear();

    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(atNow()).toBeNull();
  });

  it("ends a centred arrival even when there is no ?at= to re-anchor", async () => {
    history.replaceState(null, "", "/read/x");
    render("portrait");
    await settle();

    /* Put block 12 exactly at its centred destination, so making the arrival
       creates no scroll event that could clear it for some other reason. */
    scrollY = 12 * PORTRAIT - (window.innerHeight - PORTRAIT) / 2;
    scrollToBlock(block(12), "smooth", undefined, { align: "centre" });
    expect(arrivalAnchor()).toEqual({ id: block(12), passage: undefined });

    rowHeight = LANDSCAPE;
    render("landscape");
    expect(arrivalAnchor()).toBeNull();
  });
});

/**
 * **The first section starts on a row the reader cannot see, and is still the
 * section they are in.** Block 0 is the start of the first section of every
 * article (tree.ts § `navigableItems` begins at row 0), and it is also the
 * masthead's echo, hidden through the fold store (Greg, spya-t6cdve). A fold
 * hides a whole section, so its start is skipped; an echo hides one row whose
 * section is on screen, and skipping it wrote `?at=` as the *next* section.
 * fold.ts § `isFoldedAway`;
 * docs/plans/261007b-the-title-is-drawn-once-and-the-masthead-loses-its-back-arrow.md.
 */
describe("an article whose first rows are the masthead's echo", () => {
  beforeEach(() => {
    echoRows = 2;
    setFoldArticle("x", BLOCKS, new Set([block(0), block(1)]));
  });

  it("writes ?at= as the first section while the reader is mid-way through it", async () => {
    history.replaceState(null, "", "/read/x");
    render("k");
    await settle();

    /* Row 5 at the line: past the echo, seven rows short of the second section. */
    window.scrollTo({ top: 5 * PORTRAIT });
    await settle();

    expect(atNow()).toBe(block(0));
  });

  it("still skips a section whose start a fold hides (the control)", async () => {
    /* Rows 13 to 29 under one folded heading at row 12: the last section's
       start is folded away, and the reader is past where it would be. */
    const folded = BLOCKS.map((b, i) =>
      i === 12 ? { ...b, kind: "heading", tag: "h2", level: 2 } : b,
    ) as Block[];
    setFoldArticle("x", folded);
    toggleFold(block(12));
    history.replaceState(null, "", "/read/x");
    render("k");
    await settle();
    window.scrollTo({ top: 26 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(12));
  });

  /* GPT Sol's C8 (code review of 261007d): the address may hold a paragraph a
     jump put there, and the spy leaves it standing while the reader is in its
     section. Folding a heading over that paragraph, inside the same section,
     changed nothing the spy compares, so the hidden id stayed and the next
     restore unfolded what the reader had just folded. */
  it("rewrites a paragraph the reader folds away, to the heading that folded it", async () => {
    const folded = BLOCKS.map((b, i) =>
      i === 13 ? { ...b, kind: "heading", tag: "h2", level: 2 } : b,
    ) as Block[];
    setFoldArticle("x", folded);
    history.replaceState(null, "", `/read/x?at=${block(15)}`);
    render("portrait");
    await settle();
    expect(atNow()).toBe(block(15));

    toggleFold(block(13));
    await settle();
    expect(isFolded(block(15))).toBe(true);
    expect(atNow()).toBe(block(13));

    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();
    expect(isFolded(block(15))).toBe(true);
  });

  it("arrives at the top of the page for ?at= naming an echo row", async () => {
    scrollY = 7 * PORTRAIT;
    history.replaceState(null, "", `/read/x?at=${block(0)}`);
    render("k");
    await settle();
    expect(scrollY).toBe(0);
  });
});

/**
 * **A section that starts inside the shut front matter** (front-matter.ts;
 * Greg, spya-duh4w3;
 * docs/plans/261007d-front-matter-folded-by-default-and-arxiv-html-authors.md
 * § Sections that start inside the run). Row 0 is the echo and rows 1 to 3 the
 * front matter, all four drawn at no height. A section whose first block is in
 * the run and which carries on past it is on screen, so it is the one named;
 * but `?at=` is restored through `scrollToBlock`, which opens the run for any
 * block of it. So it is named by its first *visible* block (fold.ts §
 * `visibleFrom`), and a reload or a turned phone leaves the front matter shut.
 */
describe("an article whose front matter is shut", () => {
  const section = (row: number, n: number): Section => ({
    row,
    blockId: block(row),
    nodeId: `n000${n}` as NodeId,
    title: `Section ${n}`,
    titleVoice: "ai",
  });
  /** The byline and the abstract as one section: it starts on row 2, hidden, and runs to row 11. */
  const SPANNING = [section(0, 1), section(2, 2), section(12, 3), section(24, 4)];
  /** A section that is rows 1 to 3 and nothing else: wholly hidden. */
  const WHOLLY = [section(0, 1), section(1, 2), section(4, 3), section(12, 4)];
  const front = [block(1), block(2), block(3)];

  beforeEach(() => {
    echoRows = 4;
    setFoldArticle("x", BLOCKS, new Set([block(0)]), front);
  });

  it("names the section the reader is in by its first visible block", async () => {
    history.replaceState(null, "", "/read/x");
    render("k", SPANNING);
    await settle();
    window.scrollTo({ top: 6 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(4));
    expect(isFolded(block(2))).toBe(true);
  });

  it("goes on naming it as the reader moves through it, and the next one after", async () => {
    history.replaceState(null, "", "/read/x");
    render("k", SPANNING);
    await settle();
    window.scrollTo({ top: 6 * PORTRAIT });
    await settle();
    window.scrollTo({ top: 9 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(4));
    window.scrollTo({ top: 13 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(12));
  });

  it("leaves the front matter shut when the phone is turned in that section", async () => {
    history.replaceState(null, "", "/read/x");
    render("portrait", SPANNING);
    await settle();
    window.scrollTo({ top: 6 * PORTRAIT });
    await settle();
    rowHeight = LANDSCAPE;
    render("landscape", SPANNING);
    await settle();
    expect(isFolded(block(2))).toBe(true);
    expect(atNow()).toBe(block(4));
  });

  it("never names a section that is wholly inside the run", async () => {
    history.replaceState(null, "", "/read/x");
    render("k", WHOLLY);
    await settle();
    window.scrollTo({ top: 5 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(4));
    expect(isFolded(block(1))).toBe(true);
  });

  it("opens the front matter for a link that names one of its blocks", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    render("k", SPANNING);
    await settle();
    expect(isFolded(block(2))).toBe(false);
    expect(isFolded(block(0))).toBe(true); // the echo stays
  });

  it("rewrites a front-matter position when the reader shuts the run", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    render("portrait", SPANNING);
    await settle();
    expect(isFolded(block(2))).toBe(false);

    toggleFrontMatter();
    await settle();
    expect(isFolded(block(2))).toBe(true);
    expect(atNow()).toBe(block(4));

    rowHeight = LANDSCAPE;
    render("landscape", SPANNING);
    await settle();
    expect(isFolded(block(2))).toBe(true);
  });
});

/**
 * **The run starts at block 0.** A web article imported since 649dc7828 has no
 * title heading, so its first block is the byline and the first section of the
 * article starts on a hidden row (front-matter.ts § Where it starts). No echo.
 * Rows 0 to 2 are the run. The first section is named by its first visible
 * block, never by a hidden one, and nothing but a link that names a run block
 * opens the run.
 */
describe("an article whose front matter starts at block 0", () => {
  const front = [block(0), block(1), block(2)];
  /** The first section is the run and nothing else. */
  const WHOLLY: Section[] = [
    { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Authors", titleVoice: "ai" },
    { row: 3, blockId: block(3), nodeId: "n0002" as NodeId, title: "Abstract", titleVoice: "ai" },
    { row: 12, blockId: block(12), nodeId: "n0003" as NodeId, title: "The middle bit", titleVoice: "ai" },
  ];

  beforeEach(() => {
    echoRows = 3;
    setFoldArticle("x", BLOCKS, new Set(), front);
  });

  it("names the first section by its first visible block", async () => {
    history.replaceState(null, "", "/read/x");
    render("k");
    await settle();
    expect(atNow()).toBeNull(); // the top of the page: nowhere yet
    window.scrollTo({ top: 6 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(3));
    expect(isFolded(block(0))).toBe(true);
  });

  it("never writes a hidden block, wherever the reader stops", async () => {
    history.replaceState(null, "", "/read/x");
    render("k");
    await settle();
    for (const row of [3, 4, 11, 13, 5, 3, 25, 4]) {
      window.scrollTo({ top: row * PORTRAIT });
      await settle();
      expect(front, `row ${row}`).not.toContain(atNow());
      expect(atNow(), `row ${row}`).toBe(row < 12 ? block(3) : row < 24 ? block(12) : block(24));
    }
    expect(isFolded(block(0))).toBe(true);
  });

  it("names the second section when the first is the run and nothing else", async () => {
    history.replaceState(null, "", "/read/x");
    render("k", WHOLLY);
    await settle();
    window.scrollTo({ top: 5 * PORTRAIT });
    await settle();
    expect(atNow()).toBe(block(3));
    expect(isFolded(block(0))).toBe(true);
  });

  it("leaves the run shut on a reload, and when the phone is turned", async () => {
    history.replaceState(null, "", `/read/x?at=${block(3)}`);
    render("portrait");
    await settle();
    expect(isFolded(block(0))).toBe(true);
    expect(atNow()).toBe(block(3));
    rowHeight = LANDSCAPE;
    render("landscape");
    await settle();
    expect(isFolded(block(0))).toBe(true);
    expect(atNow()).toBe(block(3));
  });

  it("opens the run for a link that names block 0", async () => {
    history.replaceState(null, "", `/read/x?at=${block(0)}`);
    render("k");
    await settle();
    expect(isFolded(block(0))).toBe(false);
    expect(isFolded(block(2))).toBe(false);
    expect(atNow()).toBe(block(0));
  });
});

/**
 * **A pasted link that names a run block opens the run, as the page mounts.**
 * The cases above hand the store its article before the hook mounts. In the
 * app the prose table does that from a layout effect, in the same commit as
 * this hook's restore effect (`useFoldArticle`, TableView.tsx), and in
 * development React's StrictMode then unmounts and remounts every effect once.
 * The restore effect does not scroll twice (`synced`), so a store that forgot
 * the run was open across that remount left the link pointing at a shut run,
 * and the spy then rewrote `?at=` to the first visible block. Seen in a
 * browser on the dev server, 2026-10-07 (fold.ts § `reopenFor`). Production
 * has no StrictMode, so there the link always opened the run.
 */
describe("a link that names a run block, with the table mounting beside the hook", () => {
  const front = [block(1), block(2), block(3)];
  const echo = new Set([block(0)]);

  function Table(): ReactNode {
    useFoldArticle("x", BLOCKS, echo, front);
    return null;
  }
  function Page(): ReactNode {
    useReadingPosition(SECTIONS, BLOCKS, "k");
    return createElement(Table);
  }
  /** The article arrives after the app is up, as it does over the wire: the
      address is already read when the reader mounts, so the restore effect
      runs in the mount commit, which is the one StrictMode repeats. */
  function mount(strict: boolean): void {
    const within = (page: ReactNode) =>
      createElement(NuqsAdapter, null, strict ? createElement(StrictMode, null, page) : page);
    act(() => root.render(within(null)));
    act(() => root.render(within(createElement(Page))));
  }

  beforeEach(() => {
    echoRows = 1;
  });

  it("opens the run and leaves the address on the block", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    mount(false);
    await settle();
    expect(isFolded(block(2))).toBe(false);
    expect(atNow()).toBe(block(2));
  });

  it("does so under StrictMode's remount too", async () => {
    history.replaceState(null, "", `/read/x?at=${block(2)}`);
    mount(true);
    await settle();
    expect(isFolded(block(2))).toBe(false);
    expect(isFolded(block(0))).toBe(true); // the echo stays
    expect(atNow()).toBe(block(2));
  });

  it("still arrives shut, under StrictMode, on a link that names no run block", async () => {
    history.replaceState(null, "", `/read/x?at=${block(12)}`);
    mount(true);
    await settle();
    expect(isFolded(block(2))).toBe(true);
    expect(atNow()).toBe(block(12));
  });
});
