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
  focusable = false,
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
    let current: HTMLElement | null = null;
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
      current = null;
      setShown(null);
    };

    const close = () => {
      disarm();
      clearTimeout(closeTimer);
      if (!current) return; // nothing open — the disarm above was the whole job
      closeTimer = setTimeout(shut, HOVER_DELAY.close);
    };

    /** Open against `el` after `wait`, if it is still there and still wanted. */
    const arm = (el: HTMLElement, wait: number) => {
      const data = readRef.current(el);
      if (data === null) return close(); // not ours
      if (el === current) {
        // Already showing it: cancel the close its own edge began.
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
        current = el;
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
      if (hit) return arm(hit, current ? WARM_MS : HOVER_DELAY.open);
      // Inside the card: the reader is reaching for a control in it. Cancel the
      // close that entering it would otherwise have already started.
      if (target?.closest?.(`.${CARD_CLASS}`)) {
        disarm();
        clearTimeout(closeTimer);
        return;
      }
      close();
    };

    /* Leaving the window entirely, which fires no `pointerover` at all. */
    const leave = () => close();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") shut();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerleave", leave);
    document.addEventListener("keydown", key);

    /* Keyboard parity, for targets that are tab stops anyway — see `focusable`.
       No delay on the way in: a reader who tabbed to something asked for it as
       plainly as a click, and 320ms of nothing reads as the key not working. */
    const focusIn = (event: FocusEvent) => {
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
      if (focusable) document.removeEventListener("focusin", focusIn);
      /* And close, because this cleanup runs when `selector` or `focusable`
         changes as well as on unmount. */
      setShown(null);
    };
  }, [refs, selector, focusable]);

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
   * Scoped to the one `.prose` div rather than the document, and mounted only
   * while a card is open, so it costs nothing the rest of the time. Closing
   * rather than re-finding the replacement, because the replacement is only the
   * *same* words by coincidence — the reader may have searched for something
   * that split the run in two.
   *
   * Found by a GPT Sol review, 2026-08-26.
   */
  useEffect(() => {
    if (!shown) return;
    const host = shown.el.closest(".prose") ?? shown.el.parentElement;
    if (!host) return;
    const observer = new MutationObserver(() => {
      if (!shown.el.isConnected) setShown(null);
    });
    observer.observe(host, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shown]);

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

  return { shown, close: () => setShown(null), anchorProps, arrowRef, context };
}
