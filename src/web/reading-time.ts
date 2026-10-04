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

/** How read a block looks: 0 draws nothing, 2 is "read once", 4 is "read slowly, or several times" — `readLevel`. */
export type ReadLevel = 0 | 1 | 2 | 3 | 4;

/** Words per minute a block's expected reading time is measured at. */
export const READING_WPM = 230;

/** The share of a block's reading time at which both the gutter and rail start to draw. */
export const READ_REACH_FROM = 0.35;

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
 * rather than a width in pixels, so that the gutter's style sheet changes only
 * when a block crosses one. The spine draws `readReach` below, on a longer scale of its own.
 *
 * **Each level's elapsed-time threshold is twice the preceding threshold**
 * (0.35, 0.7, 1.4, 2.8 of the reading time), so the later levels grow
 * progressively farther apart:
 *
 * > It seems to get brighter too fast. […] Or make it kind of […] like
 * > finishing marginal returns of brightness with passing of time.
 * >
 * > — Greg, 2026-10-01 (spya-d940uu)
 *
 * A glance draws nothing; one brisk read is a faint line; full strength is a
 * slow read or nearly three. 0.7 is a boundary on purpose: it is what the
 * quiz calls read (read-filter.ts § `READ_ENOUGH`), and it did not move.
 * docs/plans/261002e-reading-time-line-brightens-more-slowly-and-its-card-says-the-time.md.
 */
export function readLevel(seconds: number, words: number): ReadLevel {
  if (!(seconds > 0)) return 0;
  const ratio = seconds / expectedSeconds(words);
  if (ratio < READ_REACH_FROM) return 0;
  if (ratio < 0.7) return 1;
  if (ratio < 1.4) return 2;
  if (ratio < 2.8) return 3;
  return 4;
}

/**
 * How far across the spine's rail a block's reading time reaches, in
 * **sixteenths**: 0, or a whole number from 4 to 16 — `readReach`.
 */
export type ReadReach = number;

/**
 * The share of a block's reading time at which the rail is full: seven
 * doublings of `READ_REACH_FROM`, about 45 times the reading time.
 *
 * Chosen to leave only a few percent of the measured drawn blocks full.
 * The sample, results and limits of that inference are in
 * docs/plans/261004j-spine-reading-chart-fainter-and-rarely-full.md.
 */
export const READ_REACH_FULL = READ_REACH_FROM * 2 ** 7;

/** The ratio at which each sixteenth from 5 to 16 starts: twelve equal steps of the logarithm. */
const REACH_STEPS: readonly number[] = Array.from({ length: 12 }, (_, i) =>
  i === 11 ? READ_REACH_FULL : READ_REACH_FROM * (READ_REACH_FULL / READ_REACH_FROM) ** ((i + 1) / 12),
);

/**
 * **The spine chart's width scale, and the only place it is defined**: the
 * width of the area chart at one block.
 * docs/plans/261003j-reading-time-on-the-spine-drawn-as-an-area-chart.md.
 *
 * > the distance from the left-hand margin would be an indication of how much
 * > time I've spent reading it […] So I could just look at a glance and see
 * > that wiggly line going down to show which bits I've read the most
 * >
 * > — Greg, 2026-10-03 (spya-jhe9mc)
 *
 * Logarithmic from `READ_REACH_FROM` (4, a quarter of the rail) to
 * `READ_REACH_FULL` (16), so each sixteenth is the same multiple of time,
 * about one and a half times the step before. One read at the expected pace is
 * 6; three reads at the expected pace are 9.
 *
 * > make it a bit logarithmic so it's rarer that the reading-time fills up
 * > completely all the way to the right
 * >
 * > — Greg, 2026-10-04
 *
 * **It shares `readLevel`'s start and nothing else.** Until 2026-10-04 the
 * reach was the level four times finer and filled at 2.8, the gutter line's
 * full strength. Now the rail draws exactly when the gutter line does (the
 * zero is taken from `readLevel`, not from a logarithm that could disagree at
 * the double just under 0.35), but a full-strength line no longer means a full
 * rail. The steps are a table rather than `floor(log2)`, so a boundary is a
 * comparison and cannot round a step ahead.
 */
export function readReach(seconds: number, words: number): ReadReach {
  if (readLevel(seconds, words) === 0) return 0;
  const ratio = seconds / expectedSeconds(words);
  let reach = 4;
  for (const step of REACH_STEPS) {
    if (ratio < step) break;
    reach += 1;
  }
  return reach;
}

/**
 * A duration as words a reader says — "45 s", "1 min 20 s", "14 min", "1 h 5 min" —
 * for the reading-time card. Seconds are dropped from ten minutes up, where
 * they are noise. Not mic-recording.ts § `formatDuration`, which is a
 * stopwatch's `m:ss`.
 */
export function spentWords(seconds: number): string {
  if (!(seconds >= 1)) return "under a second";
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const mins = Math.floor(s / 60);
  if (mins < 10) return s % 60 ? `${mins} min ${s % 60} s` : `${mins} min`;
  const roundMins = Math.round(s / 60);
  if (roundMins < 60) return `${roundMins} min`;
  const h = Math.floor(roundMins / 60);
  return roundMins % 60 ? `${h} h ${roundMins % 60} min` : `${h} h`;
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

/** A block id in the closed format (docs/project/block-ids.md) — safe inside an attribute selector as it stands. */
export const SAFE_ID = /^spya-[a-z0-9]+$/;
