/**
 * **One card for many triggers, by delegation** — the machinery the reading
 * view's block-link card (BlockLinkCard.tsx) and the app's page-wide `data-tip`
 * card (TipCard.tsx) share.
 *
 * Lifted out of BlockLinkCard.tsx on 2026-10-17, when `data-tip` stopped being
 * the gutter's and became the app's (Greg, spya-q04h98: *"replace with rich
 * tooltips … how can we ensure this going forwards?"*;
 * docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md).
 * A second card with a copy of this hover intent is what BlockLinkCard's header
 * had argued against, so the intent moved here and each card keeps only its
 * own policy: what a trigger is, what its card says, where it points.
 *
 * What lives here: a delegated `pointerover` / `pointerout` / `focusin` /
 * `focusout` pair on the document, with `Tooltip.tsx`'s delays and the warm
 * swap; a finger ignored (a tap follows the control); a card closed when React
 * removes its trigger without a `pointerout`; a card re-read when its trigger's
 * words change while it is open; `aria-describedby` on the trigger while open,
 * merged with any it had and restored after; the open `<dialog>` as the portal
 * root; Escape. What does not: anything only one card does — the reading-time
 * line's virtual reference, its press, its close-on-scroll, the index refresh —
 * which the card does with the {@link DelegatedCardControls} this returns.
 *
 * Triggers are `Element`, not `HTMLElement`: a bar of an SVG chart is one.
 */
import {
  FloatingArrow,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  useTransitionStyles,
  type ReferenceType,
} from "@floating-ui/react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isImeComposing } from "./key-chord.js";
import { DELAY } from "./tooltip-delay.js";

export interface DelegatedCardSpec {
  /** What counts as a trigger; matched with `closest` from the event's target. */
  selector: string;
  /**
   * A match to leave alone — another card owns it. Given the event's target as
   * well, because the owner may be an ancestor of the target and not the match.
   */
  ignore?: ((el: Element, target: Element) => boolean) | undefined;
  /** What the card draws for this trigger, or null for no card. */
  contentFor: (el: Element) => ReactNode | null;
  /** Where the card points; the element itself unless said otherwise. */
  referenceFor?: ((el: Element, clientY: number | undefined) => ReferenceType) | undefined;
  /** Whether the open card becomes this trigger's description. Yes unless said. */
  describes?: ((el: Element) => boolean) | undefined;
  /** Attributes whose change, while the card is open, re-reads its content. */
  observeAttributes?: readonly string[] | undefined;
  /** The inner panel's classes after `tooltip`: `tip-soon` for a control, `tip-cite` for a passage. */
  cardClass: (el: Element) => string;
}

export interface DelegatedCardControls {
  /** The open trigger, or null. */
  current: () => Element | null;
  /** Whether the open card was opened with {@link DelegatedCardControls.openNow}'s `pressed`. */
  pressed: () => boolean;
  /** Open on this element at once, cancelling any pending open or close. */
  openNow: (el: Element, clientY?: number, pressed?: boolean) => void;
  /** Move the open card's reference, keeping it open (a reading line re-entered lower down). */
  repoint: (el: Element, clientY: number | undefined) => void;
  /** Ask `contentFor` again for the open trigger; close if it now says nothing. */
  refresh: () => void;
  close: () => void;
}

/** Does this focused element show a focus ring — i.e. did a keyboard put it there? */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    // An engine that cannot answer (jsdom): open, which is what a keyboard wants.
    return true;
  }
}

/**
 * The card and its controls. The spec is read through a ref on every event, so
 * its callbacks may close over props without re-registering the listeners.
 */
export function useDelegatedCard(spec: DelegatedCardSpec): {
  card: ReactNode;
  controls: DelegatedCardControls;
  /** The open trigger, as state, for effects that follow it. */
  open: Element | null;
} {
  const specRef = useRef(spec);
  specRef.current = spec;
  const [shown, setShown] = useState<{ el: Element; content: ReactNode } | null>(null);
  const cardId = useId();
  const arrowRef = useRef<SVGSVGElement>(null);
  const currentRef = useRef<Element | null>(null);
  const pressedRef = useRef(false);
  /* The timers live in refs rather than in the listener effect, so a card's own
     gesture (`openNow`) can cancel what hover had armed. */
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Element | null>(null);

  const { refs, floatingStyles, context, isPositioned } = useFloating({
    open: shown !== null,
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip({ padding: 10, fallbackAxisSideDirection: "end" }),
      shift({ padding: 10 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: { open: 120, close: 80 },
    initial: { opacity: 0, transform: "scale(0.97)" },
  });

  const controls = useMemo<DelegatedCardControls>(() => {
    const shut = () => {
      currentRef.current = null;
      pressedRef.current = false;
      setShown(null);
    };
    const cancel = () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      pending.current = null;
    };
    const openNow = (el: Element, clientY?: number, pressed = false) => {
      cancel();
      pressedRef.current = false;
      if (!el.isConnected) return shut();
      const content = specRef.current.contentFor(el);
      if (content === null) return shut();
      currentRef.current = el;
      pressedRef.current = pressed;
      // Before the state, so the reference exists when the panel mounts.
      refs.setPositionReference(specRef.current.referenceFor?.(el, clientY) ?? el);
      setShown({ el, content });
    };
    return {
      current: () => currentRef.current,
      pressed: () => pressedRef.current,
      openNow,
      repoint: (el, clientY) => {
        if (el === currentRef.current) refs.setPositionReference(specRef.current.referenceFor?.(el, clientY) ?? el);
      },
      refresh: () => {
        const el = currentRef.current;
        if (!el) return;
        const content = specRef.current.contentFor(el);
        if (content === null) shut();
        else setShown({ el, content });
      },
      close: () => {
        cancel();
        shut();
      },
    };
  }, [refs]);

  /* The card is the open trigger's description, and only the open trigger's.
     Set on the element rather than rendered, because the triggers belong to
     panels that do not know the card exists. Added to and taken from a list,
     so a description the trigger already had survives. */
  useEffect(() => {
    const el = shown?.el;
    if (!el || el.getAttribute("aria-hidden") === "true") return;
    if (specRef.current.describes && !specRef.current.describes(el)) return;
    const had = el.getAttribute("aria-describedby");
    el.setAttribute("aria-describedby", had ? `${had} ${cardId}` : cardId);
    return () => {
      if (had) el.setAttribute("aria-describedby", had);
      else el.removeAttribute("aria-describedby");
    };
  }, [shown, cardId]);

  /* React can remove a hovered trigger without sending `pointerout` — closing a
     dialog and replacing a streamed answer both do it. Floating UI otherwise
     keeps the detached node as its reference and leaves the card at its last
     coordinates. Observe only while a card is open, and dismiss only the card
     whose own anchor disappeared. And a trigger's words can change under an
     open card (the permalink's *Copied*, the "…" becoming ✕), on the same
     element, so nothing else would notice: re-read them, the open one's only. */
  useEffect(() => {
    const el = shown?.el;
    if (!el) return;
    const closeIfDetached = () => {
      if (el.isConnected || currentRef.current !== el) return;
      currentRef.current = null;
      setShown((open) => (open?.el === el ? null : open));
    };
    closeIfDetached();
    const observer = new MutationObserver(closeIfDetached);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const watched = specRef.current.observeAttributes;
    const reword = new MutationObserver(() => {
      if (currentRef.current === el) controls.refresh();
    });
    if (watched && watched.length > 0) reword.observe(el, { attributes: true, attributeFilter: [...watched] });
    return () => {
      observer.disconnect();
      reword.disconnect();
    };
  }, [shown, controls]);

  /* Delegated on the document: the triggers are in every panel and come and go
     with them, and one listener set costs the same however many there are.
     Hysteresis as in useHoverCard.ts: `pending` is the trigger an open timer is
     armed for, `current` the one showing. */
  useEffect(() => {
    const close = () => {
      clearTimeout(openTimer.current);
      pending.current = null;
      clearTimeout(closeTimer.current);
      if (currentRef.current) closeTimer.current = setTimeout(() => controls.close(), DELAY.close);
    };
    const arm = (el: Element, wait: number, clientY: number) => {
      clearTimeout(closeTimer.current);
      if (el === currentRef.current) return controls.repoint(el, clientY);
      if (el === pending.current) return;
      clearTimeout(openTimer.current);
      pending.current = el;
      openTimer.current = setTimeout(() => controls.openNow(el, clientY), wait);
    };
    const hit = (target: EventTarget | null): Element | null => {
      const from = target as Element | null;
      const el = from?.closest?.(specRef.current.selector) ?? null;
      if (!el || !from) return null;
      return specRef.current.ignore?.(el, from) ? null : el;
    };

    const over = (e: PointerEvent) => {
      /* A finger fires `pointerover` too, on the tap that presses the control.
         No card for it: the control's own response is the confirmation, and a
         card left behind would be one more thing to dismiss. */
      if (e.pointerType === "touch") return close();
      const el = hit(e.target);
      if (el) arm(el, currentRef.current ? 0 : DELAY.open, e.clientY);
      else close();
    };
    const out = (e: PointerEvent) => {
      const el = hit(e.target);
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      close();
    };
    const focusIn = (e: FocusEvent) => {
      const el = hit(e.target);
      if (!el || !focusVisible(el)) return;
      controls.openNow(el);
    };
    const focusOut = (e: FocusEvent) => {
      if (hit(e.target)) close();
    };
    /* **Escape shuts the card, and only the card** — one press, one surface
       (tests/one-escape-closes-one-surface.test.tsx, plans 260906f and
       261010s). A card that is showing takes the press for itself, so the
       dialog, editor or outer card behind it waits for the next one; a card
       still waiting out its delay is cancelled and the press goes on, because
       the reader cannot see it. On window capture with
       `stopImmediatePropagation`, before an outer hover card's document
       listener (useHoverCard.ts). The Dock drawer has higher priority but
       registers its window listener only when it opens, after this one may
       have mounted. Yield explicitly while its scrim exists: registration
       order does not express which surface is in front.

       **An open native `<dialog>` outranks it**, as it does every surface here
       (useEscapeToClose.ts): its Escape is the platform's own close request,
       which no listener can stop, so taking the press would close the dialog
       anyway and leave its other listeners unheard. The card closes and the
       press goes on. Never a press an input method is using. */
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isImeComposing(e)) return;
      if (!currentRef.current) {
        if (pending.current) controls.close();
        return;
      }
      controls.close();
      if (document.querySelector("dialog[open], .dock-scrim") === null) e.stopImmediatePropagation();
    };

    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    window.addEventListener("keydown", key, { capture: true });
    return () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
      currentRef.current = null;
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
      window.removeEventListener("keydown", key, { capture: true });
    };
  }, [controls]);

  useEffect(() => {
    if (!shown) refs.setPositionReference(null);
  }, [refs, shown]);

  /* What the card last said, so it can fade out saying it rather than blank. */
  const last = useRef(shown);
  if (shown) last.current = shown;
  const drawn = last.current;

  let card: ReactNode = null;
  if (isMounted && drawn) {
    /* A native modal dialog lives in the browser's top layer. A portal under
       `<body>` cannot paint above it at any z-index, so keep the card inside the
       open dialog when its own anchor is there. Outside a dialog, FloatingPortal
       retains its ordinary body root. */
    const portalRoot = drawn.el.closest<HTMLDialogElement>("dialog[open]") ?? undefined;
    card = (
      <FloatingPortal root={portalRoot}>
        <div
          ref={refs.setFloating}
          id={cardId}
          role="tooltip"
          className="tooltip-anchor"
          style={{ ...floatingStyles, visibility: isPositioned ? "visible" : "hidden" }}
        >
          <div className={`tooltip ${spec.cardClass(drawn.el)}`} style={styles}>
            {drawn.content}
            {/* fill and stroke are props, not CSS — Tooltip.tsx says why. */}
            <FloatingArrow
              ref={arrowRef}
              context={context}
              className="tooltip-arrow"
              width={12}
              height={6}
              tipRadius={1}
              fill="var(--surface-raised)"
              stroke="var(--rule-strong)"
              strokeWidth={1}
            />
          </div>
        </div>
      </FloatingPortal>
    );
  }
  return { card, controls, open: shown?.el ?? null };
}
