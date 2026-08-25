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
  safePolygon,
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

interface Props {
  /** The panel's contents. Rendered only while open. */
  content: ReactNode;
  /** The trigger. A single element that can take a ref and event handlers. */
  children: ReactElement<Record<string, unknown>>;
  /** Preferred side. Flipped automatically if it doesn't fit. */
  placement?: Placement;
  /** Extra class on the panel, for per-use sizing or accents. */
  className?: string;
  /**
   * Let the pointer travel into the panel without closing it — for a tooltip
   * that carries links. Off by default: the spine's cards are read, not
   * clicked, and a panel that lingers while the pointer crosses it would get
   * in the way of the band underneath.
   */
  interactive?: boolean;
}

export function Tooltip({
  content,
  children,
  placement = "right",
  className,
  interactive = false,
}: Props) {
  const [open, setOpen] = useState(false);
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
      // `fallbackAxisSideDirection` lets a tooltip that fits on neither side
      // drop to the top/bottom axis instead of jamming against the edge.
      flip({ padding: 10, fallbackAxisSideDirection: "end" }),
      shift({ padding: 10 }),
      arrow({ element: arrowRef, padding: 8 }),
    ],
  });

  // Zero when there is no <TooltipGroup> above us, in which case we want our
  // own delay. A group always supplies an object, which is truthy.
  const { delay: groupDelay, isInstantPhase } = useDelayGroup(context);

  const interactions = useInteractions([
    useHover(context, {
      delay: groupDelay || DELAY,
      move: false,
      // safePolygon keeps the panel open while the pointer crosses the gap
      // to it — the corridor Floating UI draws between trigger and panel.
      handleClose: interactive ? safePolygon() : null,
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
