// @vitest-environment jsdom
/**
 * **A deliberate jump flashes where it lands; stepping does not.**
 *
 * `beginJump` (src/web/keynav.ts) is the one place every history-pushing jump
 * in the reading view passes through, so the flash lives there
 * (docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md
 * § The flash lives in the jump, and Sol F1/F7):
 *
 *  - moved: the flash waits for the scroll to report `settled`, and a glide the
 *    reader's wheel cancelled flashes nothing;
 *  - already there: nothing moves and nothing is pushed, but any glide still in
 *    flight is stopped and the block flashes — the answer to "which one is it";
 *  - the arrow keys call `scrollToBlock` themselves and must not flash, however
 *    their scroll ends.
 *
 * `scrollToBlock` is stubbed so the test decides how each scroll ends; the flash
 * itself is real and read off the DOM.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";

type ScrollOutcome = import("../src/web/scroll.js").ScrollOutcome;

const { calls, control } = vi.hoisted(() => ({
  calls: { scrolled: [] as string[], abandoned: 0, hows: [] as unknown[] },
  control: {
    outcome: "settled" as "settled" | "cancelled" | "missing",
    /* Where a glide in flight is heading — `glideTarget()` — or `null`. */
    gliding: 900 as number | null,
    /* The centred arrival scroll.ts would be holding — `arrivalAnchor()`. */
    anchor: null as { id: string; passage: string | undefined } | null,
  },
}));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...real,
    scrollToBlock: (id: string, _behavior?: ScrollBehavior, done?: (o: ScrollOutcome) => void, how?: unknown) => {
      calls.scrolled.push(id);
      calls.hows.push(how);
      done?.(control.outcome);
    },
    abandonScroll: () => {
      calls.abandoned += 1;
    },
    glideTarget: () => control.gliding,
    arrivalAnchor: () => control.anchor,
  };
});

const { beginJump, useArrowNav } = await import("../src/web/keynav.js");
const { dropPendingFlash, flashBlock, flushPendingFlash } = await import("../src/web/flash.js");

const block = (i: number) => `spya-b${String(i).padStart(5, "0")}` as BlockId;
const BLOCKS: Block[] = Array.from({ length: 30 }, (_, i) => ({
  id: block(i),
  tag: "p",
  kind: "text",
  text: `para ${i}`,
  words: 2,
  html: `<p>para ${i}</p>`,
  gistable: true,
}));

/** Rows 0–15 have gone past the reading line, so the reader is in block 15. */
function layOut(): void {
  const tbody = document.createElement("tbody");
  for (let i = 0; i < 30; i++) {
    const tr = document.createElement("tr");
    tr.setAttribute("data-block", block(i));
    const td = document.createElement("td");
    td.className = "text";
    tr.append(td);
    const top = i <= 15 ? -10 : 500;
    tr.getBoundingClientRect = () =>
      ({ top, bottom: top + 20, left: 0, right: 0, width: 0, height: 20, x: 0, y: top }) as DOMRect;
    tbody.append(tr);
  }
  const table = document.createElement("table");
  table.append(tbody);
  document.body.replaceChildren(table);
}

const flashed = () =>
  [...document.querySelectorAll<HTMLElement>("td.block-flash, td.block-flash-still")].map(
    (td) => td.closest("tr")?.getAttribute("data-block"),
  );

let pushed: BlockId[] = [];
const jump = (target: BlockId, passage?: string) =>
  beginJump(BLOCKS, target, (id) => void pushed.push(id), passage);

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  calls.scrolled = [];
  calls.abandoned = 0;
  control.outcome = "settled";
  control.anchor = null;
  pushed = [];
  history.replaceState(null, "", "/read/x");
  layOut();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  dropPendingFlash();
});

describe("beginJump and the flash", () => {
  it("asks for a centred landing, carrying the passage (plan 260929a § 3)", () => {
    const key = `quote-20:${block(20)}:0`;
    expect(jump(block(20), key)).toBe(true);
    expect(calls.hows.at(-1)).toEqual({ align: "centre", passage: key });
  });

  it("counts a centred arrival as where the reader is, though its top is below the line (Sol F1)", () => {
    /* The reading line is on block 15; the reader jumped to 20, centred. */
    control.anchor = { id: block(20), passage: undefined };
    expect(jump(block(20)), "a second press on the same link is already there").toBe(false);
    expect(pushed).toEqual([]);
    expect(flashed()).toEqual([block(20)]);
  });

  it("is not already there for a different quote in the anchored block (Sol F2)", () => {
    control.anchor = { id: block(20), passage: `quote-a:${block(20)}:0` };
    expect(jump(block(20), `quote-b:${block(20)}:0`)).toBe(true);
    expect(pushed).toEqual([block(20)]);
  });

  it("flashes the target once the scroll has settled", () => {
    expect(jump(block(20))).toBe(true);
    expect(pushed).toEqual([block(20)]);
    expect(calls.scrolled).toEqual([block(20)]);
    expect(flashed()).toEqual([block(20)]);
  });

  it("does not flash when the reader's wheel cancelled the glide", () => {
    control.outcome = "cancelled";
    expect(jump(block(20))).toBe(true);
    expect(flashed()).toEqual([]);
  });

  it("does not flash when there was no row to go to", () => {
    control.outcome = "missing";
    jump(block(20));
    expect(flashed()).toEqual([]);
  });

  it("drops an older covered landing when a newer jump begins but is cancelled", () => {
    const table = document.querySelector("table");
    const reader = document.createElement("div");
    reader.className = "reader band-covers";
    reader.innerHTML = '<aside class="mode-band"></aside>';
    if (table) reader.append(table);
    document.body.replaceChildren(reader);

    flashBlock(block(19));
    control.outcome = "cancelled";
    jump(block(20));

    reader.querySelector(".mode-band")?.remove();
    flushPendingFlash();
    expect(flashed(), "the superseded landing must not reappear when prose is exposed").toEqual([]);
  });

  it("already there: pushes nothing, moves nothing, stops a glide in flight, and flashes", () => {
    expect(jump(block(15))).toBe(false);
    expect(pushed).toEqual([]);
    expect(calls.scrolled).toEqual([]);
    expect(calls.abandoned, "a glide carrying the reader past must be stopped").toBe(1);
    expect(flashed()).toEqual([block(15)]);
  });

  it("already there with nothing in flight: stops nothing, so a centred arrival keeps its hold (plan 260929a)", () => {
    control.gliding = null;
    try {
      expect(jump(block(15))).toBe(false);
      expect(calls.abandoned).toBe(0);
      expect(flashed()).toEqual([block(15)]);
    } finally {
      control.gliding = 900;
    }
  });

  it("narrows an arrival to an optional passage without changing ordinary jumps", () => {
    const key = `quote-20:${block(20)}:0`;
    const cell = document
      .querySelector(`tr[data-block="${block(20)}"]`)
      ?.querySelector<HTMLElement>("td.text");
    if (cell) cell.innerHTML = `<mark class="hit" data-hit="${key}">the quote</mark> around it`;

    expect(jump(block(20), key)).toBe(true);
    expect(cell?.classList.contains("block-flash")).toBe(false);
    expect(cell?.querySelector("mark")?.classList.contains("passage-flash")).toBe(true);
  });

  it("carries a quote to the flash, and sends the scroll no passage key (spya-hzpf9b)", () => {
    /* A chip whose sentence quotes the article (Cited.tsx). The quote narrows the paint
       and nothing else: `scrollToBlock` treats an unresolved passage key as
       provisional and re-measures, so the quote must not travel as one. With no
       highlight API here the flash falls back to the cell, which is enough to
       show it arrived. */
    expect(beginJump(BLOCKS, block(20), (id) => void pushed.push(id), { quotes: ["some quoted words"] })).toBe(true);
    expect(calls.hows.at(-1)).toEqual({ align: "centre", passage: undefined });
    expect(flashed()).toEqual([block(20)]);
  });

  it("is already there for a quote in the block under the reading line: it flashes and moves nothing", () => {
    expect(beginJump(BLOCKS, block(15), (id) => void pushed.push(id), { quotes: ["some quoted words"] })).toBe(false);
    expect(pushed).toEqual([]);
    expect(flashed()).toEqual([block(15)]);
  });

  it("narrows the no-movement branch to the passage too", () => {
    const key = `quote-15:${block(15)}:0`;
    const cell = document
      .querySelector(`tr[data-block="${block(15)}"]`)
      ?.querySelector<HTMLElement>("td.text");
    if (cell) cell.innerHTML = `<mark class="hit" data-hit="${key}">the current quote</mark>`;

    expect(jump(block(15), key)).toBe(false);
    expect(cell?.classList.contains("block-flash")).toBe(false);
    expect(cell?.querySelector("mark")?.classList.contains("passage-flash")).toBe(true);
  });
});

describe("stepping does not flash", () => {
  function Harness() {
    useArrowNav({ starts: [Array.from({ length: 30 }, (_, i) => i)] }, BLOCKS, 0);
    return null;
  }

  it("an arrow press moves the reader and leaves the prose alone", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Harness)));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
    });
    // The control: the key did step, and the stub reported a settled landing.
    expect(calls.scrolled).toEqual([block(16)]);
    expect(flashed()).toEqual([]);
    act(() => root.unmount());
    host.remove();
  });
});
