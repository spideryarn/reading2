/**
 * The wordmark's hover animations: the list of them, and the hook that picks one.
 *
 * Greg, 2026-09-07:
 *
 * > Let's have fun with the Spideryarn logo when you hover over it. … Whenever
 * > the user hovers or long-clicks the Spideryarn logo it should pick a random
 * > animation.
 *
 * The previous version did this too, and its 4,700 lines — a registry, a
 * playground route, 1,911 lines of CSS — are why
 * docs/project/original-version/design-system.md § The logo playground calls it
 * "the clearest example of scope creep on a cosmetic feature in that repo". Its
 * advice was to pick *one* animation and hand-write it. Greg overruled that on
 * 2026-09-07 in favour of the random set, so the thing to hold onto instead is
 * **the apparatus stays small**: this file and one stylesheet, no route of its
 * own, no per-animation component. The whole registry is the array below.
 *
 * The design, and every animation's reasoning, is in
 * docs/project/design-logo.md.
 *
 * ## Two mount points, one hook
 *
 * The wordmark is drawn twice, with deliberately different inner markup —
 * `HomeLogo` in the top-left corner of the shelf-adjacent pages, `DockHome` at
 * the left-hand end of the reading view's bottom bar (Dock.tsx § The word, and
 * which mechanism takes it away). Both spread `useLogoAnimation()` onto their
 * `<a>`, so there is one implementation of *when* an animation runs and one
 * class name for the stylesheet to key on.
 *
 * That is also why the CSS selects on `.logo-letter` and `.logo-image` and
 * never on `.logo-text`: only the corner copy has that wrapper.
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One animation. `id` is the CSS class the stylesheet defines; `name` and
 * `blurb` exist for `/design`, which lists them, and for a reader of this file
 * who wants to know what `spya-dragline` looks like without hunting for
 * its keyframes.
 */
export type LogoAnimation = {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
};

/**
 * The thirteen, each defined in src/web/styles/logo-animations.css under the
 * `id` below. Order here is the order `/design` lists them in and has no other
 * meaning — the picker is uniform, and deliberately so for a first version.
 *
 * **They were chosen as a set rather than one at a time**, which is why some
 * individually better ideas are not here: a reader meets these one at a time in
 * random order, so what they form an impression of is the *range*, and two
 * spiders dropping on a thread is one too many however good both are. The
 * arbitration, the diversity table it is scored against and the ten near-misses
 * to reach for if one of these disappoints on screen are in
 * docs/plans/260907f-logo-animations-shortlist.md.
 *
 * **Six of the thirteen animate the mark alone**, and that ratio is not an
 * accident: the word is hidden below 731px in the corner and at the bar's
 * tightest rungs on the reading view, so on a phone a letters-only animation is
 * a hover that does nothing. docs/project/design-logo.md § What a phone sees.
 *
 * `tests/logo-animation.test.tsx` fails if an entry here has no rule in the
 * stylesheet, or a rule there no entry here. That is the one failure this
 * feature has that nobody would ever report.
 */
export const LOGO_ANIMATIONS: readonly LogoAnimation[] = [
  {
    id: "spya-settle",
    name: "The Settle",
    blurb: "The spider lifts and leans toward the library, overshoots, and settles like a thing with mass.",
  },
  {
    id: "spya-pluck",
    name: "Pluck the Thread",
    blurb: "The letters are a taut string; a bump runs along them and decays. Vibration is how a spider reads.",
  },
  {
    id: "spya-sag",
    name: "Stronger Than Steel",
    blurb: "The row takes a weight and hangs in a catenary, then springs back level without breaking.",
  },
  {
    id: "spya-register",
    name: "Misregistration",
    blurb: "Two ghost plates slide into perfect register under the word. Always toward, never away.",
  },
  {
    id: "spya-warm",
    name: "Warm Drift",
    blurb: "The orange drifts a few degrees warmer and a leg-shaped glow breathes. You would not notice it; you would notice it gone.",
  },
  {
    id: "spya-seam",
    name: "The Seam Opens",
    blurb: "The word parts where it really is a compound — Spider | yarn — and a thread stretches across the gap.",
  },
  {
    id: "spya-strain",
    name: "The Spider Strains",
    blurb: "It braces and hauls at the word, which does not budge. The text does not move, whatever the tool does to it.",
  },
  {
    id: "spya-i",
    name: "Only the i",
    blurb: "One letter rises a single pixel and stays there. Nothing else moves at all.",
  },
  {
    id: "spya-dawn",
    name: "Dawn Rebuild",
    blurb: "The wordmark is eaten right to left and respun left to right, the way an orb weaver rebuilds at dawn.",
  },
  {
    id: "spya-type",
    name: "Retype",
    blurb: "The word dims to a ghost, types itself back in, and leaves a block cursor blinking after the n.",
  },
  {
    id: "spya-abseil",
    name: "Abseil",
    blurb: "The final n lets go and drops on a thread of yarn, bobs, and is reeled back into the word.",
  },
  {
    id: "spya-dragline",
    name: "Dragline Drop",
    blurb: "The spider drops on a dragline, hangs and swings, and climbs back. It never lets go of where it came from.",
  },
  {
    id: "spya-radius",
    name: "Radius Sweep",
    blurb: "Light travels round the mark like a hand on a clock, lighting each leg in turn. Nothing moves.",
  },
];

/**
 * A random animation that is **not** the one just shown.
 *
 * The exclusion is the whole reason this is a function rather than one line at
 * the call site. With a dozen animations a uniform draw repeats the previous
 * one about one hover in twelve, and a repeat does not read as chance — it
 * reads as the feature being broken, because the reader's model is "a new one
 * each time". Excluding the last pick costs nothing and removes the only
 * outcome that looks like a bug.
 */
export function pickLogoAnimation(previous: string | null): LogoAnimation | null {
  const pool =
    LOGO_ANIMATIONS.length > 1
      ? LOGO_ANIMATIONS.filter((a) => a.id !== previous)
      : LOGO_ANIMATIONS;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** How long a press must be held before it counts as a long press, in ms. */
const LONG_PRESS_MS = 350;

/**
 * How long a touch-triggered animation stays up after the finger lifts, in ms.
 *
 * A mouse has an un-hover and that is what ends the animation; a finger has
 * nothing of the kind, so without this the animation would be cut off at the
 * exact moment the reader stopped covering it with their hand. Long enough to
 * watch a two-second loop twice, short enough that it is plainly over.
 */
const TOUCH_LINGER_MS = 4500;

/**
 * How long the click-suppression flag stands after the press ends, in ms.
 *
 * Long enough for the click that a long press normally produces to arrive and
 * read it; short enough that when no click comes — iOS cancels it after a long
 * press — the reader's next deliberate press is not the one that gets eaten.
 */
const CLICK_SUPPRESSION_MS = 400;

/**
 * The `<a>` props that make the wordmark animate.
 *
 * Spread onto the link, not onto a wrapper: both copies of the wordmark are
 * already anchors with their own positioning, and a wrapper around a
 * `position: fixed` element is a layout change dressed up as a refactor.
 */
export function useLogoAnimation() {
  const [active, setActive] = useState<string | null>(null);
  /* The last id *offered*, which is not the same as `active` — it must survive
     the clear on pointer-leave, or the exclusion in `pickLogoAnimation` would
     be reset by every un-hover and stop excluding anything. */
  const last = useRef<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Set when a long press fires, read and cleared by the click that follows it.
     A ref rather than state because the click handler must see the value from
     *this* gesture, and a state update scheduled during pointerdown is not
     guaranteed to have been applied by then. */
  const suppressClick = useRef(false);
  /* Clears `suppressClick` shortly after the finger or button comes up. See
     `onPointerUp` for why the flag cannot simply wait to be read. */
  const flagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Whether the press in progress came from a finger, read by `onContextMenu`.
     A ref for the same reason as the flag: the context menu arrives during the
     gesture, not after a re-render. */
  const pressedByTouch = useRef(false);

  const clearTimers = useCallback(() => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    if (lingerTimer.current !== null) clearTimeout(lingerTimer.current);
    if (flagTimer.current !== null) clearTimeout(flagTimer.current);
    pressTimer.current = null;
    lingerTimer.current = null;
    flagTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const roll = useCallback(() => {
    const next = pickLogoAnimation(last.current);
    if (!next) return;
    last.current = next.id;
    setActive(next.id);
  }, []);

  return {
    /**
     * Goes on the `<a>` alongside `logo` and its per-site class.
     *
     * **Two classes, not one.** The animation's own id carries its keyframes;
     * the bare `spya-anim` carries the handful of rules every animation needs
     * and none of them should have to remember — `display: inline-block` on the
     * letters so a `transform` applies at all, and the `position: relative` that
     * lets a pseudo-element be placed against the mark. Writing those into each
     * animation instead is how the twelfth one ships without them and nobody
     * can see why it does nothing.
     */
    className: active ? `spya-anim ${active}` : "",
    /** The id currently running, for a test or a caller that wants to assert on it. */
    animation: active,
    handlers: {
      onPointerEnter: (e: ReactPointerEvent) => {
        /* A touch that lands on a link fires `pointerenter` too, immediately
           before `pointerdown`. Taking it would mean every tap on the way home
           started an animation the reader never asked for and is about to
           navigate away from — and would consume the long press's re-roll
           before the long press happened. Hover means a pointer that can
           hover. */
        if (e.pointerType === "touch") return;
        if (lingerTimer.current !== null) {
          clearTimeout(lingerTimer.current);
          lingerTimer.current = null;
        }
        roll();
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === "touch") return;
        clearTimers();
        /* The gesture left the control, so no click is coming to read this.
           Leaving it set would swallow the reader's *next* press instead. */
        suppressClick.current = false;
        setActive(null);
      },
      onContextMenu: (e: ReactMouseEvent) => {
        /* **Android, and only during a touch long press.**
           `-webkit-touch-callout` in styles/dock.css handles iOS and does
           nothing in Chrome on Android, which fires `contextmenu` on a held
           link at around 500ms and raises *Open in new tab / Copy link* over
           the animation the reader has just asked for. `user-select: none`
           does not stop it either.

           Guarded on the ref rather than applied always, because a right-click
           on a link should still offer the menu: that is a reader asking for
           the link, not for the spider. Not verified on a device — there is no
           Android here — so it is written to fail open. */
        if (pressedByTouch.current) e.preventDefault();
      },
      onPointerDown: (e: ReactPointerEvent) => {
        /* Only the primary button. A right-click opens the context menu and a
           middle-click opens a tab; neither is a request to be entertained. */
        if (e.button !== 0) return;
        /* Read off the event now, not inside the timeout. React stopped pooling
           synthetic events in 17 so `e` would survive, but a handler that keeps
           a live event alive across a timer is the kind of thing that is true
           until someone changes the React version underneath it. */
        const pointerType = e.pointerType;
        clearTimers();
        suppressClick.current = false;
        pressedByTouch.current = pointerType === "touch";
        pressTimer.current = setTimeout(() => {
          pressTimer.current = null;
          /* The hold *is* the request, so it re-rolls even mid-hover: a mouse
             user who liked the look of one and wants another holds the button
             down. That is the only way to ask for a second draw without
             leaving the corner and coming back. */
          suppressClick.current = true;
          roll();
          if (pointerType === "touch") {
            lingerTimer.current = setTimeout(() => {
              lingerTimer.current = null;
              setActive(null);
            }, TOUCH_LINGER_MS);
          }
        }, LONG_PRESS_MS);
      },
      onPointerUp: () => {
        pressedByTouch.current = false;
        if (pressTimer.current !== null) {
          clearTimeout(pressTimer.current);
          pressTimer.current = null;
        }
        /* **The flag has to expire, not merely wait to be read.** A click does
           not always follow a long press — iOS cancels it, and so does a
           release that lands after the pointer has moved — and a flag left
           standing then eats the reader's *next* ordinary press on the way
           home, once, for no visible reason. A real click arrives within a few
           milliseconds of this and clears the flag itself; this is only the
           backstop for when none does. */
        if (suppressClick.current) {
          if (flagTimer.current !== null) clearTimeout(flagTimer.current);
          flagTimer.current = setTimeout(() => {
            flagTimer.current = null;
            suppressClick.current = false;
          }, CLICK_SUPPRESSION_MS);
        }
      },
      onPointerCancel: () => {
        clearTimers();
        suppressClick.current = false;
        pressedByTouch.current = false;
        setActive(null);
      },
      onClick: (e: ReactMouseEvent) => {
        /* A long press asked to *see* something, not to leave. Navigating home
           the instant the animation started would make the gesture worse than
           useless — the reader would lose the page they were on to watch a
           spider for a tenth of a second. `Link` checks `defaultPrevented`
           before it navigates, so this is enough to stop it. */
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
        }
      },
    },
  };
}
