/**
 * **A PDF's numbered reference list, read from its own text layer** — for the
 * Citations stage, which otherwise never sees one (plan 260930i,
 * SPIDERYARN-READING2-6K).
 *
 * Stage 2 transcribes a PDF's bibliography and then deliberately does not
 * render it (`RENDERED` in src/pdf.ts — Greg's v1 call), so an article made
 * from a PDF has a `References` heading and nothing under it. A numbered paper
 * then gives the Citations model `TV episodes [8]` and nothing to say what `[8]`
 * is, and every row comes back with no authors, no year and a title the model
 * made up to describe the cite.
 *
 * The text layer is the better source here than stage 2's transcription would
 * be: pdf.js, no model, deterministic and complete — stage 2's reading of a
 * bibliography page is unchecked by design (src/pdf-read.ts §
 * `bibliographyPages`). It is the article's own text.
 *
 * **Numbered lists only, and split by code.** GPT Sol's plan review (F2): a
 * model asked to copy "the whole entry" can copy one and a half, and a copied
 * string that occurs once in the list proves nothing about where the entry
 * ends. So code splits the list at its own numbers — `8.`, `[8]`, `8)` at the
 * start of a line, each exactly one more than the last — and the model names an
 * entry by number, which code then checks against the `[8]` in the citing
 * words (src/citations.ts § `verifyEntry`). An author–year list has no number
 * to check a pairing by, and is left for later.
 *
 * Pure: lines in, entries or `null` out. The pipeline's `citations` step does
 * the reading (src/pipeline.ts § `pdfReferenceList`), and hands this the lines
 * with the running headers and footers already taken out (`pageLines` in
 * src/pdf.ts), so a journal header repeated on every bibliography page — even
 * one that says "References" — never ends up inside an entry or looks like the
 * list's heading.
 */

/** The most of a list the prompt carries — about 15k tokens, a 150-entry bibliography. */
export const REFERENCE_LIST_MAX = 60_000;

/** Fewer entries than this is not a reference list: a short numbered list in the prose, say. */
export const MIN_ENTRIES = 5;

/**
 * An entry longer than this has swallowed what follows the list — an appendix,
 * a biography, a figure legend — and the list is taken to end before it.
 */
const ENTRY_MAX = 1_000;

/**
 * A line that is only a bibliography's heading, optionally numbered ("7
 * References"). Anchored at both ends, so a sentence that says "references" is
 * never one.
 */
const HEADING =
  /^\s*(?:\d{1,2}\.?\s+)?(?:references(?:\s+and\s+notes|\s+cited)?|bibliography|literature\s+cited|works\s+cited|cited\s+literature)\s*:?\s*$/i;

/** `8. Chen`, `[8] Chen`, `8) Chen` — a number, its mark, a space, then words. */
const ENTRY_START = /^\s*\[?(\d{1,4})[.\])]\s+(?=\S)/;

/** One numbered list: its entries by number, in order. */
export interface NumberedReferenceList {
  /** Number → the entry's text, whitespace collapsed, number included. */
  entries: Map<number, string>;
}

/**
 * **The numbered list under a bibliography heading**, or `null`.
 *
 * Every heading line is a candidate, latest first, and the first whose lines
 * parse as a numbered list — starting at 1, at least `MIN_ENTRIES` long — wins.
 * Latest, so a contents page naming "References" loses to the list itself;
 * every candidate, so a bibliography that starts before the middle of a
 * reference-heavy paper is still found, and a heading with nothing parseable
 * under it gives way to an earlier one.
 */
export function referenceListFrom(lines: readonly string[]): NumberedReferenceList | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!HEADING.test(lines[i] ?? "")) continue;
    const list = numberedEntries(lines.slice(i + 1));
    if (list !== null) return list;
  }
  return null;
}

/**
 * **Split lines into entries at their numbers**, or `null` when they are not a
 * numbered list.
 *
 * An entry starts only where a line begins with the *next* number — `9.` after
 * `8.` — so a continuation line that happens to begin with digits ("33,
 * 1106–1128", "2024. Available at…") is never read as a new entry. A gap in
 * the numbering therefore ends the list: the missing entry's text would
 * otherwise be glued to its predecessor and credited to it, and a short list
 * is better than a wrong one. So does an entry longer than `ENTRY_MAX`, or the
 * list passing `REFERENCE_LIST_MAX`.
 */
export function numberedEntries(lines: readonly string[]): NumberedReferenceList | null {
  const entries = new Map<number, string>();
  let current: { n: number; parts: string[] } | null = null;
  let total = 0;
  const close = (): boolean => {
    if (current === null) return true;
    const text = dehyphenate(current.parts.join("\n")).replace(/\s+/g, " ").trim();
    if (text.length > ENTRY_MAX || total + text.length > REFERENCE_LIST_MAX) return false;
    entries.set(current.n, text);
    total += text.length;
    return true;
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = ENTRY_START.exec(line);
    const n = m ? Number(m[1]) : null;
    const next: number = current === null ? 1 : current.n + 1;
    if (n !== null && n === next) {
      if (!close()) break;
      current = { n, parts: [line] };
      continue;
    }
    /* Before entry 1, a line is the heading's own furniture — skipped. */
    if (current === null) continue;
    current.parts.push(line);
  }
  close();
  return entries.size >= MIN_ENTRIES ? { entries } : null;
}

/**
 * **Join a word the typesetter broke across two lines**: `narra-\ntive` →
 * `narrative`, only where a lowercase letter follows, so `Cohn-\nSheehy` keeps
 * its hyphen (`Cohn-Sheehy`).
 */
export function dehyphenate(text: string): string {
  return text.replace(/(\p{L})-\n(?=\p{Ll})/gu, "$1").replace(/(\p{L})-\n(?=\p{Lu})/gu, "$1-");
}

/** The list as the prompt shows it: one `[n] entry` a line. */
export function referenceListText(list: NumberedReferenceList): string {
  return [...list.entries].map(([n, text]) => `[${n}] ${text.replace(/^\s*\[?\d{1,4}[.\])]\s+/, "")}`).join("\n");
}
