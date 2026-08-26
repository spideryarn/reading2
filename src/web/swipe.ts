/**
 * Touch: a swipe in a gist column steps one item, the prose scrolls normally.
 *
 * Greg, 2026-08-26:
 *
 * > We're going to want to read on an iPad a lot.
 * >
 * > Can we play with the way touch-scrolling works so that it jumps
 * > step-by-step if I scroll within a column, kinda like the up/down buttons?
 *
 * This is the finger's version of what the pointer already does
 * (keyboard.md): the column you touch says how big a step is, and the gesture
 * says which way. One swipe is exactly one item — the same `stepTarget`
 * arithmetic the arrow keys use, the same `scrollToBlock` jump, so the two
 * inputs cannot drift apart. The one exception is the ends of the article,
 * where there is no next item and a swipe moves a screenful instead: a gesture
 * that cannot hand itself back must not simply go dead.
 *
 * **The prose column is deliberately untouched**, and that is the whole design
 * rather than a caveat. NN/g's scrolljacking study found the worst usability
 * damage in exactly the case of altering how scrolling behaves *while asking
 * someone to read text*, and this feature must not be that. A finger on the
 * prose gets ordinary iPad scrolling: momentum, rubber-banding, stopping on a
 * line, reversing, flinging. The stepping lives beside it, in the columns whose
 * job is navigation, and you switch between them by moving your hand a couple
 * of centimetres. See docs/project/touch.md and
 * docs/research/ipad-touch-scrolling.md for how that was arrived at.
 *
 * **Why a gesture and not `scroll-snap`.** Snapping the document looked much
 * cheaper, and on iOS it very nearly comes free: an open WebKit bug means
 * turning snap on kills momentum, so a swipe already moves one snap point. We
 * are not building on it. It is an acknowledged defect, so the feature would
 * silently revert to flinging the day it is fixed; the spec subjects
 * *programmatic* scrolls to snapping too, which puts it straight in the path of
 * the per-frame `scrollTo` in scroll.ts; and moving the snap points — which is
 * what changing level means — jumped the page 184px with no gesture at all when
 * measured in Chrome, which the spec then confirmed is *required* behaviour
 * rather than a bug. The research doc has the full account, the sources, and an
 * honest note on what that one measurement does and does not establish.
 *
 * Related: keynav.ts (the same arithmetic, driven by keys), scroll.ts (the one
 * way anything scrolls to a block), ContextPanel.tsx and TableView.tsx (which
 * wear the attribute below).
 */
import { useEffect, useRef } from "react";
import type { Block } from "../types.js";
import { CHAIN_MS, measureRow, NAV_DEPTH_ATTR, type NavPlan, stepTarget } from "./keynav.js";
import { scrollByScreen, scrollToBlock } from "./scroll.js";

/**
 * The attribute a surface wears to say "a vertical swipe here steps, it does
 * not scroll".
 *
 * Separate from `data-nav-depth`, which every zone carries — the spine and the
 * prose are both aimable and neither may swallow a scroll. This one is the
 * opt-in, and it is deliberately an explicit mark on the two elements that mean
 * it rather than a rule inferred from depth, so that grepping for it finds
 * every surface whose native scrolling we have taken away.
 *
 * The depth is still read from `data-nav-depth`, so a surface has to carry both
 * — which is free, because both live on the same element.
 */
export const SWIPE_ATTR = "data-swipe-step";

/**
 * How far the finger must travel before we call it a swipe rather than a tap.
 *
 * Apple's own touch slop is around 10px; this is more, because the cost of the
 * two mistakes is not symmetric. Reading a stray wobble as a swipe throws the
 * reader a screen away from where they were looking, and they have to find
 * their place again. Missing a small deliberate swipe costs them a second try.
 */
const SWIPE_MIN = 24;

/**
 * How much more vertical than horizontal a swipe must be before it is ours.
 *
 * The table pans sideways when it outruns the window (layout.ts § overflowing),
 * and that pan is the browser's — `touch-action: pan-x` hands it over
 * explicitly. A diagonal drag is far more likely to be someone panning than
 * someone stepping, so anything near the diagonal is left alone rather than
 * split down the middle.
 */
const AXIS_RATIO = 1.2;

/* ----------------------------------------------------------------- pure -- */

/**
 * What a finished drag means: forward, back, or nothing.
 *
 * Null covers both a tap and a sideways pan, and both must stay null — a tap
 * on a gist is how you jump to it, and a sideways drag is how you reach a
 * column the window is too narrow for.
 *
 * The sign follows the platform: dragging *up* pulls the article up, which
 * moves you forward. That is what every scroll on the device already does, so
 * the step agrees with the momentum scroll the reader gets one column to the
 * right — the two must not disagree about which way is "on".
 */
export function swipeStep(
  dx: number,
  dy: number,
  threshold = SWIPE_MIN,
): -1 | 1 | null {
  if (Math.abs(dy) < threshold) return null;
  // Not `<`: a perfectly diagonal drag is ambiguous, so it goes to the browser.
  if (Math.abs(dy) <= Math.abs(dx) * AXIS_RATIO) return null;
  return dy < 0 ? 1 : -1;
}

/* ------------------------------------------------------------------ DOM -- */

interface Gesture {
  id: number;
  x: number;
  y: number;
  depth: number;
}

/**
 * How long after a consumed swipe a click is assumed to be that swipe's.
 *
 * The synthesised click is dispatched in the same task as the `touchend`, so
 * this only has to outlast one event loop turn. It was four times longer while
 * the deadline was the *only* test — generous on purpose, because the cost of
 * being slightly too long was bounded to a single click.
 *
 * Once position joined the test, that generosity stopped being free: it was
 * eating a real gesture. Swipe a panel entry up to bring the level along, then
 * tap the entry now under your finger — same place, well inside 400ms. And
 * there is no delayed click left to cover, because index.html sets
 * `width=device-width`, which is what removed iOS's old 350ms tap delay.
 */
const CLICK_GRACE_MS = 120;

/**
 * How far from the finger's release point a click still counts as that swipe's.
 *
 * **Why the deadline alone was not enough**, which is worth stating because it
 * is the same shape as the bug it replaced. If the swipe produces *no*
 * synthetic click — and whether it does is a WebKit judgement we cannot check
 * from here — the deadline stays armed and eats the reader's next real tap
 * instead. Bounded rather than forever, but the same fault.
 *
 * A synthesised click lands where the finger came up. A deliberate tap almost
 * never does. So both tests have to pass, and a tap somewhere else gets through
 * however soon it comes.
 */
const CLICK_SLOP_PX = 24;

interface Swallow {
  until: number;
  x: number;
  y: number;
}

function armClickSwallow(state: Swallow, x: number, y: number): void {
  state.until = performance.now() + CLICK_GRACE_MS;
  state.x = x;
  state.y = y;
}

function isOurs(state: Swallow, e: MouseEvent): boolean {
  if (performance.now() > state.until) return false;
  return Math.hypot(e.clientX - state.x, e.clientY - state.y) <= CLICK_SLOP_PX;
}

/**
 * Capture phase on `window`, so it lands before React's delegated handler —
 * React attaches to the root container, which is a descendant, so propagation
 * never reaches it.
 *
 * **Two event types, because the app acts on two.** Swallowing `click` alone
 * leaves `mouseup` through, and TableView listens on `mouseup` to open a
 * comment from a `mark.cmt` — so a swipe that drifted sideways over a marked
 * phrase would open a dialog the reader never asked for. `mouseup` is only
 * stopped, never `preventDefault`ed: cancelling it suppresses the click we are
 * about to want, and can interfere with text selection.
 */
function makeClickSwallower(state: Swallow, onLetThrough: () => void) {
  return (e: MouseEvent) => {
    if (!isOurs(state, e)) {
      // A click we did not cause is a jump we did not make, so anything we
      // believed about where the reader was heading is now wrong. See § chain.
      if (e.type === "click") onLetThrough();
      return;
    }
    e.stopPropagation();
    if (e.type !== "click") return;
    state.until = 0;
    e.preventDefault();
  };
}

/**
 * Wire up the swipe. Reports nothing: the aim is the column you touched, and it
 * is over the moment you lift.
 *
 * Unlike the keyboard's, this aim is not held. There is no pointer resting on a
 * column between gestures, so there is nothing to show and nothing to remember
 * — the next swipe asks the same question again from wherever the finger lands.
 */
export function useSwipeNav(
  /** The same plan the arrow keys use — memoise it. See navPlan. */
  plan: NavPlan,
  blocks: Block[],
  /**
   * Whether swiping steps at all.
   *
   * False in outline mode, and that is a real constraint rather than a
   * simplification: outline mode has no prose column, so every surface on
   * screen is a gist column, and taking their vertical scrolling away would
   * leave the page with nothing that scrolls continuously at all. Also false
   * while the drawer is open, for the same reason the arrow keys are.
   */
  enabled = true,
): void {
  const gesture = useRef<Gesture | null>(null);
  /** The row our own last jump was headed for. Same trick as keynav's. */
  const chain = useRef<number | null>(null);
  /** When the swallowed click expires, and where it must land. */
  const swallow = useRef<Swallow>({ until: 0, x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const eatClick = makeClickSwallower(swallow.current, () => {
      chain.current = null;
    });

    const onDown = (e: PointerEvent) => {
      gesture.current = null;
      // Whatever the last swipe armed, this is a new touch and the click that
      // follows it will be the reader's. The swipe's own synthetic click has no
      // `pointerdown` in front of it — it is dispatched from the touch that has
      // already ended — so disarming here can never eat our own.
      swallow.current.until = 0;
      // A second finger is a pinch, not a swipe, and zooming must survive.
      //
      // Pen as well as touch: iPadOS reports an Apple Pencil as `pen`, and a
      // Pencil drags a page exactly as a finger does. `touch-action` constrains
      // it too — so accepting only `touch` would leave every gist column dead
      // under the Pencil, native scrolling gone and nothing put back. A mouse
      // is still excluded, by this check and by the media query on the CSS.
      if ((e.pointerType !== "touch" && e.pointerType !== "pen") || !e.isPrimary) return;
      const zone = (e.target as Element | null)?.closest?.(`[${SWIPE_ATTR}]`);
      const depth = Number(zone?.getAttribute(NAV_DEPTH_ATTR));
      if (!zone || !Number.isInteger(depth) || !plan.starts[depth]) {
        // They have grabbed the prose, or something else entirely. Whatever we
        // thought the last jump was heading for is no longer where they are.
        chain.current = null;
        return;
      }
      gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, depth };
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || e.pointerId !== g.id) return;
      const dir = swipeStep(e.clientX - g.x, e.clientY - g.y);
      if (dir === null) return;

      // The touch-down column decides the stride for the whole gesture, even if
      // the finger wanders into the next column on the way. You aimed when you
      // put your finger down; moving it is the gesture, not a change of mind.
      const target = stepTarget(
        plan.starts[g.depth] ?? [],
        chain.current ?? measureRow(),
        dir,
      );
      const block = target === null ? undefined : blocks[target];
      // The ends of the article: nowhere left to step, so move a screenful
      // rather than doing nothing. A key can decline to handle itself and let
      // the browser scroll; a swipe cannot, because `touch-action` turned the
      // gesture down before this listener existed. Silence here would leave
      // every gist column inert for the last item of the piece — see
      // scrollByScreen, and note it is a screenful rather than a run to the
      // end, so the gesture stays bounded and reversible.
      if (!block) {
        chain.current = null;
        armClickSwallow(swallow.current, e.clientX, e.clientY);
        scrollByScreen(dir);
        return;
      }

      chain.current = target;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        chain.current = null;
      }, CHAIN_MS);
      armClickSwallow(swallow.current, e.clientX, e.clientY);
      // On release, never during the drag: glide() is rAF-driven, and iOS
      // defers rAF callbacks while a finger is down, so a jump started mid-drag
      // would stall until they let go and then lurch.
      scrollToBlock(block.id);
    };

    /**
     * The browser took the gesture — a sideways pan, a pinch, a palm, a lost
     * device. `glide()` has stopped wherever it happened to be, so the jump we
     * were part-way through never arrived: what we believed about where the
     * reader was heading is now wrong, and a swipe within CHAIN_MS would step
     * on from a destination they never reached.
     */
    const onCancel = () => {
      gesture.current = null;
      chain.current = null;
      window.clearTimeout(timer);
    };

    /**
     * The reader moved the page some way that was not a swipe, so where we
     * thought our last jump was heading is no longer where they are.
     *
     * A finger landing outside a swipe surface is handled in `onDown`, which
     * covers the prose. This covers the other way an iPad scrolls: a trackpad
     * or a Magic Mouse on a Magic Keyboard, which emits `wheel` and never a
     * touch pointer at all. Without it, a scroll and then a swipe inside the
     * same second would step from a row the reader had already left.
     */
    const drop = () => {
      chain.current = null;
    };

    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onCancel, { passive: true });
    window.addEventListener("wheel", drop, { passive: true });
    // Not passive: eating the click is the whole point, and a passive listener
    // may not call preventDefault.
    window.addEventListener("click", eatClick, { capture: true });
    window.addEventListener("mouseup", eatClick, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("wheel", drop);
      window.removeEventListener("click", eatClick, { capture: true });
      window.removeEventListener("mouseup", eatClick, { capture: true });
      window.clearTimeout(timer);
      // Clearing the timer without clearing what it was going to clear would
      // freeze the chain indefinitely rather than for CHAIN_MS — and this
      // effect is torn down by exactly the events most likely to move the
      // reader: a rotation, a split-view resize, leaving reading mode.
      chain.current = null;
      // The gesture goes too, and for a sharper reason: a finger still down
      // across a resize would be finished by the *new* handler against the new
      // plan. `plan.starts` deliberately keeps depths that are off screen, so
      // the step would land at a level whose column no longer exists.
      gesture.current = null;
    };
  }, [plan, blocks, enabled]);
}
