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
  calls: { scrolled: [] as string[], abandoned: 0 },
  control: { outcome: "settled" as "settled" | "cancelled" | "missing" },
}));
vi.mock("../src/web/scroll.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/scroll.js")>();
  return {
    ...real,
    scrollToBlock: (id: string, _behavior?: ScrollBehavior, done?: (o: ScrollOutcome) => void) => {
      calls.scrolled.push(id);
      done?.(control.outcome);
    },
    abandonScroll: () => {
      calls.abandoned += 1;
    },
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
const jump = (target: BlockId) => beginJump(BLOCKS, target, (id) => void pushed.push(id));

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.CSS = { escape: (s: string) => s } as unknown as typeof globalThis.CSS;
  calls.scrolled = [];
  calls.abandoned = 0;
  control.outcome = "settled";
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
});

describe("stepping does not flash", () => {
  function Harness() {
    useArrowNav({ ladder: [0], starts: [Array.from({ length: 30 }, (_, i) => i)] }, BLOCKS, 0);
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
