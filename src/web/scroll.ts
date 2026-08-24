/**
 * Scrolling to a block, in one place.
 *
 * Three things now want to do this — the deep link in the URL hash, a click on
 * a gist, and a click on a spine segment — and they must agree, because they
 * are all claiming to put the *same* block under the reader's eye. They used to
 * disagree: the hash landed the row's top below the sticky bars, while a gist
 * click used `scrollIntoView({ block: "center" })`, which centres a row that may
 * be a single line or may be a 900-word paragraph.
 *
 * Everything addresses the block by its stable id — never by offset or selector
 * path. See docs/project/block-ids.md.
 */

/**
 * Height of the two sticky bars a row has to clear: `.controls` (--bar-h) plus
 * the table head (--head-h). Kept in sync with styles.css by hand; if you change
 * either variable, change this.
 */
export const STICKY_OFFSET = 84;

export function scrollToBlock(id: string, behavior: ScrollBehavior = "smooth") {
  const row = document.querySelector<HTMLElement>(
    `tr[data-block="${CSS.escape(id)}"]`,
  );
  if (!row) return;
  // Explicit and clamped rather than scrollIntoView(): we want the row's own
  // top edge, offset to clear the bars, and no surprise when the row sits
  // inside a cell that spans dozens of others.
  const top = row.getBoundingClientRect().top + window.scrollY - STICKY_OFFSET;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: Math.max(0, Math.min(top, max)), behavior });
}
