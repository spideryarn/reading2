// @vitest-environment jsdom
/**
 * **Taps on a link, which the card has to catch however they arrive.**
 *
 * SPIDERYARN-READING2-3Y, Greg on a home-screen iPad, 2026-09-12: *"Sometimes
 * when I click on a hyperlink to an article, it opens the external article."*
 * docs/plans/260915a-ipad-link-taps-that-escape-the-link-card.md.
 *
 * The first tap on a link that leaves the app is meant to show the card and
 * nothing else (links.md § On a coarse pointer the first tap reveals and the
 * second opens). It used to be decided at `pointerup`, and a `click` that
 * decision did not claim was left to the anchor's own `target="_blank"` — so
 * every way the `pointerup` test and the platform disagree about *whether*
 * this was a tap, or *where* it landed, was an escape. Each has a case here.
 * Since the fix, a tap on anything inside a link is decided at the click,
 * which is the event that navigates.
 *
 * The assertion that matters is `click.defaultPrevented`: an uncancelled click
 * on `a[target="_blank"]` is a navigation. jsdom performs none, so the test
 * reads the flag the browser would have obeyed.
 *
 * **The clicks here land somewhere else, and later, on purpose.** The older
 * suite (tests/hover-card-touch.test.tsx) fires every event of a tap at one
 * node, at one point, in one millisecond — which is exactly the assumption
 * that let these through: that the click goes where the pointer went,
 * straight away. docs/postmortems/260915a-a-tap-judged-at-pointerup-and-acted-on-at-click.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHoverCard } from "../src/web/useHoverCard.js";

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

interface At {
  x?: number;
  y?: number;
  at?: number;
  pointerType?: string;
  id?: number;
  isPrimary?: boolean;
  bubbles?: boolean;
  cancelable?: boolean;
  detail?: number;
}

/** A pointer or mouse event jsdom will dispatch — see the twin in hover-card-touch.test.tsx. */
function fire(type: string, target: Element | Document, o: At = {}): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: o.bubbles ?? true,
    cancelable: o.cancelable ?? true,
    clientX: o.x ?? 10,
    clientY: o.y ?? 10,
    // A tap's click carries 1 — measured, Chrome 152 with CDP touch input — and
    // a keyboard's Enter carries 0.
    detail: o.detail ?? 1,
  });
  Object.defineProperty(event, "pointerType", { value: o.pointerType ?? "touch" });
  Object.defineProperty(event, "pointerId", { value: o.id ?? 1 });
  Object.defineProperty(event, "isPrimary", { value: o.isPrimary ?? true });
  if (o.at !== undefined) Object.defineProperty(event, "timeStamp", { value: o.at });
  target.dispatchEvent(event);
  return event;
}

/** The compatibility pair a tap ends with, at wherever the platform decided it landed. */
function compat(target: Element, o: At = {}): MouseEvent {
  let click!: MouseEvent;
  act(() => {
    fire("mouseup", target, o);
    click = fire("click", target, o);
  });
  return click;
}

/** A finger (or pen) going down on `down` and coming up, and the lift events after it. */
function press(down: Element, o: { from?: At; to?: At; pointerType?: string } = {}): void {
  const pointerType = o.pointerType ?? "touch";
  const from = { ...o.from, pointerType };
  const to = { ...(o.to ?? o.from), pointerType };
  act(() => {
    fire("pointerover", down, from);
    fire("pointerdown", down, from);
    if (o.to) fire("pointermove", down, to);
    fire("pointerup", down, to);
    fire("pointerout", down, to);
    fire("pointerleave", document, { ...to, bubbles: false, cancelable: false });
  });
}

/** The whole of an ordinary tap: the press, and its click at the same place. */
function tap(target: Element, o: { pointerType?: string } = {}): MouseEvent {
  press(target, o);
  return compat(target, o.pointerType ? { pointerType: o.pointerType } : {});
}

interface Hit {
  id: string;
}
const committed: Hit[] = [];
const ancestor = { click: 0, mouseup: 0, surface: 0 };

/**
 * Two external links, a glossary term inside a third, a footnote marker, and a
 * term with no link around it — ProseHoverCard's four kinds of tap target.
 */
function Harness() {
  const { shown, anchorProps } = useHoverCard<Hit>({
    selector: "mark.term, .prose a[href]",
    // A term before its link, as ProseHoverCard's card puts it.
    read: (el) => {
      const mark = el.closest("mark.term");
      if (mark) return { id: mark.getAttribute("data-term") ?? "term" };
      const a = el.closest("a[href]");
      return a ? { id: a.getAttribute("data-id") ?? "link" } : null;
    },
    // ProseHoverCard's, which opens a link's card on keyboard focus too.
    focusable: true,
    // ProseHoverCard's own selector, with this harness's marker attribute.
    tapSelector: `mark.term, a[data-note-ref], .prose a[target="_blank"]`,
    onCommit: (target) => committed.push(target.data),
  });
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: standing in for TableView's <table> */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: ditto */}
      <div
        className="prose"
        onClick={() => {
          ancestor.click += 1;
        }}
        onMouseUp={(event) => {
          ancestor.mouseup += 1;
          // The part of TableView's handler this click-only design relies on:
          // links do not also open the comment/chat surface on mouseup.
          if ((event.target as Element).closest?.("a[href]")) return;
          ancestor.surface += 1;
        }}
      >
        <p>
          <span id="beside">the words just before </span>
          <a href="https://philpapers.org/rec/BUTAAT" target="_blank" rel="noopener noreferrer" data-id="out">
            Butlin
          </a>
          <span> then </span>
          <a href="https://arxiv.org/abs/2308.08708" target="_blank" rel="noopener noreferrer" data-id="out2">
            arXiv
          </a>
          , then{" "}
          <a href="https://en.wikipedia.org/wiki/Autopoiesis" target="_blank" rel="noopener noreferrer" data-id="wiki">
            <mark className="term" data-term="autopoiesis">
              autopoiesis
            </mark>
          </a>
          , a note
          <a href="#spya-n1" data-note-ref="n1" data-id="note">
            <sup>1</sup>
          </a>{" "}
          and a <mark className="term" data-term="beta">term</mark> on its own.
        </p>
      </div>
      {shown && (
        <div {...anchorProps}>
          <div className="tooltip prose-card" data-card={shown.data.id}>
            <a id="card-link" href="https://philpapers.org/rec/BUTAAT" target="_blank" rel="noopener noreferrer">
              open in a new tab
            </a>
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
  ancestor.click = 0;
  ancestor.mouseup = 0;
  ancestor.surface = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.getSelection()?.removeAllRanges();
  vi.unstubAllGlobals();
});

const el = (selector: string) => {
  const found = document.querySelector(selector);
  if (!found) throw new Error(`no ${selector}`);
  return found;
};
const link = () => el("a[data-id=out]") as HTMLElement;
const card = () => document.querySelector("[data-card]")?.getAttribute("data-card") ?? null;
const select = (node: Element) => {
  const range = document.createRange();
  range.selectNodeContents(node);
  window.getSelection()?.addRange(range);
};

describe("the baseline the escapes are measured against", () => {
  it("a clean tap on the link reveals and does not navigate", () => {
    const click = tap(link());
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
    expect(committed).toEqual([]);
    expect(ancestor.click).toBe(0);
  });

  it("and a second clean tap opens it", () => {
    tap(link());
    const click = tap(link());
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([{ id: "out" }]);
  });
});

describe("a first tap the pointerup test would have missed still reveals rather than navigating", () => {
  /* Touch adjustment. The pointer events carry the raw hit — the words beside
     a one-word link — and WebKit moves the click onto the link it judged the
     finger meant (`attemptSyntheticClick` → `nodeRespondingToClickEvents`). */
  it("a finger that landed just beside the link", () => {
    press(el("#beside"), { from: { x: 8, y: 10 } });
    const click = compat(link(), { x: 18, y: 10 });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
    expect(committed).toEqual([]);
  });

  /* The prose is `pan-y`, so a sideways drift scrolls nothing and the platform
     still calls it a tap. Measured: 15px sideways in Chrome still clicks. */
  it("a finger that drifted sideways past the tap slop", () => {
    press(link(), { from: { x: 10, y: 10 }, to: { x: 25, y: 10 } });
    const click = compat(link(), { x: 25, y: 10 });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
  });

  it("an Apple Pencil", () => {
    const click = tap(link(), { pointerType: "pen" });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
  });

  /* WebKit bug 282988 is still reopened: on affected iPads the click from a
     touch press is a PointerEvent but incorrectly says `pointerType: mouse`. */
  it("a WebKit touch click mislabeled as mouse still reveals", () => {
    press(link());
    const click = compat(link(), { pointerType: "mouse" });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
    expect(committed).toEqual([]);
  });

  /* Measured: a 700ms still press in Chrome still clicks. */
  it("a press held a little past the tap's duration, with no callout", () => {
    press(link(), { from: { at: 1_000 }, to: { at: 1_700 } });
    const click = compat(link(), { at: 1_710 });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
  });

  /* WebKit can hold a tap's click ~350ms to rule out a double-tap zoom, which
     used to put it past the swallow and let it navigate under the card the
     same tap had opened. There is no window now: the click is the decision. */
  it("a click that arrives late", () => {
    press(link(), { from: { at: 1_000 }, to: { at: 1_080 } });
    const click = compat(link(), { at: 1_900 });
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
    expect(committed).toEqual([]);
  });
});

describe("and the second tap still opens it, however it arrives", () => {
  it("a second escaped tap on the same link commits", () => {
    press(el("#beside"), { from: { x: 8, y: 10 } });
    compat(link(), { x: 18, y: 10 });
    press(el("#beside"), { from: { x: 8, y: 10 } });
    const click = compat(link(), { x: 18, y: 10 });
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([{ id: "out" }]);
  });

  it("a Pencil's second tap commits", () => {
    tap(link(), { pointerType: "pen" });
    tap(link(), { pointerType: "pen" });
    expect(committed).toEqual([{ id: "out" }]);
  });

  /* WebKit bug 282988 again, and the half that is about the *second* tap. A
     click that wrongly says `mouse` presumably carries the mouse's pointer id
     too, not the finger's — so matching the press record by that id found
     nothing, and the reader's second tap re-revealed for ever. The link could
     then only be opened from the card's own button, on exactly the iPads the
     mislabel branch exists for. */
  it("a second tap whose click is mislabeled as mouse, with the mouse's id, still commits", () => {
    press(link());
    compat(link(), { pointerType: "mouse", id: 99 });
    expect(card()).toBe("out");
    press(link());
    const click = compat(link(), { pointerType: "mouse", id: 99 });
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([{ id: "out" }]);
  });

  /* The Pointer Events spec lets compatibility clicks arrive grouped after
     the last lift. Two taps on two links, then both clicks: the card ends on
     the second link, and nothing is opened — neither click is read as the
     other's second tap. GPT Sol, plan review, 2026-09-15. */
  it("grouped clicks from taps on two links reveal the second and open neither", () => {
    press(link());
    press(el("a[data-id=out2]"));
    const first = compat(link());
    const second = compat(el("a[data-id=out2]"));
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(card()).toBe("out2");
    expect(committed).toEqual([]);
  });

  /* The first press belongs to A and began while no card was open. A Pencil's
     hover timer then opens A, and a second press replaces a singleton
     `lastPress` before the first click arrives. That first click must keep the
     first press's closed snapshot rather than borrowing the second's `open: A`. */
  it("a grouped first click cannot borrow a later press's open card", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        fire("pointerover", link(), { pointerType: "pen" });
        fire("pointerdown", link(), { pointerType: "pen" });
        vi.advanceTimersByTime(400);
        fire("pointerup", link(), { pointerType: "pen" });
      });
      expect(card()).toBe("out");

      press(el("a[data-id=out2]"), { pointerType: "pen" });
      const first = compat(link(), { pointerType: "pen" });
      expect(first.defaultPrevented).toBe(true);
      expect(committed).toEqual([]);
      expect(card()).toBe("out");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a card that opened during the tap is not committed by that tap's click", () => {
  /* The guarantee a first tap cannot open the destination rests on this, not
     on the card being closed: a card can open mid-gesture without the tap
     code. Here a focus arrives after the 700ms `focusIn` treats as a touch's
     own — a long press, whose compatibility `mousedown` focuses the link on
     lift — and opens the card before the click lands. */
  it("a late focus opened the card; the click only reveals", () => {
    vi.useFakeTimers();
    try {
      press(link(), { from: { at: 1_000 }, to: { at: 1_750 } });
      const focus = new FocusEvent("focusin", { bubbles: true });
      Object.defineProperty(focus, "timeStamp", { value: 2_500 });
      act(() => {
        link().dispatchEvent(focus);
        vi.advanceTimersByTime(1); // `arm(hit, 0)` opens on a timer
      });
      expect(card()).toBe("out"); // the focus opened it
      const click = compat(link(), { at: 2_510 });
      expect(click.defaultPrevented).toBe(true);
      expect(committed).toEqual([]);
      expect(card()).toBe("out");
    } finally {
      vi.useRealTimers();
    }
  });

  /* A hover-capable Pencil rests over the link, its 320ms timer opens the card
     while the tip is down, and the click comes after. Its first tap. */
  it("a hovering Pencil's timer opened the card; the click only reveals", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        fire("pointerover", link(), { pointerType: "pen" });
        fire("pointerdown", link(), { pointerType: "pen" });
        vi.advanceTimersByTime(400);
        fire("pointerup", link(), { pointerType: "pen" });
      });
      expect(card()).toBe("out");
      compat(link(), { pointerType: "pen" });
      expect(committed).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the other tap targets that live inside a link", () => {
  /* A term inside a link goes to the glossary on its second tap, not to the
     link's destination — links.md § Two things over one phrase. It has to stay
     so when the click is the one deciding. */
  it("a glossary term inside an external link reveals, then commits to the term", () => {
    const first = tap(el("mark[data-term=autopoiesis]"));
    expect(first.defaultPrevented).toBe(true);
    expect(card()).toBe("autopoiesis");
    const second = tap(el("mark[data-term=autopoiesis]"));
    expect(second.defaultPrevented).toBe(true);
    expect(committed).toEqual([{ id: "autopoiesis" }]);
  });

  /* WebKit bug 282988 for the term, not only the link: both clicks say
     `mouse` with the mouse's id. Traced for 260924c, and pinned here because
     the mislabel cases above only ever tap a plain link. GPT Sol, 2026-09-24. */
  it("and does the same when both of its clicks are mislabelled as mouse", () => {
    const term = el("mark[data-term=autopoiesis]");
    press(term);
    const first = compat(term, { pointerType: "mouse", id: 99 });
    expect(first.defaultPrevented).toBe(true);
    expect(card()).toBe("autopoiesis");
    expect(committed).toEqual([]);
    press(term);
    const second = compat(term, { pointerType: "mouse", id: 99 });
    expect(second.defaultPrevented).toBe(true);
    expect(committed).toEqual([{ id: "autopoiesis" }]);
  });

  /* A marker's first tap shows the note; its second follows it, once — and
     TableView's own jump never runs, or the reader would get two. */
  it("a footnote marker previews, then follows exactly once", () => {
    tap(el("a[data-id=note]"));
    expect(card()).toBe("note");
    expect(ancestor.click).toBe(0);
    tap(el("a[data-id=note]"));
    expect(committed).toEqual([{ id: "note" }]);
    expect(ancestor.click).toBe(0);
  });

  /* `mouseup` is no longer swallowed for these, and that is safe only because
     TableView's `onMouseUp` returns for anything inside `a[href]`
     (TableView.tsx § "A link inside a commented passage is a link"). */
  it("leaves the mouseup to TableView, which ignores a link's", () => {
    tap(link());
    expect(ancestor.mouseup).toBe(1);
    expect(ancestor.surface).toBe(0);
  });
});

describe("selection", () => {
  /* A tap whose job was to clear a selection is not asking for a card — that
     is `hadSelection`'s whole reason. But it must not navigate either, which is
     what it used to do. */
  it("the tap that clears a leftover selection stays put and opens nothing", () => {
    select(el("#beside"));
    act(() => {
      fire("pointerdown", link());
      window.getSelection()?.removeAllRanges(); // what the tap itself does
      fire("pointerup", link());
    });
    const click = compat(link());
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe(null);
    expect(committed).toEqual([]);
  });

  /* A live selection is the reader choosing words, and TableView's own click
     handler keeps that click from following the link. Found by GPT Sol's plan
     review: with the link's card already open, a net that ignored the
     selection would have *committed* — opened the page — on a drag. */
  it("a live selection inside a link with its card open does not commit", () => {
    tap(link());
    expect(card()).toBe("out");
    select(link());
    act(() => {
      fire("pointerdown", link());
      fire("pointerup", link());
    });
    compat(link());
    expect(committed).toEqual([]);
    expect(ancestor.click).toBe(1);
  });
});

describe("what the click path leaves alone", () => {
  it("a mouse click on the link, which opens its tab natively as on a desktop", () => {
    act(() => {
      fire("pointerdown", link(), { pointerType: "mouse" });
      fire("pointerup", link(), { pointerType: "mouse" });
    });
    const click = compat(link(), { pointerType: "mouse" });
    expect(click.defaultPrevented).toBe(false);
    expect(ancestor.click).toBe(1);
  });

  it("a no-click touch elsewhere cannot turn a later mouse click into a commit", () => {
    vi.useFakeTimers();
    try {
      act(() => {
        fire("pointerover", link(), { pointerType: "mouse" });
        vi.advanceTimersByTime(400);
      });
      expect(card()).toBe("out");
      press(el("#beside"), { from: { at: 1_000 }, to: { at: 1_080 } });
      expect(card()).toBe(null);

      const click = compat(link(), { at: 3_500, pointerType: "mouse" });
      expect(click.defaultPrevented).toBe(false);
      expect(committed).toEqual([]);
      expect(ancestor.click).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a non-pointing detail-1 activation is not mistaken for a fresh touch", () => {
    press(el("#beside"));
    const click = compat(link(), { pointerType: "", detail: 1 });
    expect(click.defaultPrevented).toBe(false);
    expect(card()).toBe(null);
    expect(committed).toEqual([]);
  });

  it("a click after pointercancel can reveal but cannot commit", () => {
    tap(link());
    expect(card()).toBe("out");
    act(() => {
      fire("pointerdown", link());
      fire("pointercancel", link());
    });

    const click = compat(link());
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([]);
    expect(card()).toBe("out");
  });

  it("a touch click with no observed pointerdown reveals rather than escaping", () => {
    const click = compat(link());
    expect(click.defaultPrevented).toBe(true);
    expect(card()).toBe("out");
    expect(committed).toEqual([]);
  });

  it("an old press can no longer authorize a commit", () => {
    tap(link());
    expect(card()).toBe("out");
    press(link(), { from: { at: 1_000 }, to: { at: 1_080 } });
    const click = compat(link(), { at: 3_500 });
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([]);
    expect(card()).toBe("out");
  });

  it("a missing click cannot lend its open card to the next first tap", () => {
    tap(link());
    expect(card()).toBe("out");

    // This press closes A but produces no click. The next press is the first
    // tap on A from the now-closed state.
    press(el("#beside"));
    expect(card()).toBe(null);
    press(link());
    const click = compat(link());
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([]);
    expect(card()).toBe("out");
  });

  it("a click after a second finger joined cannot commit", () => {
    tap(link());
    expect(card()).toBe("out");
    act(() => {
      fire("pointerdown", link(), { id: 1 });
      fire("pointerdown", link(), { id: 2, isPrimary: false });
      fire("pointerup", link(), { id: 1 });
    });

    const click = compat(link(), { id: 1 });
    expect(click.defaultPrevented).toBe(true);
    expect(committed).toEqual([]);
  });

  /* Enter on a focused link is a click with no press in front of it and a
     `detail` of 0 — even straight after a touch. */
  it("a keyboard Enter on the link just after a touch", () => {
    tap(el("#beside"));
    const click = compat(link(), { x: 0, y: 0, detail: 0 });
    expect(click.defaultPrevented).toBe(false);
    expect(card()).toBe(null);
  });

  it("HTMLElement.click() carries detail 0 and remains programmatic", () => {
    press(el("#beside"));
    let observed: { detail: number; trusted: boolean; alreadyPrevented: boolean } | null = null;
    link().addEventListener(
      "click",
      (event) => {
        observed = {
          detail: event.detail,
          trusted: event.isTrusted,
          alreadyPrevented: event.defaultPrevented,
        };
        event.preventDefault(); // keep jsdom from attempting navigation
      },
      { once: true },
    );
    act(() => link().click());
    expect(observed).toEqual({ detail: 0, trusted: false, alreadyPrevented: false });
    expect(card()).toBe(null);
    expect(committed).toEqual([]);
  });

  /* The card's own "open in a new tab" is the second way to commit. */
  it("a tap on a link inside the card", () => {
    tap(link());
    const click = tap(el("#card-link"));
    expect(click.defaultPrevented).toBe(false);
    expect(committed).toEqual([]);
  });

  /* A term with no link around it keeps the pointerup path it always had, and
     a tap that dismisses a selection is exactly the one it leaves alone. */
  it("a missed tap on a term that is not in a link", () => {
    select(el("#beside"));
    act(() => {
      fire("pointerdown", el("mark[data-term=beta]"));
      window.getSelection()?.removeAllRanges();
      fire("pointerup", el("mark[data-term=beta]"));
    });
    const click = compat(el("mark[data-term=beta]"));
    expect(click.defaultPrevented).toBe(false);
    expect(card()).toBe(null);
    expect(ancestor.click).toBe(1);
  });

  it("a scroll that ended on the link, which the browser does not click", () => {
    act(() => {
      fire("pointerdown", link(), { x: 10, y: 10 });
      fire("pointercancel", link(), { x: 10, y: 10 });
    });
    expect(card()).toBe(null);
  });
});
