/**
 * **Where you have spent time reading** — the arithmetic, with no DOM and no
 * clock in it. `useReadingTime.ts` is the half that samples and sends;
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md
 * is the argument for every number here.
 *
 * > I would love for there to be a way to indicate where I've spent time in the
 * > article, perhaps in the spine and or as a kind of subtle indicator in the
 * > vertical gutter next to the text.
 * >
 * > — Greg, 2026-09-12
 */
import type { BlockId } from "../types.js";

/** How read a block looks: 0 draws nothing, 4 is "on screen as long as it takes to read". */
export type ReadLevel = 0 | 1 | 2 | 3 | 4;

/** Words per minute a block's expected reading time is measured at. */
export const READING_WPM = 230;

/**
 * Seconds it takes to read a block of `words` words, and never under one.
 *
 * The floor is for headings, figures and rules. A second is **shared out** by
 * visible area (`shareVisible`), so a one-line heading on a screen of prose gets
 * a small slice of each second — a floor much above one would leave every
 * heading faint however long the reader sat on the section under it.
 */
export function expectedSeconds(words: number): number {
  return Math.max(1, (Math.max(0, words) * 60) / READING_WPM);
}

/**
 * The step `seconds` has reached for a block of `words` words.
 *
 * **Absolute and per block**, not relative to the article's most-read block:
 * that would answer "where did I spend most time", and one paragraph stared at
 * for ten minutes would make the rest of the piece look unread. Four steps
 * rather than a width in pixels, so that neighbouring blocks merge into runs on
 * the spine and the gutter's style sheet changes only when a block crosses one.
 */
export function readLevel(seconds: number, words: number): ReadLevel {
  if (!(seconds > 0)) return 0;
  const ratio = seconds / expectedSeconds(words);
  if (ratio < 0.1) return 0;
  if (ratio < 0.35) return 1;
  if (ratio < 0.7) return 2;
  if (ratio < 1) return 3;
  return 4;
}

/** A row's vertical extent in viewport pixels — `getBoundingClientRect().top` and `.bottom`. */
export interface RowBox {
  id: BlockId;
  top: number;
  bottom: number;
}

/**
 * The index of the first row whose bottom is below `viewTop`, by binary search,
 * or `count` when there is none.
 *
 * `bottomAt(i)` must be non-decreasing in `i`, which table rows in document
 * order are. This is what keeps a once-a-second sample to about log₂ n rect
 * reads plus a screenful on a 2,000-block article, rather than one read per row
 * (docs/plans/260905d-mode-switching-is-sluggish-on-a-very-long-article.md
 * measured what a per-row pass over this table costs).
 */
export function firstOnScreen(count: number, bottomAt: (i: number) => number, viewTop: number): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (bottomAt(mid) > viewTop) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * How one second is shared between the rows on screen: each row's visible
 * pixels over all rows' visible pixels, so the shares add up to one.
 *
 * **Shared, not multiplied.** The first draft gave every visible block the whole
 * second, and a screen of eight paragraphs stays up for as long as it takes to
 * read all eight — so all eight reached "read" in the time it takes to read one.
 * By area, which for prose is roughly by words, a reader at an ordinary pace
 * gives each block about its own `expectedSeconds`. GPT Sol and Fable,
 * independently, 2026-09-16.
 *
 * Empty when nothing is visible — a window with no rows on screen earns
 * nothing, rather than dividing by zero.
 */
export function shareVisible(rows: readonly RowBox[], viewTop: number, viewBottom: number): Map<BlockId, number> {
  const visible: [BlockId, number][] = [];
  let total = 0;
  for (const row of rows) {
    const px = Math.min(row.bottom, viewBottom) - Math.max(row.top, viewTop);
    if (px > 0) {
      visible.push([row.id, px]);
      total += px;
    }
  }
  const out = new Map<BlockId, number>();
  if (total <= 0) return out;
  for (const [id, px] of visible) out.set(id, (out.get(id) ?? 0) + px / total);
  return out;
}

/**
 * The gutter's style sheet: one rule per block that has a level.
 *
 * **A style element rather than props into `TableView`**, which is `memo`ised
 * over every row of the article: a changing map as a prop would re-render all
 * of them each time one block crossed a step. A rule keyed on the row's own
 * `data-block` survives the rows being remounted and needs no imperative DOM
 * write. Block ids are a closed format (docs/project/block-ids.md), so one is
 * safe inside an attribute selector as it stands; anything else is skipped
 * rather than escaped, because an id that fails the format is not ours.
 *
 * Sorted by id so the same levels always produce the same text, which is what
 * lets the caller skip a re-render when nothing changed.
 */
export function gutterCss(levels: ReadonlyMap<BlockId, ReadLevel>): string {
  const rules: string[] = [];
  for (const id of [...levels.keys()].sort()) {
    const level = levels.get(id) ?? 0;
    if (level === 0 || !SAFE_ID.test(id)) continue;
    rules.push(`tr[data-block="${id}"]{--read:${level}}`);
  }
  return rules.join("\n");
}

const SAFE_ID = /^spya-[a-z0-9]+$/;
