/**
 * Scrolling to a block, in one place.
 *
 * Four things now want to do this — the deep link in the URL, a click on a
 * gist, a click on a spine segment, and an ↑/↓ keypress (keynav.ts) — and
 * they must agree, because they are all claiming to put the *same* block under
 * the reader's eye. They used to disagree: the hash landed the row's top below
 * the sticky bars, while a gist click used `scrollIntoView({ block: "center" })`,
 * which centres a row that may be a single line or may be a 900-word paragraph.
 *
 * Everything addresses the block by its stable id — never by offset or selector
 * path. See docs/project/block-ids.md.
 */

/**
 * Height of the two sticky bars a row has to clear: `.controls` plus the table
 * head. **Measured, not declared.**
 *
 * This used to be the literal `84`, with a comment asking whoever changed
 * `--bar-h` or `--head-h` in styles.css to remember to change it here too. Three
 * separate things now depend on it — deep links, the `?at=` tracker, and the
 * arrow keys — and the failure when it drifts is the quiet kind this codebase
 * keeps meeting (docs/reusable/silent-success.md): nothing errors, every jump
 * simply lands a few pixels under the bar it was supposed to clear, and the
 * check you would run to confirm the scroll worked says it worked.
 *
 * Measuring the bars themselves cannot drift, and it is also more honest about
 * what the number means: not "what two custom properties say", but "how tall the
 * things in the way actually are" — which also covers a header that wraps to two
 * lines, browser zoom, and a user's larger default font size.
 *
 * Two rects per call. Everything asking already reads layout in the same batch.
 */
/**
 * Height of the fixed bar along the bottom — Dock.tsx.
 *
 * The counterpart to `stickyOffset`, and it exists for the same reason: a line
 * underneath it is not on screen in any sense the reader cares about. Nothing
 * needed it while every jump put a row's *top* under the header, because what
 * the bar covers is then below the thing you are looking at. A screenful step
 * needs it, because a screenful measured without it lands the next screen's top
 * where the last one's bottom *notionally* ended — and the bottom 40px of that
 * screen was behind the bar the whole time, so those lines are never read.
 *
 * Measured rather than read off `--dock-h`, for the reason the header offset is
 * (see above): a number agreed between two files drifts, and drifts quietly.
 */
export function dockOffset(): number {
  const dock = document.querySelector<HTMLElement>(".dock");
  return dock ? dock.getBoundingClientRect().height : 0;
}

export function stickyOffset(): number {
  const bar = document.querySelector<HTMLElement>(".controls");
  const head = document.querySelector<HTMLElement>("thead th");
  // Before the table exists there is nothing in the way, so nothing to clear.
  if (!bar || !head) return 0;
  return bar.getBoundingClientRect().height + head.getBoundingClientRect().height;
}

/**
 * How long a jump takes — the same length whatever the distance.
 *
 * Greg, 2026-08-25: "can you make it scroll a bit faster so I don't have to
 * wait so long?"
 *
 * That wait is not a constant we chose; it is the browser's. `behavior:
 * "smooth"` runs an animation whose duration Chrome scales with how far you are
 * going, and this view routinely jumps thousands of pixels — a section, a part,
 * the far end of the article — so the very moves that most need to feel like a
 * jump are the ones the browser makes longest. There is no API to shorten it,
 * so we run the animation ourselves and hold the duration flat: near or far, a
 * jump costs the same fifth of a second.
 *
 * Short, but deliberately not zero. The travel is what tells you the article
 * moved *under* you rather than being replaced — with the arrow keys pressed
 * repeatedly that is the difference between reading a document and shuffling
 * through slides.
 */
export const SCROLL_MS = 200;

/** Fast off the mark, gentle into the stop. */
const ease = (t: number) => 1 - (1 - t) ** 3;

let frame = 0;
let release: (() => void) | null = null;
/**
 * Where the jump in flight is headed, or null when nothing is moving.
 *
 * Exposed through `glideTarget` because a second gesture arriving mid-animation
 * has to measure from the *destination*, not from the half-animated position —
 * otherwise two swipes in quick succession deliver less than two swipes' worth
 * of movement. keynav.ts and swipe.ts already solve exactly this for steps
 * between blocks, by remembering the row they aimed at; this is the same fix
 * for the one movement that is measured in pixels rather than in rows.
 */
let aiming: number | null = null;

/** Abandon any jump in flight — a newer one, or the reader taking over. */
function cancel() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  aiming = null;
  release?.();
  release = null;
}

/** Where the current jump is going, or null if nothing is in flight. */
export function glideTarget(): number | null {
  return aiming;
}

function glide(to: number) {
  cancel();
  const from = window.scrollY;
  const distance = to - from;
  if (Math.abs(distance) < 1) return;
  const started = performance.now();
  aiming = to;

  // The browser's own smooth scroll gives up the moment you touch the wheel.
  // Ours has to be told, or we would drag the reader back to a destination they
  // have visibly changed their mind about.
  const bail = () => cancel();
  /**
   * A finger landing on a swipe surface is not the reader taking the page back.
   *
   * This listener was written when a touch during a 200ms jump was a rare
   * accident. Touch stepping made it the *normal* path — every swipe begins
   * with a `touchstart`, so without this check each gesture would abort the
   * previous one's glide, and a swipe followed by a rested finger would leave
   * the page parked part-way between two items. Which is the one state the
   * whole feature exists to prevent (docs/project/touch.md).
   *
   * Only swipe surfaces are excepted, and the exception is narrower than it
   * first looks: `touch-action: pan-x` takes *vertical* scrolling away there
   * and deliberately leaves horizontal panning to the browser. So a touch on a
   * swipe surface can still be the reader scrolling — just never on the axis
   * this animation writes. On the prose, and everywhere else, a touch stops us
   * dead as before.
   *
   * That leaves one gap, which `pointercancel` below closes: a sideways pan
   * started from a gist column. The browser fires it the moment it claims the
   * gesture for itself.
   *
   * It is not *only* that, and the difference matters to whoever reads this
   * next: the Pointer Events spec suppresses a pointer stream for zoom, palm
   * rejection, device loss and too many pointers as well. All of them mean the
   * same thing here — the gesture we were animating on behalf of is over — so
   * cancelling is right in every case. What is *not* safe is concluding from a
   * `pointercancel` that the reader panned; swipe.ts has to drop its idea of
   * where it was heading rather than assume.
   */
  const touchBail = (e: TouchEvent) => {
    const el = e.target as Element | null;
    if (el?.closest?.("[data-swipe-step]")) return;
    cancel();
  };
  window.addEventListener("wheel", bail, { passive: true });
  window.addEventListener("touchstart", touchBail, { passive: true });
  window.addEventListener("pointercancel", bail, { passive: true });
  release = () => {
    window.removeEventListener("wheel", bail);
    window.removeEventListener("touchstart", touchBail);
    window.removeEventListener("pointercancel", bail);
  };

  const tick = (now: number) => {
    const t = Math.min(1, (now - started) / SCROLL_MS);
    // `top` only: omitting `left` keeps the horizontal position, which matters
    // because a deep tree scrolls the table sideways (layout.ts § overflowing).
    window.scrollTo({ top: from + distance * ease(t), behavior: "auto" });
    if (t < 1) frame = requestAnimationFrame(tick);
    else cancel();
  };
  frame = requestAnimationFrame(tick);
}

/** Whoever asked for motion, this reader has said no. */
export function reducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function scrollToBlock(id: string, behavior: ScrollBehavior = "smooth") {
  const row = document.querySelector<HTMLElement>(
    `tr[data-block="${CSS.escape(id)}"]`,
  );
  if (!row) return;
  // Explicit and clamped rather than scrollIntoView(): we want the row's own
  // top edge, offset to clear the bars, and no surprise when the row sits
  // inside a cell that spans dozens of others.
  const top = row.getBoundingClientRect().top + window.scrollY - stickyOffset();
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const target = Math.max(0, Math.min(top, max));
  if (behavior === "smooth" && !reducedMotion()) glide(target);
  else {
    cancel();
    window.scrollTo({ top: target, behavior: "auto" });
  }
}

/**
 * One screenful, for a gesture that has nowhere left to step.
 *
 * The arrow keys have a graceful failure at the ends of the article and it is
 * worth reading (keynav.ts): they simply *don't* call `preventDefault`, so ↓ on
 * the last paragraph goes to the browser and scrolls the final screenful into
 * view. **A swipe has no such move.** `touch-action` refused the gesture
 * declaratively before any listener ran, so a swipe that finds nowhere to step
 * does not fall back to scrolling — it does nothing, and the column stays inert
 * until the reader moves their hand. At the very end of the article every gist
 * column goes inert at once, which reads as broken rather than as finished.
 *
 * **A screenful, not the whole way to the end**, and the difference matters.
 * Running to the bottom of the document was the first version of this, and it
 * quietly broke the promise the feature is built on: one gesture, one bounded
 * movement. From part-way through a part that spans a quarter of the article,
 * a single stray swipe would have thrown the reader to the very bottom — and
 * swiping back would not have undone it, because the step back lands on the
 * part's *start*, not where they were. A screenful is what the keyboard
 * actually degrades to, it is reversible, and it is still visibly alive.
 *
 * The screenful is measured net of the sticky bars, for the same reason every
 * other jump clears them: the strip under the header is not on screen in any
 * sense the reader cares about.
 */
/**
 * Where a screenful lands — the arithmetic, separated so it can be tested.
 *
 * Both bugs this has had were in these five lines and neither needed a browser
 * to find: a step that forgot the bottom obstruction, and a `from` taken from
 * the live scroll position instead of the destination. Pure and pinned in
 * tests/scroll.test.ts, per docs/project/testing.md.
 *
 * `from` is where the *previous* movement was going, so repeated gestures
 * chain; `top` and `bottom` are the two things in the way.
 */
export function screenTarget(
  from: number,
  viewportH: number,
  top: number,
  bottom: number,
  max: number,
  dir: -1 | 1,
): number {
  // At least a pixel: a viewport shorter than its own furniture would otherwise
  // step backwards, which is a stranger failure than a tiny step.
  const step = Math.max(1, viewportH - top - bottom);
  return Math.max(0, Math.min(from + dir * step, Math.max(0, max)));
}

export function scrollByScreen(dir: -1 | 1) {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  // Chain from where the last jump was *going*, not from where it has animated
  // to. Two swipes at the end of the article must deliver two screens; measuring
  // the second from a half-finished first delivers about one and a half.
  const from = glideTarget() ?? window.scrollY;
  const target = screenTarget(from, window.innerHeight, stickyOffset(), dockOffset(), max, dir);
  // Already there — the true end of the article, or the top. No jump, and no
  // pretending we did something. Compared against `from` rather than the live
  // position, so a jump already heading somewhere else is not silently kept:
  // if it is aimed anywhere but here, the clamp differs and we glide.
  if (Math.abs(from - target) < 2) return;
  if (reducedMotion()) {
    cancel();
    window.scrollTo({ top: target, behavior: "auto" });
  } else glide(target);
}

/**
 * Which block a link should put under the reader's eye when it opens.
 *
 * A URL can carry two things that sound like a position, and until 2026-08-26
 * only one of them moved the page. `?at=` restored the section and `?note=`
 * opened the dialog, so `/read/<slug>?note=<id>` with no `?at=` beside it —
 * which is exactly the shape of a link somebody *sends* — showed the reader an
 * explanation of a paragraph that was somewhere off screen, with no way to tell
 * where. Recorded as open in docs/plans/metadata-page.md and fixed here.
 *
 * **The note wins**, and the argument is about which parameter anybody meant.
 * `?at=` is written by scrolling: it is debounced, it replaces rather than
 * pushes, and it says where the sender's eye happened to be when the address
 * bar last caught up. `?note=` is only ever in a URL because someone opened a
 * dialog. So when the two disagree, one is a byproduct and the other is the
 * point of the link.
 *
 * Nothing is lost when they agree, either — if the note's passage sits inside
 * the section `?at=` names, the passage is simply the finer of the two answers,
 * and the caller's `isBlockOnScreen` check means an already-visible passage
 * costs no movement at all.
 *
 * A `?note=` naming a comment we do not have falls back to `at`. That covers
 * both the comment being deleted and the fetch not having landed yet, and the
 * caller distinguishes them by trying again when the comments arrive.
 *
 * Pure, and pinned in tests/scroll.test.ts — the rule is worth a test even
 * though the wiring around it can only be checked in a browser. Structural
 * types rather than `Comment`, so this file stays about pixels.
 */
export function arrivalTarget(
  at: string | null,
  note: string | null,
  comments: readonly { id: string; blockId: string }[],
): string | null {
  if (note === null) return at;
  return comments.find((c) => c.id === note)?.blockId ?? at;
}

/**
 * Whether a block's row is already comfortably in view.
 *
 * Used to decide whether stepping between comments should scroll at all. Two
 * comments in the same paragraph are the common case, and jolting the page
 * between them costs the reader their place for nothing.
 *
 * "Comfortably" means clear of the sticky bars at the top and not jammed against
 * the bottom edge — a row whose first line is hidden under the header is not on
 * screen in any sense the reader cares about. The margin is a tenth of the
 * window rather than a constant, so it scales with the viewport.
 */
export function isBlockOnScreen(id: string): boolean {
  const row = document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(id)}"]`);
  if (!row) return false;
  const { top, bottom } = row.getBoundingClientRect();
  const margin = window.innerHeight * 0.1;
  return top >= stickyOffset() && bottom <= window.innerHeight - margin;
}
