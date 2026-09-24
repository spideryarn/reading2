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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function mountSpine(onJump: (blockId: string) => void = () => {}) {
  act(() => {
    root.render(<Spine outline={OUTLINE} layoutKey="test" onJump={onJump} />);
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
  /* **Advanced past the exit transition before looking, and that is what makes
     this evidence rather than a coincidence.** A card torn down by the bug this
     file is about stays in the DOM for another 80ms while `useTransitionStyles`
     animates it out, so an assertion taken the instant after the open delay can
     be looking at a corpse. GPT Sol, reviewing which of these five cases could
     actually have gone red, 2026-08-28. */
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
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
  /* Establish that it is genuinely open before asking it to close — otherwise
     this case passes against the broken code for the wrong reason, which is
     exactly what it did until 2026-08-28: the card was already gone, so
     "it closes" was true of a card that had never stayed. A control that cannot
     tell the fix from the bug is not a control. */
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
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

/* ------------------------------------------------------- the armed lifecycle --
   `armed` is cleared by `onOpenChange`, which arrives from a *mounted* tooltip.
   Both cases below are ones where no such close can arrive, so the state has to
   be reconciled from outside. Found by GPT Sol reviewing the fix, 2026-08-28:
   the regression this file is named for was about stale closes, and these are
   the same seam at the other end of the component's life. */

/** A click carrying a `pointerType`, which is what `bandPress` branches on. */
function tap(index: number, pointerType: "touch" | "mouse") {
  const hit = host.querySelectorAll<HTMLElement>(".spine-hit")[index];
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  act(() => {
    hit?.dispatchEvent(ev);
  });
}

it("a finger's card does not ride up the screen when the article scrolls", () => {
  /* Reveal-then-commit leaves a card open with no pointer holding it there, and
     Floating UI is not configured to dismiss on ancestor scroll — so without
     this the card stays put while the article moves underneath it, and
     everything it says about position ("38% in", "you are here") quietly stops
     being true of where the reader is. A card that is wrong is worse than one
     that has gone. */
  mountSpine();
  tap(0, "touch");
  expect(cards()).toHaveLength(1);

  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(0);
});

it("a mouse reader's card is not taken away by a scroll", () => {
  /* The control, and the reason the rule is keyed on `byTouch`. On a mouse the
     card is held open by the pointer being on the band; closing it on scroll
     would fight the reader rather than help them. Without this assertion
     "close on scroll" could be implemented for every card and nothing would
     notice. */
  mountSpine();
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  act(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(1);
});

it("a new article does not arrive with a card already open", () => {
  /* **Ids are positional within an outline**, so the same id in a new one is a
     different band. A finger opens n1's card; the reader goes to another
     article whose first band is also n1; `open={armed?.id === id}` is true on
     the very first render of the new rail, and a card nobody asked for is
     showing over a section nobody pointed at. Clearing only when the id has
     *gone* from `hits` does not catch this — the id is still there. */
  mountSpine();
  tap(0, "touch");
  expect(cards()).toHaveLength(1);

  const OTHER: OutlineEntry[] = [
    entry("n1", "A different article's first part", 0),
    entry("n2", "And its second", 2),
  ];
  act(() => {
    root.render(<Spine outline={OTHER} layoutKey="test" onJump={() => {}} />);
  });
  /* **Asserted on the first committed render, with no timers advanced, and
     `aria-describedby` rather than a node count.**

     The first version of this guard was a `useEffect` calling `setArmed(null)`,
     which runs *after* paint — so the stale card rendered fully open on the new
     article for a frame and was then taken away. Counting `.tooltip` nodes
     cannot see that, and cannot even see it now: a card that has just been told
     to close stays in the DOM for its 80ms exit transition, so there is exactly
     one panel here either way. What separates them is whether anything is
     *open*, and `useRole` puts `aria-describedby` on the trigger only while it
     is. GPT Sol, reviewing the built code, 2026-08-28.

     The guard is now a derived `armedId` rather than an effect, so there is no
     frame in which it is wrong. */
  const describedBy = [...host.querySelectorAll(".spine-hit")].map((h) =>
    h.getAttribute("aria-describedby"),
  );
  expect(describedBy).toEqual([null, null]);

  /* And the panel still on screen is the *old* article's, mid-exit — not a new
     one opened about a section nobody pointed at, which is the actual failure
     this is here to stop. */
  expect(cards()[0]?.textContent).toContain("First part");

  // Then it goes, and does not come back.
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  act(() => {
    vi.advanceTimersByTime(AFTER_THE_CLOSE_DELAY);
  });
  expect(cards()).toHaveLength(0);
});

/* ------------------------------------------------- WebKit bug 282988 ----
   On iOS 18.2 and later a finger's *click* says `pointerType: "mouse"`, while
   the same gesture's `pointerdown` correctly says `touch`
   (https://bugs.webkit.org/show_bug.cgi?id=282988). Reading the click, the
   rail took every iPad tap for a mouse click and jumped on the first one, so
   the card never opened first. The type now comes from the press recorded at
   its own `pointerdown` (Spine.tsx § bandClick).
   docs/plans/260924c-ipad-first-tap-on-the-rail-shows-the-card.md. */

interface Fire {
  detail?: number;
  /** `event.timeStamp`, for the cases that depend on how old a press is. */
  at?: number | undefined;
  pointerId?: number;
  /** Dispatch here instead of at the band — a finger that landed off the rail. */
  target?: Element;
}

/** Dispatch a pointer or mouse event carrying `pointerType` (jsdom has no PointerEvent). */
function fire(type: string, index: number, pointerType: string, o: Fire = {}) {
  const hit = o.target ?? host.querySelectorAll<HTMLElement>(".spine-hit")[index];
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, detail: o.detail ?? 1 });
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  Object.defineProperty(ev, "pointerId", { value: o.pointerId ?? 1 });
  if (o.at !== undefined) Object.defineProperty(ev, "timeStamp", { value: o.at });
  act(() => {
    hit?.dispatchEvent(ev);
  });
}

/** A finger's tap as an affected iPad reports it: touch down and up, a click that says mouse. */
function ipadTap(index: number, at?: number) {
  fire("pointerdown", index, "touch", { at });
  fire("pointerup", index, "touch", { at });
  /* The mislabelled click carries the mouse's id too, presumably — see
     tests/link-tap-escapes.test.tsx. Nothing here may match on it. */
  fire("click", index, "mouse", { at, pointerId: 99 });
}

/** Which bands have an open card — `useRole` sets `aria-describedby` only while one is. */
const openBands = () =>
  [...host.querySelectorAll(".spine-hit")].map((h) => h.getAttribute("aria-describedby") !== null);

it("an iPad's first tap on a band opens its card rather than jumping", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  ipadTap(0);
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([true, false]);
  expect(cards()[0]?.textContent).toContain("Tap again to go here");
});

it("an iPad's second tap on the same band goes there", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  ipadTap(0);
  ipadTap(0);
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n1-a");
});

it("an iPad tap on another band re-reveals rather than jumping", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  ipadTap(0);
  ipadTap(1);
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([false, true]);
});

it("a real mouse still jumps on its first click", () => {
  /* The control: without it, "every click reveals" would pass the cases above. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "mouse");
  fire("pointerup", 0, "mouse");
  fire("click", 0, "mouse");
  expect(onJump).toHaveBeenCalledTimes(1);
});

it("a real mouse still jumps when hover already opened the card", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  act(() => {
    hover(0);
    vi.advanceTimersByTime(AFTER_THE_OPEN_DELAY);
  });
  expect(openBands()).toEqual([true, false]);
  fire("pointerdown", 0, "mouse");
  fire("pointerup", 0, "mouse");
  fire("click", 0, "mouse");
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n1-a");
});

it("a real mouse still jumps when keyboard focus already opened the card", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  const hit = host.querySelectorAll<HTMLElement>(".spine-hit")[0];
  act(() => hit?.focus());
  expect(openBands()).toEqual([true, false]);
  fire("pointerdown", 0, "mouse");
  fire("pointerup", 0, "mouse");
  fire("click", 0, "mouse");
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n1-a");
});

it("a mouse still jumps after a finger's click has gone missing", () => {
  /* A hybrid device: a finger lands on the rail and lifts off it, so no click
     and no cancel. The mouse's click that follows must be the mouse's. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch");
  fire("pointerup", 0, "touch");
  fire("pointerdown", 1, "mouse");
  fire("pointerup", 1, "mouse");
  fire("click", 1, "mouse");
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n2-a");
});

it("a mouse press cannot steal a delayed finger click", () => {
  /* A hybrid iPad can receive mouse input while WebKit's gesture recognizer
     still owes a touch click. The finger's click arrives while the mouse is
     down; after the mouse lifts, its own click must still jump normally. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch", { pointerId: 7 });
  fire("pointerup", 0, "touch", { pointerId: 7 });
  fire("pointerdown", 1, "mouse", { pointerId: 1 });
  fire("click", 0, "mouse", { pointerId: 1 });
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([true, false]);
  fire("pointerup", 1, "mouse", { pointerId: 1 });
  fire("click", 1, "mouse", { pointerId: 1 });
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n2-a");
});

it("a finger held down cannot steal a mouse click", () => {
  /* Only a released pointer can have produced the click. Even though touch is
     the newest press, the mouse is the newest release and still jumps. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 1, "mouse", { pointerId: 1 });
  fire("pointerdown", 0, "touch", { pointerId: 7 });
  fire("pointerup", 1, "mouse", { pointerId: 1 });
  fire("click", 1, "mouse", { pointerId: 1 });
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n2-a");
  fire("pointerup", 0, "touch", { pointerId: 7 });
  fire("click", 0, "mouse", { pointerId: 1 });
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(openBands()).toEqual([true, false]);
});

it("a pen still jumps after a finger press that never clicked", () => {
  /* A reliable pen click must take its own pen record, not the oldest record
     left by another pointer type. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch", { pointerId: 1 });
  fire("pointerup", 0, "touch", { pointerId: 1 });
  fire("pointerdown", 1, "pen", { pointerId: 2 });
  fire("pointerup", 1, "pen", { pointerId: 2 });
  fire("click", 1, "pen", { pointerId: 2 });
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n2-a");
});

it("a finger cannot borrow a pen press that never clicked", () => {
  /* On the affected iPad the finger's click says mouse, so consuming the
     queue's oldest record without checking its type would take this for a pen
     and jump on the finger's first tap. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "pen", { pointerId: 2 });
  fire("pointerup", 0, "pen", { pointerId: 2 });
  ipadTap(1);
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([false, true]);
});

it("a finger cannot borrow a mouse press that never clicked", () => {
  /* A mouse press may end without a click if the pointer lifts elsewhere. The
     touch pointerdown after it is the newest gesture, so the affected iPad's
     `mouse` click belongs to touch rather than to that stale mouse record. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "mouse", { pointerId: 1 });
  fire("pointerup", 0, "mouse", { pointerId: 1 });
  ipadTap(1);
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([false, true]);
});

it("a keyboard press after a finger that never clicked still jumps", () => {
  /* Enter on a band is a keyboard's press (`pointerType` ""), whatever a
     finger left behind, and a keyboard jumps. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch");
  fire("click", 0, "", { detail: 0 });
  expect(onJump).toHaveBeenCalledTimes(1);
});

it("a press the browser cancelled for a scroll does not cost the next tap", () => {
  /* Had the cancelled press stayed queued, the next tap's click would take it
     for its own, and the tap after that would take the first tap's record —
     which began with no card open — so the second tap would reveal again. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch");
  fire("pointercancel", 0, "touch");
  ipadTap(0);
  ipadTap(0);
  expect(onJump).toHaveBeenCalledTimes(1);
});

it("a press too old to still be waiting for its click is forgotten", () => {
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch", { at: 1_000 }); // lifted off the rail: no click, no cancel
  ipadTap(1, 5_000);
  ipadTap(1, 5_500);
  expect(onJump).toHaveBeenCalledTimes(1);
  expect(onJump).toHaveBeenCalledWith("n2-a");
});

it("a click after a cancel, with no press of its own, reveals rather than jumping", () => {
  /* Whatever the click says: on an iPad it says `mouse` for a finger, and a
     real mouse always has a press on the rail. GPT Sol, plan review F1. */
  const onJump = vi.fn();
  mountSpine(onJump);
  fire("pointerdown", 0, "touch");
  fire("pointercancel", 0, "touch");
  fire("click", 0, "mouse", { pointerId: 99 });
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([true, false]);
});

it("a cancelled second tap cannot spend the card opened by the first", () => {
  /* The missing half of the case above: the click has no press of its own, so
     even an already-open card cannot authorize it. Otherwise a cancel followed
     by the click WebKit sometimes still sends turns a cancelled gesture into a
     jump. GPT Sol, plan review F1. */
  const onJump = vi.fn();
  mountSpine(onJump);
  ipadTap(0);
  fire("pointerdown", 0, "touch");
  fire("pointercancel", 0, "touch");
  fire("click", 0, "mouse", { pointerId: 99 });
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([true, false]);
});

it("a finger that landed beside the rail and was moved onto a band reveals first", () => {
  /* Touch adjustment: the pointer events land on what is under the finger —
     here the table beside the 12px rail — and the click on the band WebKit
     judged it meant. The rail saw no press. GPT Sol, plan review F2. */
  const onJump = vi.fn();
  mountSpine(onJump);
  const beside = table.querySelector("td") as Element;
  fire("pointerdown", 0, "touch", { target: beside });
  fire("pointerup", 0, "touch", { target: beside });
  fire("click", 0, "mouse", { pointerId: 99 });
  expect(onJump).not.toHaveBeenCalled();
  expect(openBands()).toEqual([true, false]);
  /* A second tap that lands on the band goes there. (One that lands beside
     the rail again re-reveals instead: its `pointerdown` outside the band is
     an outside press, and `useDismiss` closes the card before the click — as
     it always has, on any touch device. Not changed here.) */
  ipadTap(0);
  expect(onJump).toHaveBeenCalledTimes(1);
});

describe("clicks that arrive grouped after several lifts", () => {
  /* The Pointer Events spec lets compatibility clicks arrive late and
     together, in order. The first click's reveal must not become the second
     click's permission to jump. GPT Sol, plan review F1. */
  it("two quick taps on two bands reveal the second and jump to neither", () => {
    const onJump = vi.fn();
    mountSpine(onJump);
    fire("pointerdown", 0, "touch");
    fire("pointerup", 0, "touch");
    fire("pointerdown", 1, "touch");
    fire("pointerup", 1, "touch");
    fire("click", 0, "mouse", { pointerId: 99 });
    fire("click", 1, "mouse", { pointerId: 99 });
    expect(onJump).not.toHaveBeenCalled();
    expect(openBands()).toEqual([false, true]);
  });

  it("a quick double tap on one band shows its card and does not jump blind", () => {
    const onJump = vi.fn();
    mountSpine(onJump);
    fire("pointerdown", 0, "touch");
    fire("pointerup", 0, "touch");
    fire("pointerdown", 0, "touch");
    fire("pointerup", 0, "touch");
    fire("click", 0, "mouse", { pointerId: 99 });
    fire("click", 0, "mouse", { pointerId: 99 });
    expect(onJump).not.toHaveBeenCalled();
    expect(openBands()).toEqual([true, false]);
  });
});
