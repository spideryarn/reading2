/**
 * **What a cited work's note is, in words** — the band, the prose hover card
 * and chat's `article_citations` all say where a note came from, so the words
 * are here, once. Plan 261017h stage 3c
 * (docs/plans/261017h-stage-3-design-citation-blurbs.md § 4, § 6).
 *
 * On the client's shared list (tests/client-imports.test.ts): it imports
 * `types.js`, types only, and nothing else.
 *
 * **The plain-words rule** (docs/project/prompting-guide.md) applies here as to
 * a prompt: *a public catalogue of papers*, not *a bibliographic registry*.
 * And every sentence keeps what a note is **not** next to what it is — a quick
 * look-up, not a web search and not a reading of the paper — because Greg's
 * own bar for it was *"better to say nothing than hallucinate"* (spya-m53cdk).
 */
import type { CitedWorkBlurb, CitedWorkWebNote } from "./types.js";

/**
 * Who holds the abstract a note was written from: arXiv (through DataCite),
 * Crossref, DataCite, OpenAlex or Semantic Scholar. Semantic Scholar is named
 * even for an arXiv paper: its licence asks that what is shown from it say so.
 */
export function blurbHolder(blurb: Pick<CitedWorkBlurb, "source" | "workId">): string {
  if (blurb.source === "openalex") return "OpenAlex";
  if (blurb.source === "semantic-scholar") return "Semantic Scholar";
  if (blurb.workId.startsWith("arxiv:")) return "arXiv";
  return blurb.source === "crossref" ? "Crossref" : "DataCite";
}

/**
 * **The paper's page at Semantic Scholar**, for a note written from its copy
 * of the abstract — the link back its licence asks for, with the
 * `utm_source=api` it names. `paperId` was re-checked as forty hex characters
 * where the note was read (src/citation-blurbs-identity.ts § `shownBlurb`).
 */
export function semanticScholarPaperUrl(paperId: string): string {
  return `https://www.semanticscholar.org/paper/${paperId}?utm_source=api`;
}

/**
 * **The row's quiet label** — *From the abstract · arXiv*, *· Crossref*,
 * *· DataCite*, *· Semantic Scholar*, or *From OpenAlex's copy of the
 * abstract*, which is OpenAlex's reconstruction from its word index rather
 * than the author's own text.
 */
export function blurbBasis(blurb: Pick<CitedWorkBlurb, "kind" | "source" | "workId">): string {
  if (blurb.kind === "registry-reconstruction") return "From OpenAlex's copy of the abstract";
  return `From the abstract · ${blurbHolder(blurb)}`;
}

/** A dated snapshot: the day the abstract was read, never "current". */
export function blurbDay(readAt: string): string {
  const at = new Date(readAt);
  return Number.isNaN(at.getTime())
    ? "an unknown day"
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * **The card's first paragraph: what the note is and is not.** Which catalogue,
 * which day, and that it can be wrong. The quotes code checked it against
 * follow it on the card (`BLURB_QUOTES_LEAD`).
 */
export function blurbCardNote(blurb: Pick<CitedWorkBlurb, "kind" | "source" | "workId" | "readAt">): string {
  const copy =
    blurb.kind === "registry-reconstruction"
      ? "OpenAlex's copy of this work's abstract, which OpenAlex pieces together from the abstract's words, so it can differ a little from the author's text"
      : `this work's abstract, as ${blurbHolder(blurb)} holds it`;
  return (
    `A short note an AI wrote from ${copy}, read on ${blurbDay(blurb.readAt)}. ` +
    "It is a quick look-up in a public catalogue of papers, not a web search and not a reading of the paper itself, so it can be wrong."
  );
}

/** Before the quotes on the card. One quote a sentence: the note's words rest on these. */
export function blurbQuotesLead(sentences: number): string {
  return sentences === 1
    ? "Code checked that it rests on these words of the abstract:"
    : "Code checked that each sentence rests on words of the abstract:";
}

/** Added to the card when Crossref or OpenAlex found the work by its title, not by an identifier the article gave. */
export const BLURB_FOUND_BY_TITLE =
  "We found this work's record by its title and first author, so it is very likely, but not certainly, this work.";

/** The owner's card ends with the way to look closer. */
export const BLURB_ASK_IN_CHAT = "To look closer, ask in chat.";

/**
 * **The band's (i), once a row on screen has a note** — replacing
 * `CITE_LIST_NOT_READ` (src/web/BibliographyPanel.tsx). What we have read is
 * still none of the works themselves; a note is the AI's, from the abstract
 * alone; and a row without one says nothing about the work.
 */
export const CITE_LIST_READ_ABSTRACTS =
  "Unless a row says otherwise, we have read none of these works themselves. " +
  "A note under a work was written by an AI from that work's abstract alone, as a public catalogue of papers holds it. " +
  "A work with no note had no abstract we could be sure was its own, or its note did not pass our checks.";

/* ------------------------------------------------- a web note (261018o) --
   The owner's *Open in Sources* on a row with no note: one web search for the
   work's own page (src/citation-web-note.ts). The same component draws it
   (`CiteBlurb`), so the words for what it is are here beside the abstract
   note's, and say what it is **not** just as plainly. */

/**
 * The row's quiet label: *From a web search · arxiv.org*, and for a page that
 * only looks like the work's own (plan 261025d) *… · may not be the work's
 * own page*.
 */
export function webNoteBasis(note: Pick<CitedWorkWebNote, "host" | "pageKind">): string {
  return note.pageKind === "own" ? `From a web search · ${note.host}` : `From a web search · ${note.host} · may not be the work's own page`;
}

/**
 * The card's first paragraph: one search, whose page, which day, and that it
 * can be wrong. For a `looks-like` page it says exactly what code checked —
 * the result's title is the work's and its title or extract names the
 * work's first author — and not more (GPT Sol's plan review #6).
 */
export function webNoteCardNote(note: Pick<CitedWorkWebNote, "host" | "readAt" | "pageKind">): string {
  if (note.pageKind === "own") {
    return (
      `A short note an AI wrote from one web search for this work: the search engine's extract of its own page at ${note.host}, ` +
      `read on ${blurbDay(note.readAt)}. It is not a reading of the paper, and a web page can say more or less than the paper, ` +
      "so it can be wrong."
    );
  }
  return (
    `A short note an AI wrote from one web search for this work: the search engine's extract of a page at ${note.host} ` +
    "whose title matches this work's and which names its first author. It looks like the work's own page, but it may be " +
    "someone else's description of it, such as a catalogue entry, a publisher's blurb or a review. " +
    `Read on ${blurbDay(note.readAt)}. It is not a reading of the work, and it can be wrong.`
  );
}

/** Before the quotes on a web note's card. */
export function webNoteQuotesLead(sentences: number): string {
  return sentences === 1
    ? "Code checked that it rests on these words of the page:"
    : "Code checked that each sentence rests on words of the page:";
}

/** The row while the search runs. */
export const WEB_NOTE_SEARCHING = "Looking for this work's page on the web…";
/** The row while the note is checked against the page, before it is shown. */
export const WEB_NOTE_CHECKING = "Checking the note against the page…";
/** The row once a search found no page code could be sure is the work's own. */
export const WEB_NOTE_NONE = "We searched the web for this work's page and found none we could use.";
/** Added to the band's (i) when a row on screen has a web note. */
export const CITE_LIST_WEB_NOTES =
  "A note labelled “From a web search” was written instead from a search engine's extract of a web page that is, or looks like, the work's own.";
