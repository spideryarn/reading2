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
 * ## Three hosts, one hook
 *
 * The wordmark is drawn twice, with deliberately different inner markup —
 * `HomeLogo` in the top-left corner of the shelf-adjacent pages, `DockHome` at
 * the left-hand end of the reading view's bottom bar (Dock.tsx § The word, and
 * which mechanism takes it away). Both spread `useLogoAnimation()` onto their
 * `<a>`, so there is one implementation of *when* an animation runs and one
 * class name for the stylesheet to key on. `ShelfSpider` uses the same hook on
 * the shelf's decorative mark-only `<span>`.
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
  /**
   * What it moves. `letters` animates the ten letters and nothing else, so it
   * is a draw nobody sees wherever the word is not drawn — and on the reading
   * view that is most windows, not only phones (docs/project/design-logo.md §
   * What a phone sees). `mark` reaches the spider or the whole anchor, so it is
   * seen wherever the wordmark is. tests/logo-animation.test.tsx checks each
   * tag against the stylesheet's own selectors.
   */
  readonly reach: "letters" | "mark";
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
    reach: "mark",
    name: "The Settle",
    blurb: "The spider lifts and leans toward the library, overshoots, and settles like a thing with mass.",
  },
  {
    id: "spya-pluck",
    reach: "letters",
    name: "Pluck the Thread",
    blurb: "The letters are a taut string; a bump runs along them and decays. Vibration is how a spider reads.",
  },
  {
    id: "spya-sag",
    reach: "letters",
    name: "Stronger Than Steel",
    blurb: "The row takes a weight and hangs in a catenary, then springs back level without breaking.",
  },
  {
    id: "spya-register",
    reach: "letters",
    name: "Misregistration",
    blurb: "Two ghost plates slide into perfect register under the word. Always toward, never away.",
  },
  {
    id: "spya-warm",
    reach: "mark",
    name: "Warm Drift",
    blurb: "The orange drifts a few degrees warmer and a leg-shaped glow breathes. You would not notice it; you would notice it gone.",
  },
  {
    id: "spya-seam",
    reach: "letters",
    name: "The Seam Opens",
    blurb: "The word parts where it really is a compound — Spider | yarn — and a thread stretches across the gap.",
  },
  {
    id: "spya-strain",
    reach: "mark",
    name: "The Spider Strains",
    blurb: "It braces and hauls at the word, which does not budge. The text does not move, whatever the tool does to it.",
  },
  {
    id: "spya-i",
    reach: "letters",
    name: "Only the i",
    blurb: "One letter rises a single pixel and stays there. Nothing else moves at all.",
  },
  {
    id: "spya-dawn",
    reach: "mark",
    name: "Dawn Rebuild",
    blurb: "The wordmark is eaten right to left and respun left to right, the way an orb weaver rebuilds at dawn.",
  },
  {
    id: "spya-type",
    reach: "letters",
    name: "Retype",
    blurb: "The word dims to a ghost, types itself back in, and leaves a block cursor blinking after the n.",
  },
  {
    id: "spya-abseil",
    reach: "letters",
    name: "Abseil",
    blurb: "The final n lets go and drops on a thread of yarn, bobs, and is reeled back into the word.",
  },
  {
    id: "spya-dragline",
    reach: "mark",
    name: "Dragline Drop",
    blurb: "The spider drops on a dragline, hangs and swings, and climbs back. It never lets go of where it came from.",
  },
  {
    id: "spya-radius",
    reach: "mark",
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
export function pickLogoAnimation(
  previous: string | null,
  wordShown = true,
): LogoAnimation | null {
  /* **Only what can be seen.** With the word gone, a `letters` animation puts
     its class on the anchor and moves ten boxes that are `display: none` — the
     hover happened and nothing did. On 2026-09-15 that was seven draws in
     thirteen on the reading view at every window up to 1920px, and Greg
     reported the feature as missing (docs/postmortems/260915c-…). */
  const eligible = wordShown ? LOGO_ANIMATIONS : LOGO_ANIMATIONS.filter((a) => a.reach === "mark");
  const pool = eligible.length > 1 ? eligible.filter((a) => a.id !== previous) : eligible;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * Whether the host's letters are laid out at all — asked of the element, at
 * the moment of the draw.
 *
 * Three different things take the word away: the 731px query on `.logo-text`,
 * the dock's fit ladder on `.dock-btn-label`, and a host with no letters (the
 * shelf's spider). All three leave a letter with no layout box, so this is the
 * one question they all answer, and nothing here has to know which applies.
 *
 * **It is not general visibility.** `visibility: hidden`, `opacity: 0` and an
 * ancestor's clip all leave a box and read as drawn. None of the hosts hides
 * its word that way, and the dock only shows the word at a rung where the row
 * fits (dock-fit.ts), so the letters are then really on screen.
 */
export function lettersDrawn(host: Element): boolean {
  const letter = host.querySelector(".logo-letter");
  return letter !== null && letter.getClientRects().length > 0;
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
 * How long a flag waiting for the click after a press stands, in ms.
 *
 * Long enough for the click a completed touch normally produces to arrive and
 * read the flag; short enough that when no click comes — iOS may cancel it
 * after a long press — a later click cannot inherit the old gesture.
 */
const CLICK_FOLLOWUP_MS = 400;

/**
 * The props that make a logo host animate.
 *
 * The two wordmarks spread these onto their links, not onto wrappers: both are
 * already anchors with their own positioning, and a wrapper around a
 * `position: fixed` element is a layout change dressed up as a refactor. The
 * shelf's decorative spider spreads them onto its mark-only span.
 *
 * ## The gesture is owned, and it ends where it ends
 *
 * Two properties are load-bearing here, and the first version of this hook had
 * neither. Both were found by walking the state machine adversarially rather
 * than by using it (GPT Astra, 2026-09-07).
 *
 * **One pointer owns the gesture at a time.** Without an owner, a second finger
 * landing on the wordmark restarted the timers and wiped the first finger's
 * click suppression, so a two-finger fumble on a phone could send the reader
 * home from a long press that was meant to show them a spider. Every event
 * below that could end or alter a gesture is now ignored unless it carries the
 * owning `pointerId`.
 *
 * **A press ends on `window`, not on the link.** A press that starts on the
 * wordmark and finishes anywhere else fires no `pointerup` on the element at
 * all — so the first version cleared its suppression flag on `pointerleave`
 * instead, which was both too eager and not enough: leaving and coming back
 * while still holding lost the suppression and the release then navigated,
 * while a release that happened off the control after a *quick* leave was never
 * seen. Listening on `window` for the owning pointer's `pointerup` and
 * `pointercancel` makes "the gesture ended" a fact rather than an inference,
 * and it is also when the touch linger is allowed to start — which the first
 * version began at the long-press threshold, so a five-second hold expired
 * under the reader's own finger.
 */
export function useLogoAnimation(
  options: {
    /**
     * **A tap plays one**, for a host that is not a link. On the reading view
     * a tap on the wordmark goes home, so a finger gets an animation only from
     * a hold; the shelf's spider is a picture, a tap there does nothing else,
     * so the tap itself may be the request (Library.tsx § ShelfSpider).
     *
     * Decided on the `click`, never on a short `pointerup`: the release is
     * heard on `window` wherever it happens, and a finger that slid off and
     * lifted elsewhere is not a tap on this. The browser sends the click only
     * when it has decided the touch was one. GPT Sol, 2026-09-15.
     */
    tap?: boolean;
  } = {},
) {
  const tap = options.tap ?? false;
  const [active, setActive] = useState<string | null>(null);
  /* The last id *offered*, which is not the same as `active` — it must survive
     the clear on pointer-leave, or the exclusion in `pickLogoAnimation` would
     be reset by every un-hover and stop excluding anything. */
  const last = useRef<string | null>(null);
  /**
   * The press in progress: which pointer owns it, whether it is a finger, and
   * whether it has passed the long-press threshold.
   *
   * `null` between gestures. A ref rather than state throughout this hook,
   * because every one of these is read inside an event handler or a timer
   * during the gesture — a re-render is not guaranteed to have happened by
   * then, and a stale read here is a swallowed click.
   */
  const press = useRef<{ id: number; touch: boolean; held: boolean } | null>(null);
  /** Set by a completed long press, read and cleared by the click that follows. */
  const suppressClick = useRef(false);
  /**
   * Whether the next click follows a completed short touch. Read only by the
   * `tap` option, so a mouse click on a hovered spider — which has already
   * drawn once, on the hover — does not draw a second time. Armed on release,
   * not down, and expired if the browser decides not to send that click.
   */
  const touchPress = useRef(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Removes the two `window` listeners the press in progress installed. */
  const detach = useRef<(() => void) | null>(null);

  const clearTimers = useCallback(() => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    if (lingerTimer.current !== null) clearTimeout(lingerTimer.current);
    if (flagTimer.current !== null) clearTimeout(flagTimer.current);
    pressTimer.current = null;
    lingerTimer.current = null;
    flagTimer.current = null;
  }, []);

  /** Everything a gesture leaves behind, undone. Safe to call at any point. */
  const endGesture = useCallback(() => {
    detach.current?.();
    detach.current = null;
    press.current = null;
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      clearTimers();
      detach.current?.();
      detach.current = null;
    },
    [clearTimers],
  );

  /**
   * Whether a hovering pointer is over the wordmark now. Only a mouse or pen
   * sets it — a touch has no hover — and it is what stops the long-press
   * threshold rolling for a mouse that has already left (§ onPointerDown).
   */
  const inside = useRef(false);

  /** A draw for this host, from the animations its current layout can show. */
  const roll = useCallback((host: Element) => {
    const next = pickLogoAnimation(last.current, lettersDrawn(host));
    if (!next) return;
    last.current = next.id;
    setActive(next.id);
  }, []);

  /**
   * A flag waiting for the click stands briefly after the gesture ends, then goes.
   *
   * A click does not always follow a long press — iOS cancels it, and so does a
   * release the browser decides was a drag — and a flag left standing then eats
   * the reader's *next* ordinary press on the way home, once, for no visible
   * reason. A real click arrives within a few milliseconds of the release and
   * clears the flag itself; this is only the backstop for when none does.
   */
  const expireClickFlags = useCallback(() => {
    if (!suppressClick.current && !touchPress.current) return;
    if (flagTimer.current !== null) clearTimeout(flagTimer.current);
    flagTimer.current = setTimeout(() => {
      flagTimer.current = null;
      suppressClick.current = false;
      touchPress.current = false;
    }, CLICK_FOLLOWUP_MS);
  }, []);

  return {
    /**
     * Goes on the host alongside `logo`/`shelf-spider` and its per-site class.
     *
     * **Two classes, not one.** The animation's own id carries its keyframes;
     * the bare `spya-anim` carries the handful of rules every animation needs
     * and none of them should have to remember — `display: inline-block` on the
     * letters so a `transform` applies at all, the `position: relative` that
     * lets a pseudo-element be placed against a letter, and the same on
     * `.logo-mark` so one can be placed against the spider. Writing those into
     * each animation instead is how the fourteenth one ships without them and
     * nobody can see why it does nothing.
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
           before the long press happened. A contact-only pen also enters as
           part of its down; unlike hover, that enter has a button held. A
           press already owned by this hook may re-enter held and still rolls. */
        if (e.pointerType === "touch") return;
        inside.current = true;
        if (e.buttons !== 0 && press.current === null) return;
        if (lingerTimer.current !== null) {
          clearTimeout(lingerTimer.current);
          lingerTimer.current = null;
        }
        roll(e.currentTarget);
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType === "touch") return;
        /* **The animation stops; the gesture does not.** Leaving ends the
           hover, so the animation goes — but a button still held down is still
           a gesture, and it may come back. Touching `suppressClick` here is
           what made a small excursion across the edge and back navigate on
           release. The gesture ends on `window`, where it actually ends. */
        inside.current = false;
        setActive(null);
        if (press.current === null) {
          clearTimers();
          suppressClick.current = false;
          touchPress.current = false;
        }
      },
      onContextMenu: (e: ReactMouseEvent) => {
        /* **Android, and only during a touch long press.**
           `-webkit-touch-callout` in styles/dock.css handles iOS and does
           nothing in Chrome on Android, which fires `contextmenu` on a held
           link at around 500ms and raises *Open in new tab / Copy link* over
           the animation the reader has just asked for. `user-select: none`
           does not stop it either.

           Guarded on the press in progress rather than applied always, because
           a right-click on a link should still offer the menu: that is a reader
           asking for the link, not for the spider. Not verified on a device —
           there is no Android here. */
        if (press.current?.touch) e.preventDefault();
      },
      onPointerDown: (e: ReactPointerEvent) => {
        /* Only the primary button. A right-click opens the context menu and a
           middle-click opens a tab; neither is a request to be entertained. */
        if (e.button !== 0) return;
        /* **A second pointer is not a second gesture.** It used to restart the
           timers and clear the first pointer's suppression, so one finger
           brushing the wordmark while another held it sent the reader home. */
        if (press.current !== null) return;

        /* A new press takes over from a lingering animation rather than leaving
           it orphaned: cancelling the linger timer without this is how an
           animation could stay up indefinitely after a second tap. */
        if (lingerTimer.current !== null) {
          clearTimeout(lingerTimer.current);
          lingerTimer.current = null;
          setActive(null);
        }
        if (flagTimer.current !== null) {
          clearTimeout(flagTimer.current);
          flagTimer.current = null;
        }
        suppressClick.current = false;
        touchPress.current = false;

        /* Read off the event now, not inside the timeout. React stopped pooling
           synthetic events in 17 so `e` would survive, but a handler that keeps
           a live event alive across a timer is the kind of thing that is true
           until someone changes the React version underneath it. */
        const id = e.pointerId;
        const touch = e.pointerType === "touch";
        const host = e.currentTarget;
        press.current = { id, touch, held: false };
        /* `pointerdown` on the host is proof that this pointer is inside even
           when no preceding enter reached us (for example, if the host appeared
           under a stationary pointer). A later leave still revokes it. */
        if (!touch) inside.current = true;

        const finish = (ev: PointerEvent) => {
          if (ev.pointerId !== id) return;
          const held = press.current?.held ?? false;
          endGesture();
          if (held) {
            expireClickFlags();
            /* **The linger starts here, on release, and not at the threshold.**
               Started at the threshold it ran out under the reader's own
               finger: a five-second hold finished the animation before they
               had lifted, and lifting gave them nothing. */
            if (touch) {
              lingerTimer.current = setTimeout(() => {
                lingerTimer.current = null;
                setActive(null);
              }, TOUCH_LINGER_MS);
            }
          } else if (touch) {
            touchPress.current = true;
            expireClickFlags();
          }
        };
        const cancel = (ev: PointerEvent) => {
          if (ev.pointerId !== id) return;
          endGesture();
          clearTimers();
          suppressClick.current = false;
          touchPress.current = false;
          setActive(null);
        };
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", cancel);
        detach.current = () => {
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", cancel);
        };

        pressTimer.current = setTimeout(() => {
          pressTimer.current = null;
          if (press.current?.id !== id) return;
          press.current.held = true;
          /* The hold *is* the request, so it re-rolls even mid-hover: a mouse
             user who liked the look of one and wants another holds the button
             down. That is the only way to ask for a second draw without
             leaving the corner and coming back. */
          suppressClick.current = true;
          /* **Not for a mouse that has already left.** The press outlives the
             leave on purpose — coming back and releasing must still not
             navigate, which is why the flag above is set regardless — but a
             draw made with the pointer elsewhere is one nobody asked for, and
             a mouse release has no linger to clear it, so it stood until the
             next hover. Coming back rolls anyway, through `onPointerEnter`.
             GPT Sol, 2026-09-15. */
          if (touch || inside.current) roll(host);
        }, LONG_PRESS_MS);
      },
      onClick: (e: ReactMouseEvent) => {
        /* A long press asked to *see* something, not to leave. Navigating home
           the instant the animation started would make the gesture worse than
           useless — the reader would lose the page they were on to watch a
           spider for a tenth of a second. `Link` calls this before it checks
           `defaultPrevented`, so this is enough to stop it. */
        const wasTouchPress = touchPress.current;
        touchPress.current = false;
        if (flagTimer.current !== null) {
          clearTimeout(flagTimer.current);
          flagTimer.current = null;
        }
        if (suppressClick.current) {
          suppressClick.current = false;
          e.preventDefault();
          /* The hold already drew; its click is not a second request. */
          return;
        }
        if (!tap || !wasTouchPress) return;
        /* A tap during a linger replaces it: `onPointerDown` has already
           cleared the old one, so this draw is new (the picker excludes the
           last) and its linger runs from now. */
        if (lingerTimer.current !== null) clearTimeout(lingerTimer.current);
        roll(e.currentTarget);
        lingerTimer.current = setTimeout(() => {
          lingerTimer.current = null;
          setActive(null);
        }, TOUCH_LINGER_MS);
      },
    },
  };
}
