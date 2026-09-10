/**
 * What the browser tab says — one pure function, one hook.
 *
 * Until 2026-09-10 every tab of this page was titled `Fleet`, from
 * `index.html`, whatever it was showing. That is the reading view's old mistake
 * (docs/project/page-titles.md) made worse, because this page's whole job is
 * to be glanced at: it is left open in a tab for hours, and the tab strip is
 * the one part of it you can see while you are working in another. A title
 * that never changes cannot tell you that something needs you.
 *
 * ## The rule is the reading view's: what is different goes first
 *
 * Every place a title is shown truncates from the right, so the left end is
 * what survives. Here that means, in order:
 *
 *  1. **`STALE`** when the masthead says it. A count read off a snapshot this
 *     page has stopped believing is the exact thing the banner exists to
 *     disbelieve, so the tab disbelieves it too — first, before the count.
 *  2. **The count of sessions that need you**, as `(3)` — the convention a
 *     reader already knows from a mail tab. It is the first question the page
 *     answers (Header.tsx § `COUNT_TIPS`), so it is the first thing in the tab.
 *     With nobody needing you but some rows unanswerable, it is `(?)`: a bare
 *     tab over eleven unknown rows is the "0 need you" the masthead refuses to
 *     print.
 *  3. **What this tab is showing** — the selected session's name on Sessions,
 *     otherwise the mode's own label, the same word as its button in the dock.
 *  4. **`Fleet`**, last, where losing it costs nothing.
 *
 * **Sessions, with nothing selected, is absent rather than spelled out** — the
 * reading view does the same with its default mode — so the resting tab is
 * `(2) Fleet` and a tab that says anything else has been moved off it.
 */
import { useEffect } from "react";

import { MODE_LABELS, type Mode } from "./mode";
import type { Tally } from "./view";

export const APP_NAME = "Fleet";
export const SEP = " · ";

/**
 * How much of a session's name the tab keeps. Agent-written titles run to a
 * sentence, and everything after it would be truncated off the tab anyway —
 * but not out of the history list, where a whole sentence is noise.
 */
export const NAME_CLAMP = 48;

function clamp(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= NAME_CLAMP ? trimmed : `${trimmed.slice(0, NAME_CLAMP - 1).trimEnd()}…`;
}

/** `(3)`, `(?)`, or nothing. `null` counts means no payload has arrived yet. */
export function attentionMark(counts: Tally | null): string | null {
  if (counts === null) return null;
  if (counts.needsYou > 0) return `(${counts.needsYou})`;
  if (counts.unknown > 0) return "(?)";
  return null;
}

export function fleetTitle(args: {
  mode: Mode;
  counts: Tally | null;
  stale: boolean;
  /** The selected session's label, when the Sessions tab resolves one. */
  selected: string | null;
}): string {
  const { mode, counts, stale, selected } = args;
  const what = mode === "sessions" ? (selected === null ? null : clamp(selected)) : MODE_LABELS[mode];
  const name = [what, APP_NAME].filter((s): s is string => s !== null && s !== "").join(SEP);
  return [stale ? "STALE" : null, attentionMark(counts), name].filter((s): s is string => s !== null).join(" ");
}

/** Assigns the tab's title whenever the string changes. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
