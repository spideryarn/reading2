/**
 * Hover tooltips, over [Floating UI](https://floating-ui.com).
 *
 * Why a library at all, and why this one: docs/project/tooltips.md.
 *
 * The short version — the spine's bands are strictly *proportional*, so a short
 * section is a two-pixel sliver with no room for a word (Spine.tsx). The detail
 * has to go somewhere, and the somewhere is a tooltip. But a tooltip anchored to
 * a two-pixel band at the bottom of a fixed rail is precisely the case where the
 * hand-rolled version goes wrong: it needs collision handling (flip to the other
 * side, shift along the edge), hover intent so sweeping the rail doesn't strobe,
 * and dismissal on escape. Floating UI is the engine Radix, Mantine and Tippy
 * all sit on, it is headless — it positions and it handles interaction, and
 * ships no styles, so the dark palette stays ours (styles.css § tooltip).
 *
 * Two things about the DOM shape below are load-bearing:
 *
 *  - The floating node is TWO elements. `floatingStyles` positions with a
 *    `transform`, and so does the open/close transition; one element cannot
 *    carry both without the animation fighting the placement. Outer div
 *    positions, inner div animates. This is Floating UI's own recommendation.
 *  - The tooltip renders through `<FloatingPortal>`, into the end of `<body>`.
 *    The spine is `overflow: hidden` (it has to be — the bands are absolutely
 *    positioned in percentages and would otherwise spill), which would clip any
 *    tooltip rendered inside it to the width of the rail.
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
 * Long enough that crossing the rail on the way somewhere else doesn't fire a
 * dozen tooltips; short enough that pausing on a band feels like an answer
 * rather than a wait. Closing is quick but not instant, so a wobble of the
 * mouse between two adjacent bands doesn't blink the panel out and back.
 */
const DELAY = { open: 240, close: 90 } as const;

/**
 * Groups tooltips so that once one is open, its neighbours open *instantly*
 * while the pointer keeps moving between them — the reason a rail of sections
 * feels like a single scrubbable surface rather than fifty separate waits.
 * Wrap the set of triggers in one of these; `Tooltip` picks the group's delay
 * up through context.
 */
export const TooltipGroup = FloatingDelayGroup;

interface BaseProps {
  /** The panel's contents. Rendered only while open. */
  content: ReactNode;
  /** The trigger. A single element that can take a ref and event handlers. */
  children: ReactElement<Record<string, unknown>>;
  /** Preferred side. Flipped automatically if it doesn't fit. */
  placement?: Placement;
  /**
   * **Stay on the side you asked for, and slide along it rather than moving.**
   *
   * By default `flip` watches *both* axes, so a tooltip that is simply too wide
   * to centre on its trigger is treated as not fitting and is thrown onto the
   * cross axis — a `placement="bottom"` card next to the left edge of the
   * window comes out on the *right* of its trigger. That is usually the kindest
   * thing to do for one tooltip in open space, and it is wrong for a **row of
   * triggers**: the card lands on top of the neighbours the reader is about to
   * hover, which is the row they are trying to read along.
   *
   * Measured in the diagram band, 2026-08-27: the two leftmost chips' cards
   * went to the right and covered the two chips beside them, while the two
   * rightmost chips — which had room to centre — behaved. So it looked like
   * *most* of it worked, which is why it needed measuring rather than a glance.
   * The dock's mode switcher does not hit this because its cards are narrower
   * than the run of buttons they sit over.
   *
   * With this set, `flip` only ever swaps top↔bottom or left↔right, and `shift`
   * below slides the card along the edge to fit. Off by default, because for a
   * lone trigger the wider search really is better.
   */
  keepSide?: boolean;
  /** Extra class on the panel, for per-use sizing or accents. */
  className?: string;
}

/**
 * Take the open state over, instead of letting hover and focus own it.
 *
 * **For a card that has to survive a tap**, which is the one thing hover cannot
 * do: on a touch device there is nothing to hover with, so a card that only
 * opens on hover does not exist at all. The spine needs a band's card to open on
 * the first tap and stay up until the reader taps somewhere else (Spine.tsx),
 * and that is a decision about what a tap *means* — it cannot be made inside
 * this component, which does not know what its trigger does.
 *
 * **A union rather than two optional props**, so that supplying one without the
 * other is a compile error rather than a tooltip that opens and never closes.
 * An earlier version had a comment warning about exactly that and no way to
 * enforce it; GPT Sol pointed out the type system can (2026-08-27).
 *
 * Being controlled also turns off hover's *touch* handling — see `mouseOnly`
 * below, which is the difference between reveal-then-commit working and the
 * card being torn down before the tap that was meant to commit it.
 */
type OpenState =
  | { open?: undefined; onOpenChange?: undefined }
  | { open: boolean; onOpenChange(open: boolean): void };

type Props = BaseProps & OpenState;

export function Tooltip({
  content,
  children,
  placement = "right",
  keepSide = false,
  className,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const arrowRef = useRef<SVGSVGElement>(null);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // Reposition on scroll and resize for as long as the tooltip is open. The
    // spine's reference elements are inside a `position: fixed` rail, so they
    // move relative to the page on every scroll event.
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      /* `fallbackAxisSideDirection` lets a tooltip that fits on neither side
         drop to the top/bottom axis instead of jamming against the edge —
         unless the caller has asked to stay on one axis, in which case
         `crossAxis: false` stops a card that is merely too wide to centre from
         counting as "does not fit". See `keepSide` above. */
      keepSide
        ? flip({ padding: 10, crossAxis: false })
        : flip({ padding: 10, fallbackAxisSideDirection: "end" }),
      shift({ padding: 10 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  // Zero when there is no <TooltipGroup> above us, in which case we want our
  // own delay. A group always supplies an object, which is truthy.
  const { delay: groupDelay, isInstantPhase } = useDelayGroup(context);

  const controlled = controlledOpen !== undefined;

  const interactions = useInteractions([
    useHover(context, {
      delay: groupDelay || DELAY,
      move: false,
      /**
       * **`useHover` handles touch as well as mouse by default, and on a
       * controlled tooltip that silently breaks the thing being controlled.**
       *
       * A tap on a device with no hover still produces a synthesised
       * `mouseenter` … `mouseleave` … `click`, in that order — `mouseleave`
       * arrives *before* the click. So on the spine's second tap, hover closed
       * the card and cleared `armed`, and the click that followed saw an
       * unarmed band and re-revealed it: reveal-then-commit could never reach
       * commit, and the rail would have been untappable on exactly the device
       * it was built for. `bandPress`'s unit tests cannot see this, because the
       * bug is in the event sequence rather than in the decision.
       *
       * Found by GPT Sol, 2026-08-27, reading the code against the Pointer
       * Events spec — not by running it, which no harness here can do.
       *
       * Scoped to the controlled case so every other tooltip in the app keeps
       * whatever touch behaviour it had.
       */
      mouseOnly: controlled,
      // Every card here is read, not clicked: the pointer never needs to
      // travel into one, and a panel that lingered while the pointer crossed
      // it would sit on top of the thing being pointed at. (A `safePolygon()`
      // corridor lived here for the context pills, whose tooltips carried
      // links; the pills are gone — docs/project/column-context.md.)
      handleClose: null,
    }),
    // Keyboard parity: the spine's bands are real buttons, so tabbing through
    // them should show the same detail hovering does.
    useFocus(context),
    useDismiss(context),
    useRole(context, { role: "tooltip" }),
  ]);
  const { getReferenceProps, getFloatingProps } = interactions;

  // Once the group is warm, subsequent tooltips appear with no fade at all —
  // a fade would read as lag when the panel is meant to be tracking the
  // pointer down the rail.
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
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="tooltip-anchor"
            {...getFloatingProps()}
          >
            <div className={`tooltip${className ? ` ${className}` : ""}`} style={styles}>
              {content}
              {/* fill and stroke are PROPS, not CSS. FloatingArrow needs the
                  values itself: given a strokeWidth it draws a second, clipped
                  path for the border and paints the seam where the arrow meets
                  the panel using `fill`. Setting either in the stylesheet
                  instead wins the cascade over its `stroke="none"` and draws a
                  line straight across the arrow's mouth. `var()` resolves here
                  because presentation attributes are parsed as CSS values. */}
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
      )}
    </>
  );
}

/**
 * **The card a control carries**: what it is, then how it
 * works and what it costs.
 *
 * One shape rather than five, because the row of chips proved the shape and
 * everything under it then grew a `title` attribute instead. It lives here
 * rather than in `DiagramPanel` because `SketchView` wants it too, and
 * `DiagramPanel` renders `SketchView` — so the panel cannot be the one to
 * export it. Greg asked for the
 * chips' cards in 2026-08-27 — *"add tooltips when hovering over each Diagram
 * button to explain how it works"* — and came back on 2026-08-30 for the rest:
 * *"add detailed tooltips to the various diagram-buttons etc to explain how
 * things work."*
 *
 * **A `title` is not a small version of this**, and that is the whole argument
 * for the change. It waits about a second, cannot be styled, truncates at the
 * OS's idea of a line, and **does not exist at all on a touch device** — which
 * is the device the step bar below was specifically built for. For a sentence
 * whose job is to say what a control means, that is close to not being there.
 *
 * The second paragraph is always the one a reader cannot work out by pressing:
 * where the answer comes from, what it costs, or what the control does *not*
 * promise. The first they could have guessed; the second is why the card is
 * worth a hover.
 *
 * `state` is the exception to *what it is, then how it works*: where the control
 * is a switch that can be mid-flight or broken, what it is doing **right now**
 * goes above the description, because a reader who opened the card because the
 * button would not move should not have to read two paragraphs first. The bar's
 * experimental switch is the only caller (Dock.tsx § the switch itself), and it
 * is never the only carrier — the button draws a warning marker, and the same
 * sentence is in an `sr-only` span it points `aria-describedby` at.
 */
export function ControlTip({
  head,
  state,
  what,
  how,
}: {
  head: string;
  state?: string | undefined;
  what: string;
  how: string;
}) {
  return (
    <>
      <div className="tip-soon-head">{head}</div>
      {state && <p>{state}</p>}
      <p>{what}</p>
      <p className="tip-soon-how">{how}</p>
    </>
  );
}
