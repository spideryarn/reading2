/**
 * Reading position — **the DOM half**, and the seam a test can drive.
 *
 * [position.ts](position.ts) is the pure half: hand `positionToWrite` a `tops`
 * array and it tells you what `?at=` should say. This file is the part that
 * goes and gets the `tops` array, which is the expensive part and the part that
 * was previously unreachable.
 *
 * ## Why it is its own file
 *
 * It lived inside a closure inside `App.tsx § useReadingPosition`, where nothing
 * could call it. That mattered more than it looks. The instrument in
 * geometry-cost.ts hands `noteGeometry` a **hand-maintained integer** saying how
 * many layout reads the frame performed, and that integer is what the plan's
 * whole decision rests on — but GPT Sol, reviewing Stage 1 on 2026-09-06 (F15),
 * showed the suite could not see it move:
 *
 * > Changing covered `measureRow` from `rows.length` to `rows.length + 1` failed
 * > exactly. In contrast, changing `readingPosition`'s read count to `1`, and
 * > separately moving its timer start immediately before `noteGeometry`, both
 * > left all 12 tests green.
 *
 * So the number that authorised the work was the one number nothing checked.
 * Not merely uncovered — uncovered at precisely the site the conclusion came
 * from, which is [silent-success.md](../../docs/reusable/silent-success.md)'s
 * exact shape: the reassuring reading and the broken reading are the same
 * reading.
 *
 * `measureReadingPosition` is that closure body, lifted out unchanged, so
 * [tests/reading-position-seam.test.ts](../../tests/reading-position-seam.test.ts)
 * can count the rects the browser was actually asked for and compare them with
 * the count the instrument published. It takes no injected accessors and does no
 * dependency inversion: it reads the real DOM, and the test spies on
 * `Element.prototype.getBoundingClientRect`. A version that took its readers as
 * parameters would be a version whose test never exercised the reads.
 *
 * ## What it does not do
 *
 * It does not touch React state. The caller owns `synced.current` and `setAt`,
 * because those are what make the hook a hook — and keeping them out means this
 * function is callable twice with no consequence, which is what lets a test
 * assert that a second identical frame reads the same amount again.
 */
import type { BlockId } from "../types.js";
import { NO_FRAME, NO_GEOMETRY_CLOCK, noteGeometry, parentGeometryClock } from "./geometry-cost.js";
import { positionToWrite, type Section } from "./position.js";
import { glideTarget, stickyOffset } from "./scroll.js";

export interface ReadingPositionFrame {
  sections: Section[];
  /** The article's block → row index, built once by the caller. */
  rowOf: ReadonlyMap<BlockId, number>;
  /**
   * One element per section, in document order, `null` where the section has no
   * row on screen — `rows.ts § rowsForBlockIds`, resolved once per effect
   * rather than once per frame.
   */
  rows: (HTMLElement | null)[];
  /**
   * How many of `rows` are non-null, counted once by the caller **outside** the
   * timed interval. It is passed rather than derived here because deriving it
   * would be an `O(sections)` pass inside the very interval being measured,
   * against a 4ms budget — and on the heavy articles that is 1,237 additions a
   * frame charged to the thing under test.
   *
   * It is the resolved count and **not** `rows.length`: a hole is skipped
   * without a read, so counting it would report a busy sampler on an article
   * whose tree never resolved, which is the inversion that would argue hardest
   * for work nobody needs.
   */
  resolved: number;
  /** What `?at=` says now. */
  held: BlockId | null;
  /**
   * The `DOMHighResTimeStamp` `requestAnimationFrame` handed the caller, used
   * only to label this call's timed sample so the harness can add it to
   * `useColumnContext`'s within one frame (Sol F11). An **argument**, never a
   * clock read — docs/postmortems/260907a-a-probe-that-read-the-same-clock-twice.md.
   */
  at?: number;
}

/**
 * One frame's worth of reading-position measurement: read the geometry, ask
 * position.ts what the address should say, and charge the reads to the
 * instrument.
 *
 * Returns exactly what `positionToWrite` returns — `null` for "write nothing",
 * or the value `?at=` should take. The caller decides what to do with it.
 */
export function measureReadingPosition(frame: ReadingPositionFrame): { at: BlockId | null } | null {
  const { sections, rowOf, rows, resolved, held, at = NO_FRAME } = frame;
  /* The clock starts before the first read, and that ordering is asserted
     rather than trusted: Sol moved this line down to sit beside `noteGeometry`
     and no test noticed, which would have reported a sampler costing almost
     nothing while it read every row in the article. */
  const t0 = parentGeometryClock();
  /* Ask **first**, and skip the rects entirely if a jump is in flight. Reading
     them and then throwing the answer away is the expensive half of this
     measurement done for nothing (performance.md). GPT Sol, 2026-08-30. */
  const jumpInFlight = glideTarget() !== null;
  /* **One `stickyOffset()` per frame, not two.** `line` and `atTop` both want
     it and each used to call it, and each call is a rect on `.controls` plus a
     `getComputedStyle` in safe-area.ts — four layout reads a frame where two
     do, on every article whatever its length. Nothing between the two uses
     writes to the DOM, so the second call could only ever have returned what
     the first did. Stage 2 of the A8 plan. */
  const sticky = stickyOffset();
  const next = positionToWrite({
    sections,
    rowOf,
    tops: jumpInFlight
      ? []
      : rows.map((el) => (el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY)),
    line: sticky + 1,
    jumpInFlight,
    atTop: window.scrollY <= sticky,
    held,
  });
  /* Charged whichever way it goes, and **before** the caller's early return, so
     a frame that decides to write nothing still reports the layout it read to
     decide that. `window.scrollY` plus one rect per resolved row — and **zero
     rects during a glide**, which is the skip above working and is worth seeing
     in the data rather than inferring. The two `stickyOffset()` reads are
     charged to their own leaf, so they are not counted again here. */
  if (t0 !== NO_GEOMETRY_CLOCK)
    noteGeometry("readingPosition", t0, 1 + (jumpInFlight ? 0 : resolved), 0, at);
  return next;
}
