/**
 * Rich hover cards, over [Floating UI](https://floating-ui.com).
 *
 * **PORTED FROM src/web/Tooltip.tsx**, not imported — this tool may not reach
 * into `src/` (see the header of ui.tsx). Diff the two if either ever looks
 * wrong; the surface they draw is tailwind.css § tooltip, itself a port of
 * src/web/styles/tooltip.css. Why a library at all, and why this one, is
 * docs/project/tooltips.md.
 *
 * ## What is copied, because each of these is a way the obvious version fails
 *
 *  - **The floating node is TWO elements.** `floatingStyles` positions with a
 *    `transform` and the open/close transition wants one too; one element
 *    cannot carry both without the animation fighting the placement. Outer div
 *    positions, inner div animates. Floating UI's own recommendation.
 *  - **It portals to `<body>`.** The dock is `overflow-x: auto` and the cards
 *    its buttons carry are taller than the bar, so a panel rendered inside it
 *    would be clipped to a 48px strip.
 *  - **The arrow's `fill` and `stroke` are PROPS, not CSS.** Given a
 *    `strokeWidth`, `FloatingArrow` draws a second clipped path for the border
 *    and paints over the seam using the `fill` it was passed; a stylesheet rule
 *    wins the cascade over its own `stroke="none"` and draws a line straight
 *    across the arrow's mouth.
 *  - **The card is the trigger's DESCRIPTION, not its name.** `useRole` wires
 *    it up as `aria-describedby`, so any trigger whose visible content is not
 *    already its name needs an `aria-label`.
 *  - **The trigger has to hand over its ref.** `useHover` puts a native
 *    listener on the node the ref gave it, so a trigger that swallows the ref
 *    opens nothing at all — with no error, and looking exactly like a page with
 *    no tooltips on it.
 *
 * ## What is deliberately different here
 *
 * **`mouseOnly` is a prop, and the default is `false`.** In the product every
 * tooltip is a *supplement* to something already on screen, so touch handling
 * is off in the one controlled case and irrelevant everywhere else. This page
 * is read on a phone, where a hover tooltip does not exist at all — so an
 * explanation must open on a tap. The exception is the dock, whose buttons do
 * something when tapped: there a card would land over the panel the tap just
 * opened, so `Dock.tsx` passes `mouseOnly`.
 *
 * **Nothing on this page is tooltip-only.** A card that opens on hover is
 * unreachable to a screen reader that never fires one, and unreachable on a
 * phone if the trigger is also doing something else. So `Explain` below writes
 * the same sentence into the trigger's own accessible name, from the same
 * `Tip` object — one source, two surfaces, and a test can read it out of the
 * DOM without simulating a pointer.
 */
import { cloneElement, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import {
  FloatingArrow,
  FloatingDelayGroup,
  FloatingPortal,
  arrow,
  autoUpdate,
  flip,
  offset,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";

/**
 * Long enough that crossing a row on the way somewhere else does not fire half
 * a dozen cards; short enough that pausing on a control feels like an answer
 * rather than a wait. Closing is quick but not instant, so a wobble between two
 * adjacent buttons does not blink the panel out and back.
 */
const DELAY = { open: 240, close: 90 } as const;

/**
 * Groups tooltips so that once one is open its neighbours open *instantly*
 * while the pointer keeps moving between them — which is what makes the dock's
 * three modes read as one control to point along rather than three separate
 * waits. Wrap a set of triggers in one; `Tooltip` picks the delay up through
 * context.
 */
export const TooltipGroup = FloatingDelayGroup;

export function Tooltip({
  content,
  children,
  placement = "top",
  mouseOnly = false,
  className,
}: {
  /** The panel's contents. Rendered only while open. */
  content: ReactNode;
  /** The trigger. A single element that can take a ref and event handlers. */
  children: ReactElement<Record<string, unknown>>;
  /** Preferred side. Flipped automatically if it does not fit. */
  placement?: Placement;
  /**
   * **Ignore touch.** A tap on a device with no hover still synthesises
   * `mouseenter`, so by default a finger opens these cards — which is what an
   * explanation wants and what a control that *does something* does not. See
   * the header.
   */
  mouseOnly?: boolean;
  /** Extra class on the panel, for a per-use accent. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // Reposition on scroll and resize for as long as it is open: the dock is
    // `position: fixed`, so its buttons move relative to the page on every
    // scroll event.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      /* `crossAxis: false` — every trigger on this page is in a ROW of
         triggers (the dock's modes, the health stats, a card's status pill).
         With the default, a card that is merely too wide to centre counts as
         "does not fit" and is thrown onto the cross axis, landing on top of the
         neighbours the reader is about to point at. Measured in the product's
         diagram band, 2026-08-27, where it looked like *most* of it worked. */
      flip({ padding: 10, crossAxis: false }),
      shift({ padding: 10 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  // Zero when there is no <TooltipGroup> above us, in which case we want our
  // own delay. A group always supplies an object, which is truthy.
  const { delay: groupDelay, isInstantPhase } = useDelayGroup(context);

  const { getReferenceProps, getFloatingProps } = useInteractions([
    useHover(context, {
      delay: groupDelay || DELAY,
      move: false,
      mouseOnly,
      // Every card here is read, not clicked: the pointer never needs to travel
      // into one, and a panel that lingered while the pointer crossed it would
      // sit on top of the thing being pointed at.
      handleClose: null,
    }),
    // Keyboard parity: every trigger is a real button, so tabbing to one shows
    // what hovering it does.
    useFocus(context),
    // Escape, and an outside press — which is how a card opened by a finger is
    // put away again.
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);

  // Once the group is warm, neighbours appear with no fade at all: a fade reads
  // as lag when the panel is meant to be tracking the pointer along a row.
  const { isMounted, styles } = useTransitionStyles(context, {
    duration: isInstantPhase ? { open: 0, close: 80 } : { open: 120, close: 80 },
    initial: { opacity: 0, transform: "scale(0.97)" },
  });

  // React 19 passes `ref` through as an ordinary prop, so a trigger that wants
  // its own ref keeps it: both are called.
  const childRef = (children.props as { ref?: Ref<HTMLElement> }).ref;
  const ref = useMergeRefs<HTMLElement>([refs.setReference, childRef ?? null]);

  return (
    <>
      {/* `ref` last: it must win over any `ref` already in children.props,
          which the merged one already includes. */}
      {cloneElement(children, getReferenceProps({ ...children.props, ref }))}
      {isMounted && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} className="tooltip-anchor" {...getFloatingProps()}>
            <div className={`tooltip${className ? ` ${className}` : ""}`} style={styles}>
              {content}
              {/* fill and stroke are PROPS, not CSS — see the header. `var()`
                  resolves here because presentation attributes are parsed as
                  CSS values. */}
              <FloatingArrow
                ref={arrowRef}
                context={context}
                className="tooltip-arrow"
                width={12}
                height={6}
                tipRadius={1}
                fill="var(--panel-raised)"
                stroke="var(--rule-strong)"
                strokeWidth={1}
              />
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * **What a card says, as data rather than as markup.**
 *
 * The shape is the product's `ControlTip` (src/web/Tooltip.tsx), reduced to the
 * two paragraphs that carry its whole argument:
 *
 * > The first sentence is what a reader could have guessed by pressing the
 * > control; the second is what they could not — where the answer comes from,
 * > what it costs, or what the control does *not* promise.
 * >
 * > — docs/project/tooltips.md
 *
 * It is an object rather than JSX because it has to be rendered **twice**: as
 * the card, and as the flat sentence that goes into the trigger's accessible
 * name so the words exist on a phone and in a screen reader. Two spellings of
 * one sentence is two things to keep in step, and the one that goes stale is
 * always the one nobody looks at.
 */
export type Tip = {
  /** Two or three words. What the thing is called, not a summary of the card. */
  head: string;
  /** What it means. */
  what: string;
  /** What a reader could not have worked out by looking at it. */
  how: string;
};

/** The card, as the reader sees it. */
export function TipCard({ tip }: { tip: Tip }): ReactNode {
  return (
    <>
      <div className="tip-head">{tip.head}</div>
      <div className="tip-body">
        <p>{tip.what}</p>
        <p className="tip-how">{tip.how}</p>
      </div>
    </>
  );
}

/**
 * The same card, as one sentence — for the accessible name, and for a test that
 * wants to know the words are on the page without simulating a pointer.
 */
export function tipText(tip: Tip): string {
  return `${tip.head}: ${tip.what} ${tip.how}`;
}

/**
 * **A word on the page you can ask about.**
 *
 * Wraps its children in a trigger that opens `tip` on hover, on focus and on a
 * tap, and carries the same sentence in an `sr-only` span so that the card is
 * never the only copy. A `<button>` rather than a focusable `<span>`: it is
 * something a person presses, and every other spelling of that is a worse
 * announcement.
 *
 * The visible children stay outside the hidden span so that the accessible name
 * reads "needs you — Needs you: …" rather than losing the word it explains.
 */
export function Explain({
  tip,
  className,
  placement,
  children,
}: {
  tip: Tip;
  className?: string;
  placement?: Placement;
  children: ReactNode;
}): ReactNode {
  return (
    <Tooltip content={<TipCard tip={tip} />} placement={placement ?? "top"}>
      <button type="button" className={`explain${className ? ` ${className}` : ""}`}>
        {children}
        <span className="tw:sr-only"> — {tipText(tip)}</span>
      </button>
    </Tooltip>
  );
}
