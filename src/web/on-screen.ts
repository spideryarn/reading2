/**
 * **Which of the article's rows are on screen** — the DOM half, shared by the
 * reading-time recorder (useReadingTime.ts) and the band's on-screen block
 * links (OnScreenLinksStyle.tsx). `reading-time.ts` holds the pure arithmetic
 * both build on (`firstOnScreen`, `SAFE_ID`).
 *
 * Moved out of useReadingTime.ts on 2026-10-01 so the second caller reuses the
 * binary search rather than writing a per-row pass over a 2,000-row table —
 * docs/plans/261001n-trajectory-question-above-quote-and-highlight-on-screen-block-links.md.
 */
import { type BlockId, MAX_VISIBLE_BLOCKS } from "../types.js";
import { firstOnScreen, type RowBox, SAFE_ID } from "./reading-time.js";
import { dockOffset, stickyOffset } from "./scroll.js";

/** The spelling of a block's row every other reader of this table uses — Spine.tsx, keynav.ts. */
export const ROW_SELECTOR = "tbody tr[data-block]";

/** How often the cached row list is read again even when it looks intact. */
const ROWS_STALE_MS = 10_000;

/**
 * The table's rows, cached between samples and read again when the first or
 * last has left the document (a re-render) or the list is older than
 * `ROWS_STALE_MS`.
 */
export function rowCache(): (now: number) => HTMLElement[] {
  let rows: HTMLElement[] = [];
  let readAt = 0;
  return (now) => {
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (!first || !last || !first.isConnected || !last.isConnected || now - readAt > ROWS_STALE_MS) {
      rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
      readAt = now;
    }
    return rows;
  };
}

/**
 * The rows between `viewTop` and `viewBottom`, with their boxes.
 *
 * A binary search for the first, then top-down until one starts below the view:
 * about log₂ n rect reads plus a screenful, each row read at most once, and
 * nothing written to the DOM in between.
 */
export function rowsOnScreen(rows: readonly HTMLElement[], viewTop: number, viewBottom: number): RowBox[] {
  const boxes = new Map<number, DOMRect>();
  const rect = (i: number): DOMRect => {
    let r = boxes.get(i);
    if (!r) {
      r = (rows[i] as HTMLElement).getBoundingClientRect();
      boxes.set(i, r);
    }
    return r;
  };
  const out: RowBox[] = [];
  for (let i = firstOnScreen(rows.length, (j) => rect(j).bottom, viewTop); i < rows.length; i++) {
    const r = rect(i);
    if (r.top >= viewBottom) break;
    const id = (rows[i] as HTMLElement).dataset.block;
    if (id) out.push({ id, top: r.top, bottom: r.bottom });
  }
  return out;
}

/**
 * How much of a row has to be between the lines for it to count as on screen:
 * this many pixels, or all of it when it is shorter. A two-pixel sliver at the
 * bottom edge is a paragraph nobody can read.
 */
export const ON_SCREEN_MIN_PX = 24;

/** The ids of the rows that are on screen, sorted and without repeats. */
export function onScreenIds(rows: readonly RowBox[], viewTop: number, viewBottom: number): BlockId[] {
  const ids = new Set<BlockId>();
  for (const row of rows) {
    const shown = Math.min(row.bottom, viewBottom) - Math.max(row.top, viewTop);
    const need = Math.min(ON_SCREEN_MIN_PX, row.bottom - row.top);
    if (shown > 0 && shown >= need) ids.add(row.id);
  }
  return [...ids].sort();
}

/**
 * **The band's block links to the paragraphs on screen, lit** — one rule.
 *
 * Keyed on `data-block-link`, which every block link carries (BlockRef.tsx) and
 * which the link card already listens for, so every mode gets it without a
 * change to its panel. Scoped to `.mode-band`: a link in the prose or in the
 * passage Chat dialog lighting up because its own paragraph is on screen would
 * be noise (Greg asked for it "in such modes"). A missing reference is a
 * non-interactive span and is excluded explicitly, so this unlayered runtime
 * rule can never brighten it over `.block-ref-missing`'s deliberately dim look.
 *
 * The declarations are here rather than in a stylesheet because a generated
 * rule has to carry at least one, and CSS has no way to make a custom property
 * switch a set of declarations on. The colour is still a token
 * (`--block-link-on-screen`, prose.css), so the look stays the stylesheet's.
 * `opacity: 1` lifts the link's own resting 0.5; a parent that dims its links
 * (Summary's `.summ-range`) still dims them, and the wash still shows.
 *
 * An id that fails the format is skipped rather than escaped — it is not ours.
 * Empty for no ids, so the caller can render nothing.
 */
export function onScreenLinkCss(ids: readonly BlockId[]): string {
  const selectors = ids.filter((id) => SAFE_ID.test(id)).map((id) => `[data-block-link="${id}"]`);
  if (selectors.length === 0) return "";
  return `.mode-band :is(${selectors.join(",")}):not(.block-ref-missing){background-color:var(--block-link-on-screen);opacity:1;border-radius:3px;-webkit-box-decoration-break:clone;box-decoration-break:clone}`;
}

/**
 * **The blocks on screen right now, read once** — for a chat question, which
 * tells the model what the reader could see when they pressed Send. The same
 * window and the same 24px rule as `OnScreenLinksStyle`, without its sampler:
 * one question needs one reading, not one per scroll frame.
 *
 * Says nothing about whether the prose is visible at all; a band lying over it
 * is the caller's to know (Reader's `fit.modeW`).
 * docs/plans/261001q-chat-knows-the-blocks-on-screen.md.
 */
export function blocksOnScreenNow(): BlockId[] {
  const top = stickyOffset();
  const bottom = window.innerHeight - dockOffset();
  const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR));
  return onScreenIds(rowsOnScreen(rows, top, bottom), top, bottom).slice(0, MAX_VISIBLE_BLOCKS);
}
