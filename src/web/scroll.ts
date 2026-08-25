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

/** Abandon any jump in flight — a newer one, or the reader taking over. */
function cancel() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  release?.();
  release = null;
}

function glide(to: number) {
  cancel();
  const from = window.scrollY;
  const distance = to - from;
  if (Math.abs(distance) < 1) return;
  const started = performance.now();

  // The browser's own smooth scroll gives up the moment you touch the wheel.
  // Ours has to be told, or we would drag the reader back to a destination they
  // have visibly changed their mind about.
  const bail = () => cancel();
  window.addEventListener("wheel", bail, { passive: true });
  window.addEventListener("touchstart", bail, { passive: true });
  release = () => {
    window.removeEventListener("wheel", bail);
    window.removeEventListener("touchstart", bail);
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
function reducedMotion(): boolean {
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
