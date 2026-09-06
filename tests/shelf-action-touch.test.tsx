// @vitest-environment jsdom
/**
 * **On a finger, the first tap on a shelf action reads it and the second
 * presses it.**
 *
 * Greg, 2026-09-05: *"fix the touch behaviour"* — the half
 * docs/plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md left open.
 * Every control in the row had grown a card explaining what it does, and on a
 * touch screen the tap that opens the card also performs the action: Open
 * leaves the page, Archive takes the card away, Edit opens the editor. Five
 * controls a finger can press and cannot read.
 *
 * docs/plans/260905i-reveal-then-commit-for-the-shelf-action-row-on-touch.md.
 *
 * ## The two halves this covers, and why the second is the dangerous one
 *
 * **The gesture** — reveal, then commit — is the easy half, and it is checked
 * here through the real DOM rather than through a extracted predicate. That is
 * deliberate, and it is the lesson of
 * docs/postmortems/260828g-spine-hover-cards.md: the spine's `bandPress` had a
 * unit test that passed all the way through an outage, because the decision was
 * never the broken part. What broke was the event and effect ordering around
 * it. So every case below presses a real button and asks what a reader would
 * ask.
 *
 * **The controlled-tooltip trap** is the half that has already cost a day.
 * Revealing a card by tap means these tooltips are controlled, and one `armed`
 * now serves five of them inside one `<TooltipGroup>` — the exact shape that
 * postmortem ends by warning about. `useDelayGroup` closes every *other* member
 * the instant one opens, and `useHover`'s close timer fires 90ms behind the
 * pointer without asking who is open by then; unguarded, the cards flicker and
 * die. § "the pointer is unaffected" is where that is checked, and it is the
 * reason this file renders the real `<Actions>` instead of testing the decision.
 *
 * ## Faking a finger
 *
 * jsdom has no `PointerEvent`, and the code reads `pointerType` off the click's
 * native event. A `MouseEvent` with the property defined on it is exactly what
 * the browser delivers as far as this code can tell, and it keeps the test
 * honest about the one thing that matters: `pointerType` is a fact about the
 * *press*, not about the device, so a touchscreen laptop and a tablet with a
 * mouse both behave correctly and neither needs a separate test.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import type { LibraryEntry } from "../src/types.js";
import { Actions, type Shelf } from "../src/web/ShelfEntry.js";

/* --------------------------------------------------------------- fixtures -- */

const BASE: LibraryEntry = {
  slug: "a-piece",
  title: "A piece",
  addedAt: "2026-09-01T00:00:00.000Z",
  words: 1200,
  minutes: 6,
  blocks: 40,
  parts: 2,
  sections: 5,
  comments: 0,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false },
};

const FETCHED: LibraryEntry = { ...BASE, url: "https://example.com/piece" };
/** No address, so two of the five controls are drawn unavailable. */
const NO_URL: LibraryEntry = { ...BASE };

function stubShelf(): Shelf {
  return {
    archive: vi.fn(async () => {}),
    report: vi.fn(),
    renaming: null,
  } as unknown as Shelf;
}

/* ---------------------------------------------------------------- harness -- */

let host: HTMLDivElement;
let root: Root;
let onEdit: Mock<() => void>;
let shelf: Shelf;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  onEdit = vi.fn<() => void>();
  shelf = stubShelf();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(entry: LibraryEntry): void {
  act(() => {
    root.render(createElement(Actions, { entry, shelf, onEdit }));
  });
}

/** The control whose accessible name starts with this. */
function control(name: string): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>("button, a")].filter((el) =>
    (el.getAttribute("aria-label") ?? "").startsWith(name),
  );
  expect(hit, `no single control named ${name}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

/**
 * Press a control the way a given pointer would.
 *
 * Returns the event, because for the anchor the interesting answer is
 * `defaultPrevented` — "did this tap navigate" has no other observable in
 * jsdom.
 */
function press(el: Element, pointerType: "touch" | "mouse" | null): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  if (pointerType !== null) Object.defineProperty(ev, "pointerType", { value: pointerType });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

/**
 * **Open, which is not the same as in the DOM**, and getting that wrong makes
 * this whole file lie in both directions.
 *
 * `useTransitionStyles` keeps a closing card mounted for its 80ms exit, so
 * counting `[role="tooltip"]` nodes sees two cards during a handover and one
 * card immediately after a press that closed it. Neither is what a reader sees,
 * and asserting on it produces a test that fails on the animation and passes on
 * the bug.
 *
 * `aria-describedby` is the honest signal: `useRole` puts it on the trigger from
 * `open` itself, so it flips with the state rather than with the animation — and
 * it is what a screen reader is told, which is the other reason to check it.
 */
function isOpen(el: Element): boolean {
  const id = el.getAttribute("aria-describedby");
  return Boolean(id) && document.getElementById(id ?? "") !== null;
}

/** Every trigger in the row whose card is open. Exactly one, or none. */
function openTriggers(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>("button, a")].filter(isOpen);
}

/** The head of the one open card, which names the control it belongs to. */
function openCardHead(): string {
  const open = openTriggers();
  expect(open, "expected exactly one open card").toHaveLength(1);
  return (card(open[0] as Element)?.querySelector(".tip-soon-head")?.textContent ?? "").trim();
}

function card(el: Element): HTMLElement | null {
  return document.getElementById(el.getAttribute("aria-describedby") ?? "");
}

const openCardText = () =>
  (card(openTriggers()[0] as Element)?.textContent ?? "").replace(/\s+/g, " ");

/* --------------------------------------------------------------- a finger -- */

describe("a finger", () => {
  it("reads a control on the first tap without pressing it", () => {
    render(FETCHED);
    press(control("Edit title"), "touch");
    expect(onEdit, "the first tap did the thing instead of explaining it").not.toHaveBeenCalled();
    expect(openCardHead()).toBe("Edit title");
  });

  it("presses it on the second", () => {
    render(FETCHED);
    press(control("Edit title"), "touch");
    press(control("Edit title"), "touch");
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(openTriggers(), "the card outstayed the press it was explaining").toHaveLength(0);
  });

  /**
   * The spine's rule, for its reason: a finger walking the row should be able to
   * read along it rather than firing at whatever it lands on. `armed?.id !== id`
   * rather than `armed === null` is what makes this true.
   */
  it("re-reads rather than pressing when it moves to another control", () => {
    render(FETCHED);
    press(control("Edit title"), "touch");
    press(control("Archive"), "touch");
    expect(onEdit).not.toHaveBeenCalled();
    expect(shelf.archive).not.toHaveBeenCalled();
    expect(openCardHead()).toBe("Archive");
  });

  /**
   * **The anchor is the control with a default action of its own**, and the only
   * one where "did the tap do it" is not a spy. A first tap that failed to
   * cancel the navigation would leave the page before the card could be read —
   * which is the report that started this.
   */
  it("does not follow the link on the first tap, and does on the second", () => {
    render(FETCHED);
    const link = control("Open the original");
    expect(press(link, "touch").defaultPrevented, "the first tap navigated away").toBe(true);
    expect(press(link, "touch").defaultPrevented, "the second tap did not navigate").toBe(false);
  });

  /**
   * A control that is drawn unavailable has nothing to commit, so a tap on it is
   * only ever a reveal — and it must still open, because its card is the only
   * place the reason lives. `IconButton` refuses its own click when disabled, so
   * this passes only because the gesture is on the row rather than on the
   * button.
   */
  it("can still read a control that is unavailable", () => {
    render(NO_URL);
    press(control("Re-fetch"), "touch");
    expect(openCardHead()).toBe("Re-fetch and rebuild");
    expect(openCardText(), "an unavailable control invited a second press").not.toContain(
      "Tap again",
    );
  });

  it("is told that a second tap will do it, where one would", () => {
    render(FETCHED);
    press(control("Archive"), "touch");
    expect(openCardText()).toContain("Tap again");
  });

  /**
   * **Every control, not the two that happened to get a case of their own.**
   *
   * The gesture keys off a `data-action` attribute read back through
   * `closest()`, and a control whose attribute was missing or mistyped would
   * fail *open*: `actionAt` returns null, `pressCapture` returns early, and the
   * first tap commits — the original bug, restored for that one control, with
   * every test that did not name it still green. The attribute is now written
   * from `ActionTip`'s typed `id` so that cannot be mistyped, and this walks the
   * row so it cannot be *omitted* either. GPT Sol, 2026-09-05.
   */
  it("reveals before it acts on every control in the row", () => {
    /* **Copy commits into a jsdom that has no clipboard**, which is how this
       case found a real fault: `navigator.clipboard` is undefined outside a
       secure context, and `ShelfEntry`'s copy handler dereferenced it without a
       guard — throwing a `TypeError` out of a React event handler, past a
       `.catch` that only ever sees a rejected promise. vitest reported it as an
       uncaught exception while every assertion still passed. It is guarded now;
       the stub here is so this case exercises the *success* path rather than the
       one it accidentally documented. */
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
    for (const name of ["Edit title", "Re-fetch", "Open the original", "Copy link", "Archive"]) {
      render(FETCHED);
      const first = press(control(name), "touch");
      expect(first.defaultPrevented, `${name}: the first tap was not intercepted`).toBe(true);
      expect(isOpen(control(name)), `${name}: the first tap opened no card`).toBe(true);
      const second = press(control(name), "touch");
      expect(second.defaultPrevented, `${name}: the second tap was intercepted too`).toBe(false);
      act(() => root.render(null));
    }
  });

  /**
   * **An Apple Pencil counts as a finger**, which is not a nicety — it is a rule
   * docs/project/touch.md states and `swipe.ts` already follows. iPadOS reports
   * a Pencil as `pen`; it cannot hover, so Floating UI (which treats `pen` as
   * mouse-like) never opens the card for it either. Reading only `touch` left a
   * Pencil committing blind on the one row where the card is the point.
   * GPT Sol, 2026-09-05.
   */
  it("treats a pen as a finger", () => {
    render(FETCHED);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "pointerType", { value: "pen" });
    act(() => {
      control("Edit title").dispatchEvent(ev);
    });
    expect(onEdit, "a Pencil pressed the control instead of reading it").not.toHaveBeenCalled();
    expect(openCardHead()).toBe("Edit title");
  });
});

/* ---------------------------------------------------------------- a mouse -- */

describe("a mouse", () => {
  it("presses on the first click, as it always did", () => {
    render(FETCHED);
    press(control("Edit title"), "mouse");
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  /**
   * A click carrying no pointer at all — a test, an extension, a keyboard's
   * Enter. The safe reading of "no pointer" is "not a finger", which presses:
   * the alternative is a keyboard user who can never activate anything.
   */
  it("presses on a click that carries no pointer", () => {
    render(FETCHED);
    press(control("Edit title"), null);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  /**
   * **Pressing a control does not take its card away**, which is the half of
   * "a mouse is unchanged" that was briefly untrue.
   *
   * These tooltips are controlled now, so the commit branch clears the state —
   * and clearing it unconditionally closed a *hover-opened* card the moment you
   * clicked Copy, leaving it shut while the pointer still sat on the button,
   * because `useHover` had already fired its `mouseenter` and would not fire
   * another. Before they were controlled, `useDismiss`'s `referencePress: false`
   * meant a press never closed its own card. Only a finger's card is taken down
   * now. GPT Sol, 2026-09-05.
   */
  it("keeps a hovered card open through a click", async () => {
    render(FETCHED);
    const el = control("Copy link");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(isOpen(el)).toBe(true);
    press(el, "mouse");
    expect(isOpen(control("Copy link")), "the click closed the card under the pointer").toBe(true);
  });

  /**
   * **The card must survive its own opening**, which is the regression
   * docs/postmortems/260828g-spine-hover-cards.md is about: with one `armed`
   * behind five controlled tooltips in one group, `useDelayGroup`'s
   * one-open-at-a-time effect calls `onOpenChange(false)` on the other four in
   * the same commit, and an unguarded handler lets any of them null the state.
   * The card then lives only as long as its exit animation — about 80ms — and a
   * reader reports that there are no tooltips.
   *
   * So this asserts the reader's question and not the code's: hover, and **is
   * it still there a moment later**.
   */
  it("opens a card that is still there a moment later", async () => {
    render(FETCHED);
    control("Edit title").dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(openCardHead()).toBe("Edit title");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(openCardHead(), "the card was gone 300ms later — the group closed it").toBe("Edit title");
  });

  /**
   * The other half of the same trap: a departing control's close timer runs 90ms
   * behind the pointer, so without the identity guard it kills the card the
   * pointer has just *arrived* at — the opposite of what the group is for.
   */
  it("hands the card over when the pointer moves along the row", async () => {
    render(FETCHED);
    const first = control("Edit title");
    first.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    first.dispatchEvent(new MouseEvent("mouseleave"));
    first.dispatchEvent(
      new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
    );
    control("Archive").dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(openCardHead(), "the previous control's close timer took the new card").toBe("Archive");
  });

  /**
   * The control on the two above. Without it they could both be satisfied by a
   * card that never closes, which is a different bug and an easy one to write
   * while fixing this one — the postmortem records that its own "closes when the
   * pointer leaves" assertion was green throughout the outage, for exactly that
   * reason.
   */
  it("still closes the card when the pointer leaves the row", async () => {
    render(FETCHED);
    const el = control("Edit title");
    el.dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(openTriggers()).toHaveLength(1);
    el.dispatchEvent(new MouseEvent("mouseleave"));
    el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
    /* Two waits, not one long one: the close delay sets `open` false, and only
       the render that follows schedules the transition's unmount. Inside one
       `act` the queued update is not applied until the block exits. */
    for (const _ of [0, 1]) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });
    }
    expect(openTriggers()).toHaveLength(0);
  });
});
