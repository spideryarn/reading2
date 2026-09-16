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
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, NodeId } from "../src/types.js";
import type { Section } from "../src/web/position.js";
import { abandonScroll, glideTarget, scrollToBlock } from "../src/web/scroll.js";
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
  { row: 0, blockId: block(0), nodeId: "n0001" as NodeId, title: "Where it opens" },
  { row: 12, blockId: block(12), nodeId: "n0002" as NodeId, title: "The middle bit" },
  { row: 24, blockId: block(24), nodeId: "n0003" as NodeId, title: "How it ends" },
];

/* ------------------------------------------------------- the fake viewport -- */

const PORTRAIT = 100;
/** Narrower measure, fewer lines per paragraph: the same article, shorter. */
const LANDSCAPE = 40;

let rowHeight = PORTRAIT;
let scrollY = 0;
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
function Harness({ layoutKey }: { layoutKey: string }): ReactNode {
  useReadingPosition(SECTIONS, BLOCKS, layoutKey);
  return null;
}

function render(layoutKey: string): void {
  act(() =>
    root.render(createElement(NuqsAdapter, null, createElement(Harness, { layoutKey }))),
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
    const top = i === null ? 0 : i * rowHeight - scrollY;
    return { top, bottom: top + rowHeight, height: rowHeight, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
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
});
