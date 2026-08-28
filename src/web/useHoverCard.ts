/**
 * A hover card over **injected HTML** — one floating panel for the whole page,
 * anchored to whichever element the pointer is on.
 *
 * ## Why this exists as a hook rather than as a component
 *
 * `Tooltip.tsx` takes a React element and clones event handlers onto it. That
 * is the right shape for a spine band or a button, and the wrong shape for the
 * verbatim column, which is written with `dangerouslySetInnerHTML`: the
 * glossary marks and the article's own links are parsed out of a string, so
 * there is no component to hand a ref to, and there are hundreds of them on a
 * long article — one Floating UI instance each, for the one the reader is
 * pointing at.
 *
 * So: one panel, positioned with `setPositionReference` against a node found by
 * hit-testing, and the hover intent as a delegated listener plus timers.
 *
 * **Extracted on 2026-08-27, from `TermTooltip.tsx` (now ProseHoverCard.tsx), at the second customer.**
 * The file it came from said this in as many words — *"if a third customer ever
 * has both properties … that is the point at which this becomes a shared
 * hook"* — and then links turned up needing the identical machinery one day
 * later. Two copies would have been the wrong number for a specific reason:
 * every bug this feature has had has been in *here* (a pending open that no
 * leaving event cancelled, a card left pinned to a detached node), and a second
 * copy is a second place to fix each of them.
 *
 * A survey of the alternatives — Radix `HoverCard`, Base UI `PreviewCard`,
 * Ariakit `Hovercard`, `react-laag` — is in docs/project/tooltips.md. Every one
 * of them is a `Trigger` that wraps one React element, which is the property
 * that rules them all out here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";

/**
 * Long enough that a pointer crossing the prose on its way to the scrollbar
 * does not fire a card at every underlined word it passes.
 *
 * Closing is slow enough to cross the 8px gap between the words and the card,
 * because unlike the spine's tooltips these panels can be pointed at.
 */
export const HOVER_DELAY = { open: 320, close: 220 } as const;

/** Once a card is open, the next target the pointer lands on swaps in at once. */
const WARM_MS = 60;

/** The panel the pointer may move into without the card closing behind it. */
const CARD_CLASS = "hover-card";

/**
 * How far a finger may travel between going down and coming up and still be a
 * tap rather than a scroll.
 *
 * Smaller than the swipe's 24px (swipe.ts § SWIPE_MIN), and deliberately: the
 * two mistakes cost different things here. Reading a scroll as a tap opens a
 * card the reader did not ask for over the words they were trying to read
 * *past*; missing a tap costs them a second try at a stationary target. Apple's
 * own slop is around 10px, so this is the platform's number rather than ours.
 */
const TAP_SLOP = 10;

/**
 * How long, and how far, the compatibility events after a handled tap are eaten.
 *
 * **A deadline *and* a place**, which is the shape swipe.ts arrived at the hard
 * way (docs/project/touch.md § the click afterwards is eaten): a one-shot
 * listener armed for "the next click" never fires when no click comes, and then
 * sits waiting to eat the reader's next real tap instead. Bounded on both axes
 * it cannot outlive its own gesture. `click` also disarms it, so in the
 * ordinary case the window closes within a frame or two of opening.
 */
const SWALLOW = { ms: 400, px: 24 } as const;

/**
 * Put on the words a finger has opened a card against, and taken off again
 * when it closes.
 *
 * **Its own attribute rather than `[data-term-open]`**, which already means
 * "the entry pressed in the glossary panel" — two states with one name would
 * make a tapped term look selected in a mode the reader is not in. Asked for by
 * a GPT Sol review, 2026-08-27, on the grounds that a second tap commits and
 * the reader has to be able to see which words are armed for it. iOS's sticky
 * `:hover` is not that: it survives the card being dismissed.
 *
 * Written straight onto injected HTML, which is safe in the one direction that
 * matters — React replaces those nodes wholesale rather than reconciling their
 * attributes, so a stale mark leaves with the node it was on.
 */
const TAP_ATTR = "data-hover-tap";

/**
 * How long a finger may stay down and still be tapping.
 *
 * iOS raises the callout menu at around 500ms, so anything past this is a press
 * the platform has already given another meaning. It is the third guard on the
 * same case rather than the only one — see `isTap` — and that is deliberate:
 * `contextmenu` is the reliable signal and the spec declines to say when it
 * arrives, so the belt has to work without it.
 */
const TAP_MAX_MS = 600;

/**
 * How long after a finger touches the screen a `focusin` is assumed to be that
 * touch's rather than a keyboard's.
 *
 * Generous, because the cost of the two mistakes is not symmetric: ignoring one
 * genuine tab-key focus loses a card the reader can get back by tabbing again,
 * and honouring a touch's focus hands the card to the wrong element for the
 * rest of the gesture.
 */
const TOUCH_FOCUS_MS = 700;

/** Where a finger went down, what was true then, and the furthest it has been. */
interface Press {
  id: number;
  x: number;
  y: number;
  moved: number;
  /** `event.timeStamp` at `pointerdown`. */
  at: number;
  /** Whether the reader already had text selected when the finger landed. */
  hadSelection: boolean;
}

/**
 * Was that a tap, or was it the reader doing something else entirely?
 *
 * Pulled out of the handler because it is the half worth reading on its own —
 * every one of these tests is a specific way a finger on prose is *not* asking
 * for a card, and every one was raised by a GPT Sol review, 2026-08-27.
 *
 * - The press has to be the one we started. A second finger, or a non-primary
 *   pointer, drops the gesture at `pointerdown`, so a pinch can neither open
 *   nor commit.
 * - **Travel is the running maximum, not the endpoint distance.** A scroll that
 *   overshoots and settles comes back to where it started.
 * - **A selection at either end disqualifies it, and the two catch different
 *   things.** One live at `pointerup` means the finger was drawing across the
 *   words to choose a phrase, which is how a question gets asked here
 *   (TableView § onMouseUp). One live at `pointerdown` and gone by `pointerup`
 *   means this tap was the reader *dismissing* a selection — which looked
 *   exactly like a term tap until the second review pointed it out.
 * - **And it has to be quick**, because a long press moves nothing, selects
 *   nothing until the platform says so, and would otherwise pass all of the
 *   above.
 */
function isTap(press: Press | null, event: PointerEvent, selection: Selection | null): boolean {
  if (!press || press.id !== event.pointerId) return false;
  if (press.hadSelection) return false;
  if (event.timeStamp - press.at > TAP_MAX_MS) return false;
  const travelled = Math.max(
    press.moved,
    Math.hypot(event.clientX - press.x, event.clientY - press.y),
  );
  if (travelled > TAP_SLOP) return false;
  return !selection || selection.isCollapsed;
}

export interface HoverTarget<T> {
  /** The element the card is anchored to. */
  el: HTMLElement;
  /** Whatever `read` made of it. */
  data: T;
}

export interface UseHoverCard<T> {
  /** The target under the pointer, or null. */
  shown: HoverTarget<T> | null;
  /** Close now, with no delay — for a card whose own button was pressed. */
  close(): void;
  /** Spread onto the positioned wrapper. Includes the class the machine needs. */
  anchorProps: {
    ref: (node: HTMLElement | null) => void;
    style: React.CSSProperties;
    className: string;
  };
  /** For `<FloatingArrow context={…} ref={…}>`. */
  arrowRef: React.RefObject<SVGSVGElement | null>;
  context: ReturnType<typeof useFloating>["context"];
}

export function useHoverCard<T>({
  selector,
  read,
  host,
  focusable = false,
  tapSelector,
  onCommit,
}: {
  /** What the pointer has to be on. `"mark.term"`, `"a[href]"`. */
  selector: string;
  /**
   * What to show for this element, or null for "not one of mine".
   *
   * Called on every `pointerover` that hits `selector`, so it must be cheap —
   * read attributes, look things up in a Map, do not scan the article.
   *
   * Returning null is how one machine declines an element another machine
   * owns, and it is also the honest answer for a mark whose entry we no longer
   * hold: a card with nothing in it is worse than no card.
   */
  read: (el: HTMLElement) => T | null;
  /**
   * The container to watch for the anchor being replaced under an open card —
   * see the observer at the foot of this file.
   *
   * It has to be an ancestor that **survives** the re-render, which is why it
   * is a caller's choice rather than `parentElement`. A glossary mark's
   * paragraph is rewritten in place, so its parent is fine; a link in a chat
   * answer has its whole `<p>` replaced as the answer streams, and a
   * `MutationObserver` on the old detached `<p>` never fires for the `<p>`
   * itself being removed — so the card would stay pinned to a node that has
   * left the document.
   */
  host?: string;
  /**
   * Also open on keyboard focus.
   *
   * **False for glossary marks and true for links, and the difference is not a
   * preference.** A `<mark>` is not focusable and making several hundred of
   * them into tab stops would be worse than the gap it leaves; an `<a href>`
   * already *is* a tab stop, so a reader tabbing through the prose lands on one
   * whether we listen or not, and opening the same card their pointer would get
   * is the whole of what keyboard parity costs here. `focusin`/`focusout`
   * rather than `focus`/`blur`, because only the first pair bubbles and this is
   * a delegated listener. Pointed out by a survey of the alternatives,
   * 2026-08-27.
   */
  focusable?: boolean;
  /**
   * Which targets a **finger** opens the card on. Undefined means none, and
   * then a touch device gets exactly what it got before this existed: nothing.
   *
   * Deliberately narrower than `selector` rather than equal to it. A glossary
   * mark does nothing under a finger today, so a tap on one is free to mean
   * something; a hyperlink already navigates, and taking that over to show a
   * preview would replace a working affordance with a slower one. See
   * docs/plans/touch-glossary-card.md.
   */
  tapSelector?: string;
  /**
   * A tap on the target whose card is **already** open.
   *
   * The spine's `bandPress` rule, and the same reasoning: on a surface with no
   * hover the first press has to be allowed to mean "show me", or the reader
   * commits blind. So the first tap reveals and the second one acts. Without
   * this the underline is a dead end on an iPad — the card would open and its
   * one way out would be a button, which is a smaller target than the words.
   *
   * **The card is left open and the target left current: closing is yours.**
   * That is what lets a consumer honestly decide a second tap means *nothing* —
   * two glossary terms overlapping one phrase have no order worth committing
   * to. The cost is that a consumer which acts without closing turns every
   * later tap on those words into a swallowed no-op, so close when you act.
   * Flagged as a trap for the next consumer by a GPT Sol code review,
   * 2026-08-27.
   */
  onCommit?: (target: HoverTarget<T>) => void;
}): UseHoverCard<T> {
  const [shown, setShown] = useState<HoverTarget<T> | null>(null);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: shown !== null,
    placement: "top",
    // The reference is inside a scrolling table, so it moves against the
    // viewport on every scroll event and the panel has to follow it.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 12, fallbackAxisSideDirection: "end" }),
      shift({ padding: 12 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  /* `read` is called from inside a listener that must not be rebound on every
     render, so it is held in a ref rather than named as a dependency. The
     listener always sees the latest one. */
  const readRef = useRef(read);
  readRef.current = read;
  /* Same reason, and it matters more here: a consumer's `onCommit` closes over
     props that change on every render, and naming it as a dependency would tear
     down and rebuild every listener below several times a second. */
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  /**
   * Whether the open card was opened by a finger.
   *
   * A ref rather than state because two things outside the listener effect
   * need it and neither should re-render on it: the scroll dismissal (a card a
   * pointer is resting on must survive a scroll, one a finger tapped open must
   * not) and the mark that says which words are armed for a second tap.
   */
  const byTouchRef = useRef(false);
  /**
   * The element the open card belongs to.
   *
   * A ref rather than a local in the listener effect so that the `close` this
   * hook hands back can clear it. It could not before, and the card a consumer
   * closed from its own button was then unreopenable against the same words —
   * every path tests `el === current` first and takes it to mean "already
   * showing". It only ever *looked* fixed because pressing that button changes
   * a mode, which re-annotates the prose and replaces the node.
   */
  const currentRef = useRef<HTMLElement | null>(null);

  /* `setPositionReference` rather than `setReference`: the reference is a plain
     DOM node found by hit-testing, not something React rendered, so there is no
     ref to give it. This effect only ever *clears* it — the setting is done in
     the handler, before the state, so the reference exists by the time React
     mounts the panel. Without that, Floating UI's first `floatingStyles` put an
     unpositioned element at the top-left of the page, and the card flickers in
     the corner on its way to the words. `isPositioned` closes the same gap from
     the other end. */
  useEffect(() => {
    if (!shown) refs.setPositionReference(null);
  }, [refs, shown]);

  /* The whole interaction: which element the pointer is on, with hysteresis.

     Delegated on the document rather than bound per element, because these are
     injected HTML that React re-creates whenever the prose re-renders — a
     listener attached to one would be attached to a node that no longer exists
     the next time the reader searches for something. (What that does *not* buy
     us is an open card following the replacement; see the observer below.)

     `pointerover` on *everything*, not `pointerout` on the targets: every
     element the pointer enters fires it, so "left it" needs no `relatedTarget`
     arithmetic — it is simply an over event on something that is neither a
     target nor the card. That is also what makes moving between two adjacent
     targets one swap rather than a close and an open.

     **`pending` is separate from `current`, and that separation is a bug fix.**
     Everything used to key off `current`, which stays null until the open timer
     fires — so a pointer that crossed a target and moved on within the 320ms
     delay cancelled nothing, and the card opened afterwards over prose the
     pointer had long left, with no event coming to close it again. Found by a
     GPT Sol review, 2026-08-26. */
  useEffect(() => {
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    /** The element an open timer is armed for. Null whenever none is armed. */
    let pending: HTMLElement | null = null;

    /** Cancel a pending open. Never touches an open card. */
    const disarm = () => {
      clearTimeout(openTimer);
      pending = null;
    };

    const shut = () => {
      disarm();
      clearTimeout(closeTimer);
      currentRef.current = null;
      byTouchRef.current = false;
      setShown(null);
    };

    const close = () => {
      disarm();
      clearTimeout(closeTimer);
      if (!currentRef.current) return; // nothing open — the disarm above was the whole job
      closeTimer = setTimeout(shut, HOVER_DELAY.close);
    };

    /** Open against `el` after `wait`, if it is still there and still wanted. */
    const arm = (el: HTMLElement, wait: number) => {
      const data = readRef.current(el);
      if (data === null) return close(); // not ours
      if (el === currentRef.current) {
        // Already showing it: cancel the close its own edge began. And take it
        // over from the finger that may have opened it — otherwise a scroll
        // would dismiss a card a pointer is resting on. GPT Sol, 2026-08-27.
        byTouchRef.current = false;
        disarm();
        clearTimeout(closeTimer);
        return;
      }
      if (el === pending) return; // its timer is already running
      disarm();
      clearTimeout(closeTimer);
      pending = el;
      openTimer = setTimeout(() => {
        pending = null;
        /* The element may have been replaced during the delay — any search
           keystroke re-annotates the prose. Opening against a node that is no
           longer in the document pins the card wherever that node last was. */
        if (!el.isConnected) return;
        currentRef.current = el;
        // A pointer opened this one, whatever opened the last one.
        byTouchRef.current = false;
        refs.setPositionReference(el);
        setShown({ el, data });
      }, wait);
    };

    const over = (event: PointerEvent) => {
      /* Mouse and pen only. A touch fires `pointerover` on the tap and never
         fires the leaving one, so on an iPad this would open a card that stays
         until something else is tapped — and the tap the reader made was
         probably the start of a selection. docs/project/touch.md. */
      if (event.pointerType === "touch") return;
      const target = event.target as Element | null;
      const hit = target?.closest?.(selector) as HTMLElement | null;
      if (hit) return arm(hit, currentRef.current ? WARM_MS : HOVER_DELAY.open);
      // Inside the card: the reader is reaching for a control in it. Cancel the
      // close that entering it would otherwise have already started.
      if (target?.closest?.(`.${CARD_CLASS}`)) {
        disarm();
        clearTimeout(closeTimer);
        return;
      }
      close();
    };

    /* ------------------------------------------------------------ touch --

       A finger, which has no hover to rest and so gets the spine's rule
       instead: the first tap reveals the card, the second commits.
       docs/plans/touch-glossary-card.md has the whole design.

       **Decided at `pointerup`, not at `click`**, and the reason is the
       swallow below rather than the tap. `mouseup` comes *before* `click` in
       the compatibility sequence iOS synthesises, and `mouseup` is where
       TableView opens a chat thread from a `<mark>` — one element can carry
       both `term` and `chat` (annotate.ts § MarkKind), so a decision taken at
       `click` is already one event too late to stop that. Pointer events also
       have none of the legacy about which taps reach a document-level `click`
       listener on iOS. */
    /**
     * The finger that is down — see `isTap`, which is where it is judged.
     *
     * `moved` is tracked rather than trusting `pointercancel` to report a
     * scroll: a permitted pan is *supposed* to cancel the stream, but a
     * disallowed-axis drag, an edge gesture and at least one live WebKit defect
     * all end in a plain `pointerup` instead. GPT Sol, 2026-08-27.
     */
    let down: Press | null = null;
    /** Where and when a tap of ours happened, while its mouse events arrive. */
    let handled: { x: number; y: number; at: number } | null = null;
    /**
     * When a finger was last on the screen, so `focusin` can tell a keyboard
     * apart from a touch.
     *
     * A touch browser focuses the `<a>` a tap lands in, and `focusin` opens
     * with no delay and marks the card as pointer-opened — which would move the
     * anchor from the mark to its enclosing link, drop the tapped styling, and
     * turn the next tap into a second reveal rather than a commit. Found by a
     * GPT Sol code review, 2026-08-27.
     */
    let lastTouchAt = Number.NEGATIVE_INFINITY;

    const pointerDown = (event: PointerEvent) => {
      /* Any new press ends the last tap's swallow window, whether or not the
         compatibility events it was waiting for ever arrived. This is the rule
         swipe.ts already follows, and the reason is the same: an arm that can
         outlive its own gesture waits around to eat the reader's next real
         tap. With this, staleness is bounded by the next touch rather than by
         a timer. */
      handled = null;
      if (event.pointerType !== "touch" || !tapSelector) return;
      lastTouchAt = event.timeStamp;
      /* A second finger is a pinch, and a pinch is not a tap. Dropping the
         gesture rather than tracking two: zoom has to survive, and the same
         rule is what swipe.ts does with a non-primary pointer. `isPrimary` is
         the other half of it — the platform's own word for "this is the one
         that generates the compatibility events". */
      if (down || !event.isPrimary) {
        down = null;
        return;
      }
      const selection = window.getSelection();
      down = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: 0,
        at: event.timeStamp,
        /* Read now, not at `pointerup`: a tap that *dismisses* a selection has
           collapsed it by the time the finger lifts, and would otherwise be
           indistinguishable from a tap on a term. */
        hadSelection: selection !== null && !selection.isCollapsed,
      };
    };

    const pointerMove = (event: PointerEvent) => {
      if (!down || event.pointerId !== down.id) return;
      down.moved = Math.max(
        down.moved,
        Math.hypot(event.clientX - down.x, event.clientY - down.y),
      );
    };

    /* The browser has taken the gesture for itself — a scroll, a pinch, a palm.
       Every one of those means the same thing here, which is that no tap
       happened. Without this a scroll that began on a term and ended on one
       would open a card on the way past. */
    const pointerCancel = () => {
      down = null;
    };

    /**
     * A long press is iOS asking for the callout menu, and it is how a reader
     * selects a phrase to ask a question about (TableView § onMouseUp).
     *
     * **It undoes, rather than merely cancelling.** The Pointer Events spec
     * declines to fix where `contextmenu` sits relative to `pointerup`, so it
     * may arrive *after* the tap has already opened a card and armed the
     * swallow — at which point dropping the pending press achieves nothing.
     * So this takes all three back. Raised by a GPT Sol code review,
     * 2026-08-27; the duration test in `isTap` is the guard for the case where
     * `contextmenu` never comes at all.
     */
    const contextMenu = () => {
      down = null;
      handled = null;
      if (byTouchRef.current) shut();
    };

    const pointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !tapSelector) return;
      lastTouchAt = event.timeStamp;
      const start = down;
      down = null;
      if (!isTap(start, event, window.getSelection())) return;

      const target = event.target as Element | null;
      /* Inside the card: the reader is reaching for "in the glossary" or "open
         in a new tab". Leave the event entirely alone — swallowing it would
         swallow the press they came for. */
      if (target?.closest?.(`.${CARD_CLASS}`)) return;

      const hit = target?.closest?.(tapSelector) as HTMLElement | null;
      const data = hit ? readRef.current(hit) : null;
      if (!hit || data === null) {
        /* A tap on something else. It closes the card and is otherwise none of
           our business — that tap is a gist cell's jump, or a link, or a word
           the reader is about to select. */
        if (currentRef.current) shut();
        return;
      }

      handled = { x: event.clientX, y: event.clientY, at: event.timeStamp };
      if (hit === currentRef.current) {
        /* The card is left open and `currentRef.current` left set: what a second tap
           *means* is the consumer's to decide, and it may honestly decide
           "nothing" — two glossary terms overlapping one phrase have no order
           worth committing to. So the consumer closes the card if it acts.
           Raised by a GPT Sol review, 2026-08-27. */
        commitRef.current?.({ el: hit, data });
        return;
      }
      /* Open now rather than after `HOVER_DELAY.open`. A tap is a request, not
         a pointer coming to rest, and there is no crossing-the-prose case to
         defend against — the finger was put down on the word deliberately. */
      disarm();
      clearTimeout(closeTimer);
      currentRef.current = hit;
      byTouchRef.current = true;
      refs.setPositionReference(hit);
      setShown({ el: hit, data });
    };

    /**
     * A card a finger opened does not follow the article away.
     *
     * `autoUpdate` keeps the panel glued to its anchor through a scroll, which
     * is right for a pointer — the pointer is on the words, so the words are on
     * screen. A finger is not resting anywhere: the reader taps, reads, and
     * then scrolls, and the card would ride to the edge of the viewport that
     * `shift` pins it to and sit over the prose with nothing to dismiss it. A
     * rotation and a split-view resize are the same story.
     *
     * Only for a touch-opened card, so the desktop behaviour is untouched.
     * Raised by a GPT Sol review, 2026-08-27.
     */
    const dismiss = (event?: Event) => {
      /* Unless the scroll is *inside* the card, which is the reader reading it.
         A footnote preview is a whole note and taller than the panel, so on a
         phone the first thing a finger does with an open card is scroll it — and
         without this that dismisses the card it is scrolling. `scroll` does not
         bubble, hence the capture listener, and its target for a page scroll is
         the document rather than an element. */
      const target = event?.target;
      if (target instanceof Element && target.closest(`.${CARD_CLASS}`)) return;
      if (byTouchRef.current) shut();
    };

    /* The compatibility mouse events that follow a tap we have already acted
       on. `click` is the one that navigates when the term sits inside one of
       the article's own hyperlinks, so it is cancelled outright; `mouseup` is
       only stopped, because cancelling a `mouseup` interferes with selection
       and swipe.ts had to learn that once already.

       Both are capture-phase on `document`, which is above React's root
       container and therefore ahead of TableView's handlers. */
    const swallowed = (event: MouseEvent) => {
      if (!handled) return;
      const stale = event.timeStamp - handled.at > SWALLOW.ms;
      const elsewhere =
        Math.hypot(event.clientX - handled.x, event.clientY - handled.y) > SWALLOW.px;
      if (stale || elsewhere) {
        handled = null;
        return;
      }
      if (event.type === "click") {
        handled = null;
        event.preventDefault();
      }
      event.stopPropagation();
    };

    /* Leaving the window entirely, which fires no `pointerover` at all. */
    const leave = () => close();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") shut();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("keydown", key);
    /* All seven only for a consumer that opted into touch. `pointermove` on the
       document is the one that would actually cost something otherwise — it
       would run on every mouse move on the page to read one null. */
    if (tapSelector) {
      document.addEventListener("pointerdown", pointerDown);
      document.addEventListener("pointermove", pointerMove, { passive: true });
      document.addEventListener("pointerup", pointerUp);
      document.addEventListener("pointercancel", pointerCancel);
      document.addEventListener("contextmenu", contextMenu);
      document.addEventListener("mouseup", swallowed, true);
      document.addEventListener("click", swallowed, true);
      /* Capture, because the scroller is often an element rather than the page
         and a `scroll` event from one does not bubble. Passive: this only ever
         reads. */
      document.addEventListener("scroll", dismiss, { capture: true, passive: true });
      window.addEventListener("resize", dismiss);
    }

    /* Keyboard parity, for targets that are tab stops anyway — see `focusable`.
       No delay on the way in: a reader who tabbed to something asked for it as
       plainly as a click, and 320ms of nothing reads as the key not working. */
    const focusIn = (event: FocusEvent) => {
      // A finger is on the screen, or was a moment ago: this focus is the tap's,
      // not a reader tabbing through the prose. See `lastTouchAt`.
      if (down || event.timeStamp - lastTouchAt < TOUCH_FOCUS_MS) return;
      const hit = (event.target as Element | null)?.closest?.(selector) as HTMLElement | null;
      if (hit) arm(hit, 0);
      else close();
    };
    if (focusable) document.addEventListener("focusin", focusIn);

    return () => {
      disarm();
      clearTimeout(closeTimer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerleave", leave);
      document.removeEventListener("keydown", key);
      if (tapSelector) {
        document.removeEventListener("pointerdown", pointerDown);
        document.removeEventListener("pointermove", pointerMove);
        document.removeEventListener("pointerup", pointerUp);
        document.removeEventListener("pointercancel", pointerCancel);
        document.removeEventListener("contextmenu", contextMenu);
        document.removeEventListener("mouseup", swallowed, true);
        document.removeEventListener("click", swallowed, true);
        document.removeEventListener("scroll", dismiss, true);
        window.removeEventListener("resize", dismiss);
      }
      if (focusable) document.removeEventListener("focusin", focusIn);
      /* And close, because this cleanup runs when `selector`, `focusable` or
         `tapSelector` changes as well as on unmount. `currentRef` has to be
         cleared with it: leaving it set meant the next tap on that same mark
         was read as a *second* tap and committed. GPT Sol, 2026-08-27. */
      currentRef.current = null;
      byTouchRef.current = false;
      setShown(null);
    };
  }, [refs, selector, focusable, tapSelector]);

  /* Which words a second tap would act on — see `TAP_ATTR`. Only for a card a
     finger opened: on a desktop the pointer is on the words and the card has an
     arrow pointing at them, so there is nothing left to say. */
  useEffect(() => {
    if (!shown || !byTouchRef.current) return;
    const el = shown.el;
    el.setAttribute(TAP_ATTR, "");
    return () => el.removeAttribute(TAP_ATTR);
  }, [shown]);

  /**
   * The prose was re-annotated under an open card.
   *
   * **The delegated listener above survives that; the card does not.** React
   * writes the verbatim column with `dangerouslySetInnerHTML`, so every element
   * in a block is *replaced* whenever its marks change — which happens on every
   * keystroke of a search, on opening a comment, on pressing a term. The node
   * the card is anchored to is then detached, and Floating UI's `autoUpdate`
   * cannot notice: it watches for scroll and resize, and a node quietly leaving
   * the document is neither. The card would sit at the words' last position, or
   * collapse into a corner, and no pointer event is coming to correct it
   * because the pointer has not moved.
   *
   * So: watch the block this card belongs to, and close if its element goes.
   * Scoped to the container the caller named (`host`) rather than to the
   * document, and mounted only while a card is open, so it costs nothing the
   * rest of the time. Closing
   * rather than re-finding the replacement, because the replacement is only the
   * *same* words by coincidence — the reader may have searched for something
   * that split the run in two.
   *
   * Found by a GPT Sol review, 2026-08-26.
   */
  useEffect(() => {
    if (!shown) return;
    /* The fallback is a last resort rather than the ordinary case, and callers
       are expected to name a container — see `host`. `parentElement` is only
       right where the parent outlives the re-render, and a chat answer's `<p>`
       does not. */
    const watched = (host ? shown.el.closest(host) : null) ?? shown.el.parentElement;
    if (!watched) return;
    const observer = new MutationObserver(() => {
      if (shown.el.isConnected) return;
      // Same as the cleanup above: the anchor is gone, so nothing may still be
      // holding it as "the open one".
      currentRef.current = null;
      byTouchRef.current = false;
      setShown(null);
    });
    observer.observe(watched, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shown, host]);

  const anchorProps = useMemo(
    () => ({
      ref: refs.setFloating,
      /* Hidden until Floating UI has measured, which is asynchronous. Without
         it the first frame paints at the top-left corner of the page. */
      style: {
        ...floatingStyles,
        visibility: isPositioned ? ("visible" as const) : ("hidden" as const),
      },
      /* `interactive` turns pointer events back on — every other tooltip here
         is `pointer-events: none` so that a panel can never land under the
         pointer and hold itself open, but these carry controls the reader has
         to be able to reach. `CARD_CLASS` is what the listener above tests. */
      className: `tooltip-anchor interactive ${CARD_CLASS}`,
    }),
    [refs.setFloating, floatingStyles, isPositioned],
  );

  return {
    shown,
    close: () => {
      currentRef.current = null;
      byTouchRef.current = false;
      setShown(null);
    },
    anchorProps,
    arrowRef,
    context,
  };
}
