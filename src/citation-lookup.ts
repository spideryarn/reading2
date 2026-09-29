/**
 * **What a lookup may say about a cited work, and what it may not** — the pure
 * rules behind Citations' *Look it up*. docs/plans/260929g-check-a-cited-paper-supports-the-claim.md
 * § The tweak / 2 and § After the second plan review (R-1…R-7).
 *
 * The one call in src/citation-find.ts runs a web search for the work, points
 * at a result, and — in the same answer — reads **that result's search
 * extract** (`SearchEvidence.excerpt`, the engine's own slice of the page, ≤
 * 8,000 characters) against what the article uses the work for. Everything
 * here is code, and every clause exists because the model's answer alone is
 * not evidence:
 *
 * - **A quote is shown only if it is in the extract** — `findQuote(excerpt, q,
 *   undefined, "spaced")`, the strict pass Quotes mode uses — and what is
 *   stored is the extract's own slice, never the model's spelling. At least
 *   six words, at most `QUOTE_CAP` characters.
 * - **`supports` or `partly` needs a verified quote**, or it becomes
 *   `not-in-extract`. There is no "does not support": an extract that does not
 *   show a thing says nothing about the full paper.
 * - **`paperDoes` goes only with its verified quote**, or it is dropped.
 * - **The result must be this work (R-1)**, more strictly than *Find it*'s
 *   link rule (`pageNamesTitle`): a row the article linked by arXiv id needs
 *   that id in the result's URL; one linked by DOI needs the DOI in the URL,
 *   or in the extract *and* a result title that names the work; any other row
 *   needs a title that names the work — its whole title, or a cut-short one
 *   covering enough of it (`titleNamesWork`) — plus the first author's surname
 *   or the year where the list has them.
 * - **A quote or `paperDoes` past its cap is dropped on its own**; only an
 *   unreadable verdict drops the whole reading (R-5).
 * - **No extract is its own state** (R-2), never `not-in-extract`.
 * - **A lookup is attached only to the list it was made against (R-4)**: the
 *   context fingerprint covers every capped string the model was sent, the
 *   identity rule that applied, the prompt version and the model, and is
 *   recomputed from the current list at read time.
 *
 * What this cannot establish, said plainly because the panel must say it too:
 * that the quote *means* what the model's verdict and sentence say, or that
 * the page is the paper rather than a page titled like it. The verdict and
 * `paperDoes` are the AI's reading of a search extract, and are labelled so.
 *
 * ## Security — carried from src/debate.ts, because it applies unchanged
 *
 * **Prompt injection from a searched page is a residual risk, not a mitigated
 * one.** The search runs inside the provider and the model reads the extract
 * during the call; our process first sees those characters in the response,
 * so there is no point at which we could fence them with `untrusted()`. What
 * bounds the consequence: the call has no write-capable tools, every quote is
 * re-checked here against the result's own extract, and an injected
 * instruction cannot manufacture a quote that is not in that extract. At worst
 * it influences the verdict and the sentence, and those are labelled as the
 * model's reading.
 *
 * **Imports nothing that calls a model or a database**, so src/store/pg.ts can
 * recompute the fingerprint at read time without pulling the call in.
 */
import { createHash } from "node:crypto";

import { firstAuthor } from "./citations.js";
import { findQuote } from "./quote-match.js";
import type {
  CitationLookup,
  CitationLookupState,
  CitationSupport,
  CitedWork,
  SearchEvidence,
} from "./types.js";

/**
 * **Bump when the lookup prompt (`LOOKUP_SYSTEM`, src/citation-find.ts), the
 * user turn, or any rule in this file changes what a lookup would say** — it is
 * inside the context fingerprint, so a bump detaches every stored lookup.
 */
export const CITATION_LOOKUP_VERSION = "citation-lookup/3";

/** R-7: the citing passage sent, in characters. */
export const PASSAGE_CAP = 1_200;
/** The reference entry sent, in characters — *Find it*'s cap, unchanged. */
export const REFERENCE_CAP = 500;
/** R-7: `paperDoes`, in characters. */
export const PROSE_CAP = 240;
/** R-7: each quote, in characters — the model's and the stored slice alike. */
export const QUOTE_CAP = 400;
/** A quote shorter than this is too little of the extract to show anything. */
export const MIN_QUOTE_WORDS = 6;

export const CITATION_SUPPORTS: readonly CitationSupport[] = ["supports", "partly", "not-in-extract"];

/* --------------------------------------------------------- the context -- */

/** The id the article linked a row by — the one a result must carry to be this work. */
export type LookupAnchor = { kind: "doi" | "arxiv"; id: string } | null;

/**
 * **Exactly what the lookup sends about the work and the article**, capped.
 * Built by one function for both the call and the read-time fingerprint, so
 * the two cannot drift.
 */
export interface LookupContext {
  title: string;
  authors: string | null;
  year: string | null;
  /** The bibliography entry as the article gives it, ≤ `REFERENCE_CAP`. */
  reference: string | null;
  /** What the article uses the work for — the row's `why`. */
  why: string;
  /** The first mention's block, else the first body block citing it, ≤ `PASSAGE_CAP`. */
  passage: string | null;
  anchor: LookupAnchor;
}

/** A row's identity anchor. `web` is a searched row we found a page for: no anchor. */
export function anchorOf(work: Pick<CitedWork, "url" | "linkFrom">): LookupAnchor {
  if (work.linkFrom === "doi" && work.url.startsWith("https://doi.org/")) {
    return { kind: "doi", id: work.url.slice("https://doi.org/".length) };
  }
  if (work.linkFrom === "arxiv" && work.url.startsWith("https://arxiv.org/abs/")) {
    return { kind: "arxiv", id: work.url.slice("https://arxiv.org/abs/".length) };
  }
  return null;
}

/**
 * The context for one row, from a block-text lookup — `article.blocks` at call
 * time, the revision's block texts at read time.
 */
export function lookupContext(
  work: Pick<CitedWork, "title" | "authors" | "year" | "why" | "reference" | "mentions" | "citedAt" | "url" | "linkFrom">,
  textOf: (blockId: string) => string | undefined,
): LookupContext {
  const reference = work.reference ? (textOf(work.reference.blockId) ?? null) : null;
  const passageBlock = work.mentions[0]?.blockId ?? work.citedAt[0];
  const passage = passageBlock ? (textOf(passageBlock) ?? null) : null;
  return {
    title: work.title,
    authors: work.authors ?? null,
    year: work.year ?? null,
    reference: reference ? reference.slice(0, REFERENCE_CAP) : null,
    why: work.why,
    passage: passage ? passage.slice(0, PASSAGE_CAP) : null,
    anchor: anchorOf(work),
  };
}

function hash16(parts: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex").slice(0, 16);
}

/**
 * **R-4's context fingerprint**: every string sent, the identity rule that
 * applied, the prompt version and the model asked for (not the one that
 * answered: the fingerprint is recomputed at read time, where only the
 * configured model is known).
 */
export function lookupContextHash(context: LookupContext, model: string): string {
  return hash16([
    CITATION_LOOKUP_VERSION,
    model,
    context.title,
    context.authors,
    context.year,
    context.reference,
    context.why,
    context.passage,
    context.anchor,
  ]);
}

/** R-4's evidence hash: what the result was. Provenance, never compared. */
export function lookupEvidenceHash(page: SearchEvidence): string {
  return hash16([page.url, page.title ?? null, page.excerpt ?? null]);
}

/* -------------------------------------------------------- the identity -- */

/** Every letter-and-digit run, lower-cased — stopwords kept, since "for" separates two titles. */
function tokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");
}

function containsRun(have: readonly string[], want: readonly string[]): boolean {
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((w, j) => have[i + j] === w)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decoded(url: string): string {
  try {
    return decodeURIComponent(url).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** The first author's surname: "Kaplan, J." and "Jared Kaplan" both give "kaplan". */
function surnameOf(authors: string | null): string | null {
  const words = tokens(firstAuthor(authors ?? undefined)).filter((w) => w.length > 1);
  return words[words.length - 1] ?? null;
}

/** A four-digit year in the list's `year`, or nothing. */
function yearOf(year: string | null): string | null {
  return year?.match(/\b(1[5-9]|20)\d{2}\b/)?.[0] ?? null;
}

/** A result title the search engine cut short, ending "..." or "…". */
const ELLIPSIS_END = /\s*(?:\.{3}|…)\s*$/u;
/** A cut title must still be this many tokens of the work's title… */
const MIN_TRUNCATED_TOKENS = 5;
/** …and at least this share of them. */
const MIN_TRUNCATED_SHARE = 0.5;

/**
 * **Does the result's title name the work?** The work's whole title as a
 * token run inside the result's. A title the engine cut short ("Conclusions
 * from the Functional Reconstruction of ...") cannot hold the whole title, so
 * one ending in an ellipsis passes instead when what is left is a run of the
 * work's title at least `MIN_TRUNCATED_TOKENS` long and at least half of it —
 * "Scaling laws for ..." names too many papers to count.
 */
function titleNamesWork(pageTitle: string | undefined, workTitle: string): boolean {
  if (!pageTitle) return false;
  const want = tokens(workTitle);
  if (containsRun(tokens(pageTitle), want)) return true;
  if (!ELLIPSIS_END.test(pageTitle)) return false;
  const kept = tokens(pageTitle.replace(ELLIPSIS_END, ""));
  return (
    kept.length >= MIN_TRUNCATED_TOKENS &&
    kept.length >= want.length * MIN_TRUNCATED_SHARE &&
    containsRun(want, kept)
  );
}

/**
 * **Is this result the work? (R-1)** Stricter than `pageNamesTitle`, which
 * stays *Find it*'s rule for choosing a link.
 */
export function resultIsTheWork(page: SearchEvidence, context: LookupContext): boolean {
  const anchor = context.anchor;
  if (anchor) {
    /* The same id, not merely a prefix of a longer one: 2001.08361 must not
       be found inside 2001.083612. */
    const id = anchor.kind === "arxiv" ? anchor.id.replace(/v\d+$/i, "") : anchor.id;
    const pattern =
      anchor.kind === "arxiv"
        ? new RegExp(`(?<![0-9])${escapeRegExp(id.toLowerCase())}(?![0-9])`)
        : new RegExp(`${escapeRegExp(id.toLowerCase())}(?![a-z0-9-])`);
    if (pattern.test(decoded(page.url))) return true;
    /* A publisher's own page is often named by a short id rather than the
       DOI (nature.com/articles/nature05357 for 10.1038/nature05357), and the
       DOI turns up in the extract instead. The DOI there alone is not enough —
       a citing paper's reference list carries it too — so the result's title
       must name the work as well. arXiv ids stay URL-only. */
    return (
      anchor.kind === "doi" &&
      pattern.test((page.excerpt ?? "").toLowerCase()) &&
      titleNamesWork(page.title, context.title)
    );
  }

  if (!titleNamesWork(page.title, context.title)) return false;
  const surname = surnameOf(context.authors);
  const year = yearOf(context.year);
  if (!surname && !year) return true;
  const seen = new Set(tokens(`${page.title} ${page.excerpt ?? ""}`));
  return (surname !== null && seen.has(surname)) || (year !== null && seen.has(year));
}

/* ------------------------------------------------------- the judgement -- */

/** The judgement half of the answer, parsed strictly (R-5) — the model's, not yet checked. */
export interface Judgement {
  support: CitationSupport;
  supportQuote: string | null;
  paperDoes: string | null;
  paperDoesQuote: string | null;
}

/** A non-empty string within `cap`, else `null` — absent, the wrong type and over-cap alike. */
function boundedOrNull(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.length <= cap ? trimmed : null;
}

/**
 * **The judgement fields of a parsed answer, or `null` when the verdict is
 * unreadable** — no `support`, or a verdict outside the enum by even a letter.
 * A quote or `paperDoes` of the wrong type or past its cap becomes `null` on
 * its own (the eval saw a 417-character quote sink a sound reading), and
 * `judgeLookup`'s downgrades do the rest: `supports`/`partly` without a
 * verified quote is `not-in-extract`, `paperDoes` without its quote is dropped.
 * Nothing unchecked reaches the reader either way. The URL pick is
 * `readFind`'s and stands on its own.
 */
export function parseJudgement(answer: unknown): Judgement | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const a = answer as Record<string, unknown>;
  const support = a.support;
  if (typeof support !== "string" || !(CITATION_SUPPORTS as readonly string[]).includes(support)) return null;
  return {
    support: support as CitationSupport,
    supportQuote: boundedOrNull(a.supportQuote, QUOTE_CAP),
    paperDoes: boundedOrNull(a.paperDoes, PROSE_CAP),
    paperDoesQuote: boundedOrNull(a.paperDoesQuote, QUOTE_CAP),
  };
}

/**
 * **The extract's own words for a model's quote, or `null`.** The strict pass
 * only — a quote read as a claim that the model copied the text — and the
 * slice is what is kept, never the model's typing.
 */
export function verifyQuote(excerpt: string, quote: string | null): string | null {
  if (!quote) return null;
  const span = findQuote(excerpt, quote, undefined, "spaced");
  if (!span) return null;
  const slice = excerpt.slice(span.start, span.end).trim();
  if (slice.length > QUOTE_CAP) return null;
  if (slice.split(/\s+/).filter((w) => w !== "").length < MIN_QUOTE_WORDS) return null;
  return slice;
}

/** Words in the extract, for the row's *about N words* line. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => w !== "").length;
}

/** The lookup's content — everything but the provenance the caller stamps on. */
export type LookupReading =
  | { state: Exclude<CitationLookupState, "assessed"> }
  | Pick<Extract<CitationLookup, { state: "assessed" }>, "state" | "excerptWords" | "verdict" | "paperDoes">;

/** What `judgeLookup` did with the model's quotes — counts for the log line. */
export interface QuoteCounts {
  offered: number;
  kept: number;
}

/**
 * **Everything a lookup may show, decided in one place.** The order is the
 * order of what could make the rest meaningless: nothing to read, then not
 * this work, then an answer we cannot read, then the checked reading.
 *
 * *No extract* comes first because it is the plainer truth — the search gave
 * us no text of the page — and because without one the identity rule has only
 * the result's title to go on, where an arXiv page names neither author nor
 * year: the paper's own page would read as *not this work*. Neither state
 * shows anything from the page.
 */
export function judgeLookup(
  answer: unknown,
  page: SearchEvidence,
  context: LookupContext,
): { reading: LookupReading; quotes: QuoteCounts } {
  const none = { offered: 0, kept: 0 };
  const excerpt = page.excerpt ?? "";
  if (excerpt.trim() === "") return { reading: { state: "no-extract" }, quotes: none };
  if (!resultIsTheWork(page, context)) return { reading: { state: "not-identified" }, quotes: none };
  const judgement = parseJudgement(answer);
  if (!judgement) return { reading: { state: "unreadable" }, quotes: none };

  const offered = (judgement.supportQuote ? 1 : 0) + (judgement.paperDoesQuote ? 1 : 0);
  const supportQuote =
    judgement.support === "not-in-extract" ? null : verifyQuote(excerpt, judgement.supportQuote);
  const paperDoesQuote = judgement.paperDoes ? verifyQuote(excerpt, judgement.paperDoesQuote) : null;

  const verdict: Extract<CitationLookup, { state: "assessed" }>["verdict"] =
    judgement.support !== "not-in-extract" && supportQuote
      ? { support: judgement.support, quote: supportQuote }
      : { support: "not-in-extract" };
  const paperDoes =
    judgement.paperDoes && paperDoesQuote ? { says: judgement.paperDoes, quote: paperDoesQuote } : undefined;

  return {
    reading: {
      state: "assessed",
      excerptWords: wordCount(excerpt),
      verdict,
      ...(paperDoes ? { paperDoes } : {}),
    },
    quotes: { offered, kept: (verdict.support !== "not-in-extract" ? 1 : 0) + (paperDoes ? 1 : 0) },
  };
}
