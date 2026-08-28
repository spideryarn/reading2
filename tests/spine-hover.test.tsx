// @vitest-environment jsdom
/**
 * **The spine's hover cards, which stopped opening.**
 *
 * Greg, 2026-08-28: *"it no longer has hover-tooltips"*. It did on 2026-08-26,
 * and the code that broke it is the one that made the rail tappable
 * (`bf398f3`): every band's `<Tooltip>` became **controlled** off a single piece
 * of Spine state, `armed`, so that a finger could open a card and keep it open.
 *
 * One state for fifty triggers is the bug. `<TooltipGroup>` is Floating UI's
 * `FloatingDelayGroup`, and `useDelayGroup` enforces one-open-at-a-time by
 * calling **every other member's** `onOpenChange(false)` in a layout effect the
 * moment one of them opens:
 *
 * ```js
 * if (currentId !== id) onOpenChange(false);   // floating-ui, useDelayGroup
 * ```
 *
 * With an uncontrolled tooltip that is harmless — each one clears its own local
 * `useState`. With Spine's shared `armed` it is fatal: the band that just opened
 * sets `armed = {id}`, its sibling effects immediately call `setArmed(null)`,
 * and the card is torn down in the very next commit. Same shape as the stale
 * close a *departing* band schedules 90ms behind the pointer.
 *
 * So the fix is that a close only counts when it comes from the band that is
 * actually open — `setArmed(prev => prev?.id === id ? null : prev)`.
 *
 * **Why this test exists rather than a browser check.** `tests/spine-tap.test.ts`
 * covers `bandPress`, which is the *decision*, and every one of its assertions
 * passed throughout the outage: the bug is in the event and effect ordering
 * around the decision, not in it. This test drives the real `<Spine>` and asks
 * the only question a reader asks — after hovering a band, is there a card.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Spine } from "../src/web/Spine.js";
import type { OutlineEntry } from "../src/web/tree.js";
import type { BlockId, NodeId, TreeNode } from "../src/types.js";

/* Floating UI's `autoUpdate` observes the trigger for resizes, and the spine
   itself observes `document.body`; jsdom has no ResizeObserver at all. It only
   has to exist — every rectangle in jsdom is zero, so nothing here measures
   anything real, and the spine's guard is `rows.length === 0` rather than a
   height. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Past `DELAY.open` (240ms) in Tooltip.tsx, with room to spare. */
const AFTER_THE_OPEN_DELAY = 500;
/** Past `DELAY.close` (90ms) — long enough for a departing band's stale close. */
const AFTER_THE_CLOSE_DELAY = 300;

function node(id: string, title: string, gist: string): TreeNode {
  return {
    id: id as NodeId,
    depth: 1,
    parent: "root" as NodeId,
    children: [],
    range: [`${id}-a` as BlockId, `${id}-b` as BlockId],
    title,
    gist,
  };
}

function entry(id: string, title: string, startRow: number): OutlineEntry {
  return {
    node: node(id, title, `What ${title} is about.`),
    startRow,
    endRow: startRow + 1,
    words: 400,
    children: [],
  };
}

/** Two parts, no sub-sections, so `measure` gives two hit targets. */
const OUTLINE: OutlineEntry[] = [
  entry("n1", "First part", 0),
  entry("n2", "Second part", 2),
];

let host: HTMLDivElement;
let table: HTMLTableElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.useFakeTimers();

  /* The spine reads the table's geometry straight out of the document — by
     query, not by ref, because it knows blocks only by their stable ids
     (docs/project/block-ids.md). Four rows, one per range end. */
  table = document.createElement("table");
  table.innerHTML = `<tbody>${["n1-a", "n1-b", "n2-a", "n2-b"]
    .map((id) => `<tr data-block="${id}"><td>x</td></tr>`)
    .join("")}</tbody>`;
  document.body.append(table);

  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  table.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Render the rail and let its rAF-debounced measurement run. */
function mountSpine() {
  act(() => {
    root.render(<Spine outline={OUTLINE} layoutKey="test" onJump={() => {}} />);
  });
  act(() => {
    vi.advanceTimersByTime(50);
  });
}

/**
 * A **native** `mouseenter` on the band's button.
 *
 * `useHover` binds its listener to `elements.domReference` directly, bypassing
 * React's delegation — so a synthetic event, or a bubbling `mouseover` at the
 * root, would never reach it and the test would fail for the wrong reason.
 */
function hover(index: number) {
  const hits = host.querySelectorAll<HTMLElement>(".spine-hit");
  hits[index]?.dispatchEvent(new MouseEvent("mouseenter"));
}

function leave(index: number) {
  const hits = host.querySelectorAll<HTMLElement>(".spine-hit");
  hits[index]?.dispatchEvent(new MouseEvent("mouseleave"));
}

const cards = () => document.querySelectorAll(".tooltip");

it("draws one hit target per band", () => {
  mountSpine();
  expect(host.querySelectorAll(".spine-hit")).toHaveLength(2);
});

it("opens a hover card when the pointer rests on a band", () => {
  mountSpine();
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.textContent).toContain("First part");
});

/**
 * The card has to still be there a moment later. This is the assertion the
 * delay-group cross-talk fails: the card mounts and the sibling bands' layout
 * effects clear `armed` under it.
 */
it("keeps the card up while the pointer stays on the band", () => {
  mountSpine();
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(1);
});

/**
 * Running the pointer down the rail is what the grouping is *for* — the rail
 * "becomes scrubbable" (tooltips.md § Grouping). The departing band schedules
 * its close 90ms behind the pointer, so a shared `armed` that any band may
 * clear kills the card the reader has just arrived at.
 */
it("hands the card to the next band when the pointer moves down the rail", () => {
  mountSpine();
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  act(() => {
    leave(0);
    hover(1);
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(1);
  expect(cards()[0]?.textContent).toContain("Second part");
});

/** And leaving the rail altogether still closes it — the control that proves
    the fix is not simply "never close". */
it("closes the card when the pointer leaves the rail", () => {
  mountSpine();
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  expect(cards()).toHaveLength(1);
  act(() => {
    leave(0);
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  /* A second advance, and it is load-bearing: the close sets state, React runs
     the effect that starts `useTransitionStyles`' 80ms exit only when `act`
     returns, so the unmount timer is scheduled *after* the first advance is
     over and would never fire inside it. Getting this wrong makes a working
     close look like a card that never goes away. */
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(0);
});
