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

/**
 * `8. Chen`, `[8] Chen`, `8) Chen`, or a superscript `8` emitted alone or
 * without punctuation. Three digits are ample inside the 60k prompt cap and,
 * importantly, keep a continuation such as `2024. Available at…` from looking
 * like entry 2024.
 */
const MARKED_ENTRY_START = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])(?:\s+(?=\S)|\s*$)/;
const BARE_ENTRY_START = /^\s*(\d{1,3})\s*$/;
const SUPERSCRIPT_ENTRY_START = /^\s*(\d{1,3})(?:\s+(?=\p{L})|(?=\p{Lu}))/u;

/**
 * The number a line starts with, and how sure that is: `marked` (`8.`, `[8]`,
 * `8)`) is an entry's own label; `bare` (a line that is only a number) and
 * `superscript` (a number run into words) may equally be a page number printed
 * alone at a page foot — `repeatedLines` never treats a line that short as
 * furniture — or a continuation such as `2 vols. Oxford`.
 */
function entryNumber(line: string): { n: number; marked: boolean } | null {
  const marked = MARKED_ENTRY_START.exec(line);
  if (marked) return { n: Number(marked[1] ?? marked[2]), marked: true };
  const bare = BARE_ENTRY_START.exec(line);
  if (bare) return { n: Number(bare[1]), marked: false };
  const superscript = SUPERSCRIPT_ENTRY_START.exec(line);
  return superscript ? { n: Number(superscript[1]), marked: false } : null;
}

/** A contents page's section list is not a bibliography, even under a `References` line. */
const TOC_SECTION = /^(?:introduction|background|related work|methods?|materials?|results?|discussion|conclusions?|appendix|acknowledgements?)\b/i;

function looksLikeContents(list: NumberedReferenceList): boolean {
  let sections = 0;
  let leaders = 0;
  for (const text of list.entries.values()) {
    const withoutNumber = text
      .replace(/^\s*(?:\[\d{1,3}\]|\d{1,3}[.)]?)(?:\s+|$)/, "")
      .trim();
    if (TOC_SECTION.test(withoutNumber)) sections++;
    if (/\.{3,}\s*\d+\s*$/.test(withoutNumber)) leaders++;
  }
  return sections >= 3 || leaders >= 3;
}

/** One numbered list: its entries by number, in order. */
export interface NumberedReferenceList {
  /** Number → the entry's text, whitespace collapsed, number included. */
  entries: Map<number, string>;
  /**
   * The same entries before dehyphenation, when this list came from the PDF
   * splitter. Identifier parsing needs the line ends: `neu-\nron` may contain
   * a DOI's own hyphen, even though the reader should see `neuron`.
   */
  identifierEntries?: Map<number, string>;
}

/**
 * **The numbered list under a bibliography heading**, or `null`.
 *
 * Every heading line is a candidate, latest first, and the first whose lines
 * parse as a numbered list — starting at 0 or 1, at least `MIN_ENTRIES` long — wins.
 * Latest, so a contents page naming "References" loses to the list itself;
 * every candidate, so a bibliography that starts before the middle of a
 * reference-heavy paper is still found, and a heading with nothing parseable
 * under it gives way to an earlier one.
 */
export function referenceListFrom(lines: readonly string[]): NumberedReferenceList | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!HEADING.test(lines[i] ?? "")) continue;
    const list = numberedEntries(lines.slice(i + 1));
    if (list !== null && !looksLikeContents(list)) return list;
  }
  return null;
}

/**
 * **Split lines into entries at their numbers**, or `null` when they are not a
 * numbered list.
 *
 * An entry starts only where a line begins with the *next* number — `9.` after
 * `8.` — so a continuation line that happens to begin with digits ("33,
 * 1106–1128", "2024. Available at…") is never read as a new entry. The first
 * number may be 0 or 1. A gap, a restart, or row-interleaved two-column order
 * ends the list: appending the unexpected numbered line would credit another
 * work to the current entry, and a short list is better than a wrong one. So
 * does an entry longer than `ENTRY_MAX`, or the list passing
 * `REFERENCE_LIST_MAX`.
 */
export function numberedEntries(lines: readonly string[]): NumberedReferenceList | null {
  const entries = new Map<number, string>();
  const identifierEntries = new Map<number, string>();
  let current: { n: number; parts: string[] } | null = null;
  let total = 0;
  const close = (): boolean => {
    if (current === null) return true;
    /* Outer line whitespace is layout noise; the newline itself is evidence.
       Keeping exactly that distinction also makes continuation checks
       independent of PDF indentation. */
    const identifierText = current.parts.map((part) => part.trim()).join("\n").trim();
    const text = dehyphenate(identifierText).replace(/\s+/g, " ").trim();
    if (text.length > ENTRY_MAX || total + text.length > REFERENCE_LIST_MAX) return false;
    entries.set(current.n, text);
    identifierEntries.set(current.n, identifierText);
    total += text.length;
    return true;
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const at = entryNumber(line);
    if (current === null) {
      if (at?.n !== 0 && at?.n !== 1) continue;
      current = { n: at.n, parts: [line] };
      continue;
    }
    if (at !== null && at.n === current.n + 1) {
      if (!close()) {
        current = null;
        break;
      }
      current = { n: at.n, parts: [line] };
      continue;
    }
    /* An entry's own label out of sequence is a gap, a restart or another
       column's entry: stop rather than credit it to this one. A bare or run-in
       number out of sequence is a page number (dropped) or part of the text. */
    if (at?.marked) break;
    if (at !== null && BARE_ENTRY_START.test(line)) continue;
    current.parts.push(line);
  }
  close();
  return entries.size >= MIN_ENTRIES ? { entries, identifierEntries } : null;
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
  return [...list.entries]
    .map(([n, text]) =>
      `[${n}] ${text.replace(/^\s*(?:\[\d{1,3}\]|\d{1,3}[.)]?)(?:\s+|$)/, "")}`,
    )
    .join("\n");
}
