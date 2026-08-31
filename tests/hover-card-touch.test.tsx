// @vitest-environment jsdom
/**
 * **A finger on an underlined term — the events, not the rule.**
 *
 * The rule is two lines long and copied from `bandPress` in Spine.tsx: the
 * first tap reveals the card, the second commits to glossary mode. A pure
 * function for it would be worth almost nothing, because the header of
 * tests/spine-tap.test.ts says exactly how the last version of this decision
 * went wrong — the rule was right and the events never reached it, and every
 * assertion in the pure test passed throughout.
 *
 * So this mounts the hook for real and drives it with synthetic pointer
 * events. What it can prove: the sequence `pointerdown` → `pointerup` opens a
 * card, a second one commits, a drag does neither, and the compatibility
 * `click` that iOS emits afterwards is cancelled rather than left to navigate.
 *
 * What it cannot prove is that iOS emits that sequence, or that the callout
 * menu stays away, or that two fast taps are not a zoom. Those are on the list
 * in docs/plans/260827ak-touch-glossary-card.md and only a real iPad can settle them.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverCard } from "../src/web/useHoverCard.js";

/* Floating UI's `autoUpdate` observes the reference element, and jsdom has no
   ResizeObserver at all — without this the hook throws on the first open and
   every assertion below is about a card that never existed. */
class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/**
 * A `pointerdown`/`pointerup`/`click` that jsdom will dispatch.
 *
 * jsdom implements no `PointerEvent` constructor, so the pointer fields are
 * laid onto a `MouseEvent`. Listeners registered for `"pointerup"` receive it
 * regardless of the interface it was built from, which is all this needs.
 */
function pointer(
  type: string,
  target: Element,
  { x = 10, y = 10, pointerType = "touch", id = 1, isPrimary = true, at = 0 } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  Object.defineProperty(event, "pointerId", { value: id });
  Object.defineProperty(event, "isPrimary", { value: isPrimary });
  // Written before dispatch, and only when a test cares: `timeStamp` is
  // read-only once the event is out, so a later override changes nothing.
  if (at) Object.defineProperty(event, "timeStamp", { value: at });
  target.dispatchEvent(event);
  return event;
}

/**
 * The whole gesture, in the order iOS emits it: the pointer pair, then the
 * compatibility mouse events, then the click.
 *
 * `mouseup` before `click` is the part that matters — it is where TableView
 * opens a chat thread and reads a selection, so a swallower that only knew
 * about `click` would arrive one event late.
 */
function tap(target: Element, at = { x: 10, y: 10 }): MouseEvent {
  act(() => {
    pointer("pointerdown", target, at);
    pointer("pointerup", target, at);
  });
  let click!: MouseEvent;
  act(() => {
    pointer("mouseup", target, at);
    click = pointer("click", target, at);
  });
  return click;
}

interface Hit {
  id: string;
}

const committed: Hit[] = [];
/**
 * What TableView would have done with the same events.
 *
 * **This is the assertion that makes the file worth having.** GPT Sol's review
 * of the plan pointed out that checking `click.defaultPrevented` proves almost
 * nothing on its own: React delegates at its root container, which sees a
 * *bubbling* `mouseup` before any document-level bubble listener, and
 * TableView's `onMouseUp` is what opens a chat thread from a `<mark>` — one
 * element can carry `term` and `chat` at once. So the swallower's capture phase
 * is load-bearing, and the only way to test that is to put a React ancestor
 * with the real handlers underneath and prove neither of them runs.
 */
const ancestor = { mouseup: 0, click: 0 };

/** The prose, near enough: two marks and a link, written as injected HTML is. */
function Harness() {
  const { shown, anchorProps } = useHoverCard<Hit>({
    selector: "mark.term, a[href]",
    read: (el) => {
      const mark = el.closest("mark.term");
      const id = mark?.getAttribute("data-term");
      return id ? { id } : null;
    },
    tapSelector: "mark.term",
    onCommit: (target) => committed.push(target.data),
  });
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: standing in for TableView's <table> */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ditto — this is TableView's handler, not a control */}
      <div
        className="prose"
        onMouseUp={() => {
          ancestor.mouseup += 1;
        }}
        onClick={() => {
          ancestor.click += 1;
        }}
      >
        <p>
          the{" "}
          {/* A term that is also a chat mark and also a link — the shape the
              swallower exists for, all three at once. */}
          <a href="#alpha">
            <mark className="term chat" data-term="alpha" data-chat="c1">
              first term
            </mark>
          </a>{" "}
          and the <mark className="term" data-term="beta">second term</mark>.
        </p>
      </div>
      <p id="elsewhere">not a term</p>
      {shown && (
        <div {...anchorProps}>
          <div className="tooltip prose-card" data-card={shown.data.id}>
            {shown.data.id}
          </div>
        </div>
      )}
    </>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  committed.length = 0;
  ancestor.mouseup = 0;
  ancestor.click = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const mark = (term: string) => {
  const el = host.querySelector(`mark[data-term="${term}"]`);
  if (!el) throw new Error(`no mark for ${term}`);
  return el;
};
const card = () => document.querySelector("[data-card]")?.getAttribute("data-card") ?? null;

describe("a tap reveals, then commits", () => {
  it("opens the card on the first tap", () => {
    expect(card()).toBe(null);
    tap(mark("alpha"));
    expect(card()).toBe("alpha");
    expect(committed).toEqual([]);
  });

  it("goes to the glossary on a second tap of the same words", () => {
    tap(mark("alpha"));
    tap(mark("alpha"));
    expect(committed).toEqual([{ id: "alpha" }]);
  });

  /* The reason this is "same element" rather than "anything is open". A finger
     moving between two underlined phrases is reading, not choosing — the same
     argument bandPress makes about a rail of two-pixel bands. */
  it("re-reveals rather than committing when the finger moves to another term", () => {
    tap(mark("alpha"));
    tap(mark("beta"));
    expect(card()).toBe("beta");
    expect(committed).toEqual([]);
  });
});

describe("what a tap must not disturb", () => {
  it("cancels the click that follows a handled tap, so a term inside a link stays put", () => {
    const click = tap(mark("alpha"));
    expect(click.defaultPrevented).toBe(true);
  });

  /* The one that would have passed with the wiring broken. `mark.term.chat`
     inside an `<a>` is TableView's worst case: `onMouseUp` opens a chat thread
     and `onClick` follows the link, and `mouseup` comes first, so a swallower
     that waited for `click` would stop half of it. */
  it("keeps both compatibility events away from the React ancestor", () => {
    tap(mark("alpha"));
    expect(ancestor).toEqual({ mouseup: 0, click: 0 });
  });

  it("leaves an unrelated tap's own click alone", () => {
    const elsewhere = host.querySelector("#elsewhere");
    if (!elsewhere) throw new Error("no #elsewhere");
    const click = tap(elsewhere);
    expect(click.defaultPrevented).toBe(false);
  });

  /* The swallow is bounded by the next press as well as by a deadline and a
     place. A one-shot arm that never fired would otherwise sit waiting to eat
     the reader's next real tap — swipe.ts learned this one first. */
  it("stops eating events the moment the next press begins", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"));
      pointer("pointerup", mark("alpha"));
      // And no click: Safari does not always synthesise one, which is exactly
      // the case that leaves a naive arm sitting there.
    });
    act(() => {
      pointer("pointerdown", mark("beta"), { x: 12, y: 12 });
    });
    act(() => {
      pointer("click", mark("beta"), { x: 12, y: 12 });
    });
    expect(ancestor.click).toBe(1);
  });

  it("closes when the finger lands somewhere else", () => {
    tap(mark("alpha"));
    expect(card()).toBe("alpha");
    const elsewhere = host.querySelector("#elsewhere");
    if (!elsewhere) throw new Error("no #elsewhere");
    tap(elsewhere);
    expect(card()).toBe(null);
  });

  /* A scroll that starts on a term is the common case, not the exotic one —
     the underlines are in the middle of the reading column. */
  it("does nothing for a drag that began on a term", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { x: 10, y: 10 });
      pointer("pointerup", mark("alpha"), { x: 14, y: 90 });
    });
    expect(card()).toBe(null);
  });

  /**
   * The one that makes the running maximum load-bearing rather than decorative.
   *
   * A flick that overshoots and settles — or a rubber-band bounce at the top of
   * the article — comes back to where the finger landed, so endpoint distance
   * reads it as a tap. Sol's code review named this as the mutation every other
   * test in this file would sleep through, and it was right: swapping
   * `Math.max(press.moved, …)` for the endpoint alone leaves the rest green.
   */
  it("does nothing for a drag that comes back to where it started", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { x: 10, y: 10 });
      pointer("pointermove", mark("alpha"), { x: 10, y: 160 });
      pointer("pointerup", mark("alpha"), { x: 10, y: 10 });
    });
    expect(card()).toBe(null);
    expect(committed).toEqual([]);
  });

  /* Pinch again, from the other end: the platform's own word for the pointer
     that generates the compatibility events. */
  it("ignores a pointer that is not the primary one", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { id: 7, isPrimary: false });
      pointer("pointerup", mark("alpha"), { id: 7, isPrimary: false });
    });
    expect(card()).toBe(null);
  });

  /**
   * A tap whose whole job was to get rid of a selection. By `pointerup` the
   * selection is already collapsed, so asking then says "no selection" and the
   * card opens over words the reader was dismissing. Asking at `pointerdown` is
   * the fix, and this is the test that tells the two apart.
   */
  it("does not open on the tap that dismisses a selection", () => {
    const range = document.createRange();
    range.selectNodeContents(mark("beta"));
    window.getSelection()?.addRange(range);
    act(() => {
      pointer("pointerdown", mark("alpha"));
      window.getSelection()?.removeAllRanges(); // what the tap itself does
      pointer("pointerup", mark("alpha"));
    });
    expect(card()).toBe(null);
  });

  /* A long press moves nothing and selects nothing until the platform says so,
     so it passes every other test in `isTap`. */
  it("does nothing for a press that was simply held", () => {
    act(() => {
      const down = pointer("pointerdown", mark("alpha"), { at: 1_000 });
      expect(down.timeStamp).toBe(1_000);
      pointer("pointerup", mark("alpha"), { at: 2_200 });
    });
    expect(card()).toBe(null);
  });

  /**
   * `contextmenu` may arrive *after* `pointerup` — the spec declines to fix the
   * order — so cancelling the pending press is not enough. It has to take back
   * the card the tap opened and the swallow it armed.
   */
  it("undoes the tap when the callout menu arrives late", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"));
      pointer("pointerup", mark("alpha"));
    });
    expect(card()).toBe("alpha");
    act(() => {
      mark("alpha").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    });
    expect(card()).toBe(null);
    // And the compatibility events are the selection's again, not ours.
    act(() => {
      pointer("mouseup", mark("alpha"));
    });
    expect(ancestor.mouseup).toBe(1);
  });

  it("drops the gesture when the browser takes it for a scroll", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { x: 10, y: 10 });
      pointer("pointercancel", mark("alpha"), { x: 10, y: 10 });
      pointer("pointerup", mark("alpha"), { x: 10, y: 10 });
    });
    expect(card()).toBe(null);
  });

  /* A mouse keeps the hover path it always had. `pointerType` is a fact about
     the press, not about the device, so an iPad with a trackpad and a
     touchscreen laptop both get the right one. */
  it("ignores a mouse press, which the hover machine owns", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { pointerType: "mouse" });
      pointer("pointerup", mark("alpha"), { pointerType: "mouse" });
    });
    expect(card()).toBe(null);
  });

  /* The card's own foot carries "in the glossary" and, on a link, "open in a
     new tab". A tap on either must reach it rather than closing the panel out
     from under the finger. */
  it("leaves a tap inside the card to the card", () => {
    tap(mark("alpha"));
    const panel = document.querySelector("[data-card]");
    if (!panel) throw new Error("no card");
    tap(panel);
    expect(card()).toBe("alpha");
    expect(committed).toEqual([]);
  });

  /**
   * A long press moves no distance at all, so nothing about travel would have
   * caught it — and it is how a reader selects a phrase to ask a question
   * about. Opening a card here would be bad on its own; swallowing the
   * `mouseup` TableView reads the selection from is the part that would take a
   * working feature away.
   */
  it("gives way to a selection rather than opening over it", () => {
    const range = document.createRange();
    range.selectNodeContents(mark("alpha"));
    window.getSelection()?.addRange(range);
    tap(mark("alpha"));
    expect(card()).toBe(null);
    expect(ancestor.mouseup).toBe(1);
    window.getSelection()?.removeAllRanges();
  });

  it("gives way to the callout menu", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"));
      mark("alpha").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
      pointer("pointerup", mark("alpha"));
    });
    expect(card()).toBe(null);
  });

  /* Pinch-zoom has to survive. Two fingers down is not a tap however little
     either of them travels. */
  it("drops the gesture when a second finger arrives", () => {
    act(() => {
      pointer("pointerdown", mark("alpha"), { id: 1 });
      pointer("pointerdown", mark("beta"), { id: 2 });
      pointer("pointerup", mark("alpha"), { id: 1 });
    });
    expect(card()).toBe(null);
  });
});

describe("a card a finger opened does not ride along", () => {
  /* From a nested scroller, and **not bubbling** — which is what a real
     `scroll` event is. Dispatching on `document` itself would pass with the
     capture flag removed, so it would be testing the setup. */
  it("closes on a scroll, which a hovered card must not do", () => {
    tap(mark("alpha"));
    expect(card()).toBe("alpha");
    act(() => {
      const scroller = host.querySelector(".prose");
      scroller?.dispatchEvent(new Event("scroll")); // bubbles: false, as the real one is
    });
    expect(card()).toBe(null);
  });

  it("closes when the device is rotated or the window resized", () => {
    tap(mark("alpha"));
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(card()).toBe(null);
  });

  /* The words a second tap would act on. Two underlined phrases in one line
     are otherwise indistinguishable once the card is up. */
  it("marks the tapped words, and unmarks them when the card goes", () => {
    tap(mark("alpha"));
    expect(mark("alpha").hasAttribute("data-hover-tap")).toBe(true);
    const elsewhere = host.querySelector("#elsewhere");
    if (!elsewhere) throw new Error("no #elsewhere");
    tap(elsewhere);
    expect(mark("alpha").hasAttribute("data-hover-tap")).toBe(false);
  });
});

describe("the listeners are the component's, not the document's", () => {
  /* Through a **live** node, not the detached one the unmounted tree left
     behind: a leaked document listener never sees a detached target, so that
     version of this test passes with every `removeEventListener` deleted.
     Pointed out by Sol's code review. */
  it("takes every one of them away on unmount", () => {
    tap(mark("alpha"));
    act(() => root.unmount());

    const survivor = document.createElement("mark");
    survivor.className = "term";
    survivor.setAttribute("data-term", "alpha");
    survivor.textContent = "still here";
    document.body.append(survivor);

    ancestor.click = 0;
    act(() => {
      pointer("pointerdown", survivor);
      pointer("pointerup", survivor);
    });
    expect(document.querySelector("[data-card]")).toBe(null);
    expect(survivor.hasAttribute("data-hover-tap")).toBe(false);
    // And the swallower is gone with it: nothing cancels this click any more.
    const stray = pointer("click", survivor);
    expect(stray.defaultPrevented).toBe(false);
    survivor.remove();

    // Re-mounted so `afterEach` has something to unmount.
    root = createRoot(host);
    act(() => root.render(<Harness />));
  });
});
