/**
 * **A cited work's `entry`, as text** — the cap and the one shape an entry is
 * built in, shared by the Citations stage (src/bibliography.ts) and the public DTO
 * (src/public/dto.ts § `publicCitedWork`). Plan 261001b.
 *
 * The DTO needs it to tell the two kinds of entry apart. One taken from the
 * work's own bibliography block is exactly `entryOfText(block.text)`, and every
 * character of it is already in the public payload. One read from a PDF's text
 * layer is not in any block, and can carry a publisher's per-download stamp
 * that the furniture filter missed (GPT Sol, plan review P1), so it stays
 * owner-only. One function, so the stage and the check cannot drift.
 *
 * Pure: imports nothing.
 */

/** A work's `entry` as stored and shown: the article's own characters, whitespace collapsed (plan 260930i). */
export const ENTRY_CAP = 400;

/** Cut to `ENTRY_CAP`, with an ellipsis when cut. */
export function capEntry(t: string): string {
  return t.length <= ENTRY_CAP ? t : `${t.slice(0, ENTRY_CAP - 1)}…`;
}

/** Text as an entry: whitespace collapsed, trimmed, capped — or undefined when empty. */
export function entryOfText(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  return t ? capEntry(t) : undefined;
}
