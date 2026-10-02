/**
 * Hover tooltips, over [Floating UI](https://floating-ui.com).
 *
 * Why a library at all, and why this one: docs/project/tooltips.md.
 *
 * The one place a tip on a control comes from — `Tooltip`, `ControlTip` and
 * `TipNote` below. The prose's hover cards are the other implementation, and
 * tooltips.md#the-second-implementation-and-why-there-is-one says why.
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
import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from "react";
import {
  FloatingArrow,
  FloatingDelayGroup,
  FloatingFocusManager,
  FloatingPortal,
  FloatingTree,
  arrow,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDelayGroup,
  useDismiss,
  useFloating,
  useFloatingTree,
  useFocus,
  useHover,
  useInteractions,
  useMergeRefs,
  useRole,
  useTransitionStyles,
  type OpenChangeReason,
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
  /**
   * **`false` keeps the wrapper and opens nothing.** For a trigger that has a
   * card only some of the time: wrapping it conditionally changes the element
   * type at that slot, so React remounts the trigger and a keyboard user's
   * focus drops to `<body>` — a Skim row losing its card as it becomes
   * current (plan 260928e). Default `true`.
   */
  enabled?: boolean;
  /**
   * **The pointer and the keyboard can get into the card**, for a card that
   * holds something to press — a link on to Help, a button. Off by default, and
   * the default is the point: the spine's cards must *not* take hover, or one
   * that lands under the pointer sits on the band being pointed at and holds
   * itself open.
   *
   * On, it is three things together, and none of them is useful alone:
   *
   *  - `.tooltip-anchor.interactive`, so the card takes pointer events at all
   *    (tooltip.css; the prose card has used the same class since 2026-08-26).
   *  - a `safePolygon()` corridor as `useHover`'s `handleClose`, so the pointer
   *    can cross the gap from the trigger to the card — diagonally included —
   *    without the card closing under it. Leaving any other way closes it as
   *    before.
   *  - a non-modal `FloatingFocusManager`, because the card is portalled to the
   *    end of `<body>` and Tab from the trigger would otherwise skip it
   *    entirely. Opening never *moves* focus — a card opened by hovering must
   *    not take the keyboard's place — it only makes the card reachable, and
   *    the card closes when Tab carries focus out of it.
   *
   * And two rules about focus that the library does not make on its own,
   * both from GPT Sol's plan review (F1, F2) and both in `changeOpen` below:
   * the pointer leaving does not close a card **the keyboard is inside**,
   * and Escape from inside one puts focus back on the trigger rather than
   * dropping it on `<body>` with the link it was on.
   *
   * **It is a `dialog`, not a `tooltip`, and it needs a name** — ARIA's tooltip
   * may not hold anything focusable, and a non-modal dialog is what the W3C's
   * own tooltip pattern points a card with a link at. So the card is no longer
   * the trigger's `aria-describedby`; the trigger says it opens a dialog
   * (`aria-haspopup`, `aria-controls`) and `label` is what that dialog is
   * announced as. Hence an object rather than a boolean: an interactive card
   * without a name does not compile.
   *
   * WCAG 2.1 § 1.4.13 asks for exactly this of a card with something in it.
   * Greg chose it per use, 2026-10-02 (docs/project/tooltips.md § A card the
   * pointer can enter).
   */
  interactive?: { label: string } | undefined;
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
  enabled = true,
  interactive,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = enabled && (controlledOpen ?? uncontrolledOpen);
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  /* Disabling closes it, and tells a controlling parent so: a disabled
     trigger's hover never reports leaving, so an open state left standing
     would pop the card back up the moment it is enabled again. */
  const disabledWhileOpen = !enabled && (controlledOpen ?? uncontrolledOpen);
  useEffect(() => {
    if (disabledWhileOpen) setOpen(false);
  }, [disabledWhileOpen, setOpen]);
  const arrowRef = useRef<SVGSVGElement>(null);

  /**
   * **What an interactive card does about focus when something asks it to
   * close.** A no-op for every other card: `setOpen`, unchanged.
   *
   * - **Hover leaving does not close it while focus is inside.** `safePolygon`
   *   guards the pointer's trip and knows nothing about the keyboard, so
   *   without this a reader on the card's link who nudges the mouse off the
   *   trigger loses the link under the focus, and focus falls to `<body>`.
   * - **Escape from inside puts focus back on the trigger.** The focused link
   *   is about to unmount; `returnFocus` is off (FocusReach says why), so
   *   nothing else would. Only for Escape: an outside press is a click that
   *   is about to put focus where the reader clicked, and Tab out has already
   *   moved it on.
   */
  const changeOpen = (next: boolean, _event?: Event, reason?: OpenChangeReason) => {
    if (interactive && !next) {
      // Read the committed DOM refs, including a trigger replaced in this
      // commit before Floating UI's element state has rerendered.
      const reference = refs.domReference.current;
      const floating = refs.floating.current;
      const active = floating?.ownerDocument.activeElement ?? null;
      if (floating && active && floating.contains(active)) {
        if (reason === "hover" || reason === "safe-polygon") return;
        if (reason === "escape-key" && reference instanceof HTMLElement) reference.focus({ preventScroll: true });
      }
    }
    setOpen(next);
  };

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: changeOpen,
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
      enabled,
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
      // Most cards are read, not clicked: the pointer never needs to travel
      // into one, and a panel that lingered while the pointer crossed it would
      // sit on top of the thing being pointed at. A card with something to
      // press asks for the corridor — `interactive` above.
      handleClose: interactive ? safePolygon() : null,
    }),
    // Keyboard parity: the spine's bands are real buttons, so tabbing through
    // them should show the same detail hovering does.
    useFocus(context, { enabled }),
    useDismiss(context, { enabled }),
    useRole(context, { role: interactive ? "dialog" : "tooltip" }),
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

  /**
   * **A trigger that already describes itself keeps that description, and gains
   * the card's rather than losing it.**
   *
   * `mergeProps` in `@floating-ui/react` applies the *user's* props last for
   * every key that is not an `on…` handler (`.concat(userProps)` into the
   * reduce), so anything in `children.props` **overwrites** what `useRole`
   * generated. That is right for `className` and wrong for this one attribute,
   * which is a list and not a value — and it is wrong in a way nothing reports:
   * the card still opens, still animates, and is simply no longer the trigger's
   * accessible description.
   *
   * Worse, React puts the key in `props` even when the JSX wrote `undefined`,
   * so a trigger that describes itself only *sometimes* — `DockTab`'s `note`,
   * which is a comment write that failed — suppressed the card's id in **every**
   * state, including the ordinary one where it has no note at all. That is the
   * regression GPT Sol caught in the built code, 2026-09-08.
   *
   * So the child's own value is taken out before the merge and put back after,
   * joined with whatever `useRole` produced. Both survive, in that order —
   * card first, because it is the description the reader asked for by hovering,
   * and the standing note second. `undefined` when there is neither, rather than
   * an empty string, which is a dangling reference in some screen readers.
   *
   * This also repairs § the switch itself, which has set its own
   * `aria-describedby` beside a card since the day the cards landed and has been
   * losing the card's ever since.
   */
  const { "aria-describedby": ownDescribedBy, ...childProps } = children.props as {
    "aria-describedby"?: string | undefined;
  };
  const merged = getReferenceProps({ ...childProps, ref });
  const describedBy =
    [merged["aria-describedby"], ownDescribedBy].filter(Boolean).join(" ") || undefined;

  return (
    <>
      {/* `ref` last: it must win over any `ref` already in children.props,
          which the merged one already includes. */}
      {cloneElement(children, { ...merged, "aria-describedby": describedBy })}
      {isMounted && (
        <FloatingPortal>
          <FocusReach on={interactive !== undefined} context={context}>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className={interactive ? "tooltip-anchor interactive" : "tooltip-anchor"}
            /* The name goes through `getFloatingProps` beside the role `useRole`
               put there, so the two arrive together — and `undefined` for a
               plain tooltip, which takes its name from nothing. */
            {...getFloatingProps({ "aria-label": interactive?.label })}
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
          </FocusReach>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * **Tab reaches an interactive card's contents; nothing else changes.**
 *
 * `modal={false}` puts focus guards beside the trigger and the card, so Tab
 * from the trigger lands on the card's first control and Tab past its last
 * goes on to whatever followed the trigger. `initialFocus={-1}` and
 * `returnFocus={false}` because the card opens on *hover* too, and a pointer
 * resting on an (i) must not move the keyboard's place — opening or closing it
 * leaves focus exactly where it was. `closeOnFocusOut` (the default) is what
 * closes it once focus has left both.
 */
function FocusReach({
  on,
  context,
  children,
}: {
  on: boolean;
  context: Parameters<typeof FloatingFocusManager>[0]["context"];
  children: ReactElement;
}) {
  const tree = useFloatingTree();
  if (!on) return children;
  const manager = (
    <FloatingFocusManager context={context} modal={false} initialFocus={-1} returnFocus={false}>
      {children}
    </FloatingFocusManager>
  );
  // In 0.27.20, the portal-without-tree capture workaround marks every blur
  // as insideReactTree and suppresses direct focus-out dismissal. Supply the
  // library's context (no DOM), retaining an enclosing tree when one exists.
  return tree ? manager : <FloatingTree>{manager}</FloatingTree>;
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
 * button would not move should not have to read two paragraphs first.
 *
 * Four callers, and the second generalised it. The fourth is the live
 * conversation's **microphone setup** card (LiveButton.tsx), which reports the
 * placement actually resolved while the selector beside it may still read
 * `Auto` — not the mid-flight sense, and it was already here when this said
 * three. The bar's **experimental
 * switch** (Dock.tsx § the switch itself), where it is never the only carrier —
 * the button draws a warning marker, and the same sentence is in an `sr-only`
 * span it points `aria-describedby` at. From 2026-09-07, the bar's **mode
 * buttons**, where it holds the sentence a *visitor* gets about a mode they
 * cannot have (`markedModes`, visitor.ts). And, later the same day, the bar's
 * **Comments button**, where it says the marks are the owner's and a visitor
 * may read them but add none (`NOT_A_MODE`, Dock.tsx).
 *
 * Neither of the last two is mid-flight and neither is broken, which is the
 * widening. What all three share is that a reader opening this card wants to
 * know why the control looks the way it does before they want to know what it
 * is for.
 *
 * **Two ways to get `state` wrong**, both found writing the wordmark's card on
 * 2026-09-08 and both fixed by not using it there at all.
 *
 * It is not the slot for *this reader gets somewhere else*. The wordmark looks
 * identical to the owner and to a stranger; what differs is where it leads, and
 * where a control leads is the description. So `DockHome` varies `what` instead.
 *
 * **The tempting generalisation is false, and it was written here first.** *Every
 * caller uses it for a control that looks different* covers the first three and
 * not the microphone, whose selector can read `Auto` while `state` reports the
 * headset or laptop placement actually resolved — neither mid-flight nor visible
 * on the control. What the four share is thinner and truer: `state` is what is
 * true **of this control right now**, as against `what`, which is true of it
 * always. Where the control looks off, that is usually why; it is not the test.
 * GPT Sol, 2026-09-08.
 *
 * And a `state` must not contradict the `what` beneath it, because it is read
 * first and the reader goes on to read the other one anyway. That draft put
 * *"…rather than to a library of your own"* over *"Back to your library"*: a
 * denial, and then the thing denied. Where `state` is right, keep the
 * possessive out of the `what` under it — which is what Comments does, and why
 * its pair reads.
 */
export function ControlTip({
  head,
  state,
  what,
  drawn,
  how,
  press,
  tap,
}: {
  head: string;
  state?: string | undefined;
  what: string;
  /**
   * What this control produced **for the article in front of the reader** —
   * the Sketch chip's caption, and so far only that (`DiagramPanel.tsx`). It
   * sits between the two fixed paragraphs because that is where it belongs in
   * the reading: what the picture is, then what it turned out to be here, then
   * what it costs. Set apart in the styling, because unlike everything else in
   * this card it is not the same words for every reader.
   */
  drawn?: string | undefined;
  how: string;
  /**
   * **What pressing this control does, or where it goes** — the one line in the
   * card that is an action rather than a statement, so it is set apart: last
   * before `tap`, a rule above it, an arrow before it.
   *
   * Greg, 2026-10-02 (spya-d886ah), about the sharing mark's *"Only you can read
   * this. Share it with anyone."*: *"One sentence is a statement of the current
   * state. The other is a potential action … [and there's no] UI
   * differentiation between these two kinds of sentence."* So `head`, `what`
   * and `how` stay statements, and an action that is worth saying goes here.
   *
   * Only where pressing does something a reader would not assume from the
   * glyph — a link that leaves the page, a button whose press is the change.
   * docs/research/261002b-tooltip-text-state-versus-action.md.
   */
  press?: string | undefined;
  /**
   * **"Tap again to do it"**, and only ever that shape.
   *
   * A card opened by a *finger* is the one case where the reader has pressed
   * the control and it has not done anything — reveal, then commit
   * (docs/project/touch.md). Nothing else on the card says so, and a control
   * that appears to have been pressed and ignored reads as broken.
   *
   * The caller decides when to pass it, and both halves of that decision are
   * the spine's, made for the same reasons (Spine.tsx § `showTapHint`): only
   * when a finger opened the card — saying "tap again" to somebody holding a
   * mouse is noise — and only where a second tap would actually do something.
   *
   * Last in the card, because it is the only line that is about the *gesture*
   * rather than the control.
   */
  tap?: string | undefined;
}) {
  return (
    <>
      <div className="tip-soon-head">{head}</div>
      {state && <p>{state}</p>}
      <p className="tip-soon-what">{what}</p>
      {drawn && <p className="tip-soon-drawn">{drawn}</p>}
      <p className="tip-soon-how">{how}</p>
      {press && <p className="tip-soon-press">{press}</p>}
      {tap && <p className="tip-soon-tap">{tap}</p>}
    </>
  );
}

/**
 * **The text inside a plain tooltip** — a sentence or two, and nothing else.
 *
 * Lived in `Metadata.tsx` as `Note` until 2026-09-04, when `AccessSharing.tsx`
 * on the same page needed one too. Here rather than copied, because the whole
 * body of it is a font-size that exists for the reason below, and two spellings
 * of that would be two things to keep in step.
 *
 * `.tooltip` styles the panel and deliberately sets no font-size, so a bare
 * string inherits `body`'s 1rem — noticeably bigger than every other tooltip in
 * the app, all of which are on classed content (`.tip-crumb`, `.tip-search`,
 * `.tip-soon`). Sized here rather than by adding a rule to styles.css, which
 * would be a fifth spelling of the same thing.
 *
 * `ink-soft`, which is what the eye wants and what the other tooltips use.
 * **This said `foreground/85` until 2026-09-05, and that was a bug rather than a
 * preference**: `--ink-soft` was declared in styles.css but missing from the
 * `@theme inline` bridge, so `tw:text-ink-soft` compiled to nothing at all and
 * the text simply inherited — no error, no missing class, just the wrong
 * colour. The workaround is not needed now the bridge has the name
 * (docs/plans/260905f-…). Note the two are not equivalent: `--ink-soft` is an
 * opaque grey, `foreground/85` composites over whatever is behind it.
 */
export function TipNote({ children }: { children: ReactNode }) {
  return <span className="tw:block tw:text-xs tw:leading-relaxed tw:text-ink-soft">{children}</span>;
}
