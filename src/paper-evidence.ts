/**
 * **A cited paper as evidence we can vouch for — or the stated reason there is
 * none.** Plan 261001a stage 2
 * (docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md).
 *
 *   readPaperEvidence({ work, matchedPageUrl }, { lookup })
 *     → { state: "read", chunks, selected: ["c1", "c2", "c7", …], matchedBy: "doi", … }
 *     | { state: "not-confirmed", why: "title-not-found", … }   and four more
 *
 * Pure in the sense that matters here: no route, no prompt, no database. It
 * fetches (through `readPaperText`, so through `fetchDocument`'s guard) and asks
 * an injected registry lookup, and everything else is code deciding.
 *
 * ## What it does, in order
 *
 * 1. **Which address** (`paperAddress`): the row's own DOI (→ `doi.org`, which
 *    lands on the publisher, whose `citation_pdf_url` is followed once) or arXiv
 *    id (→ `arxiv.org/pdf/…`); else the page the quick check matched. Otherwise
 *    `no-address`.
 * 2. **The registry, when the row has an identifier**: a record whose title
 *    disagrees with the citation's is an `identity-conflict` — a DOI the
 *    article typed wrongly resolves perfectly to the wrong paper, so it is
 *    refused before anything is fetched (Sol P-2). Not found or unavailable
 *    changes nothing.
 * 3. **Only a PDF's text layer counts** (Sol P-3): `readPaperText` with
 *    `pdfOnly`, under its own 25-second deadline, which since this plan reaches
 *    the parse itself. An HTML page with no PDF is `not-the-full-text`.
 * 4. **One canonical text** (Sol P-9, `canonicalPaper`): NFKC, whitespace
 *    normalised, a word broken across a line *or a page* mended by
 *    src/pdf.ts's own rule (`joinHyphenated`), and cut at a standalone
 *    *References* heading. That one string is chunked, hashed, sent and
 *    searched — there is no second spelling of the paper anywhere.
 * 5. **Is it the work?** (`confirmIdentity`) Code decides; any disagreement
 *    refuses. The title is corroborated always; then an identifier agreeing or
 *    the first author's surname; a different identifier on the document is a
 *    refusal whatever the title says.
 * 6. **Chunks** of ~250 words, and a deterministic selection within ~5,000
 *    words: the first two, then the rest by plain term overlap with `why` and
 *    the citing passages.
 *
 * `verifyPassage` is the other half (Sol P-1): a quote is the paper's only if
 * it is found, by the strict pass, in the one sent chunk it names — and what
 * comes back is the chunk's own characters, never the model's spelling.
 *
 * ## What is logged
 *
 * State, host, words, milliseconds and how the identity was matched — never
 * the URL, the title or a word of the text. docs/project/logging.md.
 */
import { createHash } from "node:crypto";

import { parseWorkId, type WorkId, type WorkRecord } from "./bibliographic.js";
import { MIN_QUOTE_WORDS, surnameOf, titleNamesWork, tokens } from "./citation-lookup.js";
import type { InvestigateContext } from "./citation-investigate-context.js";
import { identityOf } from "./cited-in-spideryarn.js";
import { log, since } from "./log.js";
import {
  arxivPdfUrl,
  type PaperMeta,
  type PaperPage,
  type PaperUnreadableReason,
  type ReadPaperOptions,
  readPaperText,
} from "./paper-text.js";
import { joinHyphenated } from "./pdf.js";
import { findQuote } from "./quote-match.js";
import { hostOf } from "./urls.js";

/** **Bump when any rule below changes which chunks are sent** — the chunk size, the budget, the scoring, the cut. */
export const PAPER_SELECTION_VERSION = "paper-selection/1";

/** The paper read's own deadline: both fetches and the parse. */
export const PAPER_READ_MS = 25_000;
/** Words per chunk; the last chunk takes a short remainder rather than standing alone. */
export const CHUNK_WORDS = 250;
/** A remainder shorter than this joins the chunk before it. */
const MIN_TAIL_WORDS = 60;
/** The most words sent to the model, the first two chunks included. */
export const SENT_WORDS_BUDGET = 5_000;
/** How much of page one's text is searched for the first author's surname. */
export const IDENTITY_WINDOW_CHARS = 2_000;
/**
 * The general floor for a *References* heading. Before this, a contents-page
 * entry or a heading pdf.js read out of order must not cut the paper; the
 * narrower short-paper rule below admits a final/later-page heading after 100.
 */
const MIN_WORDS_BEFORE_REFERENCES = 300;
/** A short paper may reach its final-page bibliography before the general floor. */
const MIN_SHORT_PAPER_WORDS_BEFORE_REFERENCES = 100;

/* -------------------------------------------------------- the registry -- */

/** The identifier a registry is asked about: stage 1's shape (`doi:10.1038/nn.4304`, `arxiv:1706.03762`). */
export type WorkIdentifier = WorkId;

/** What a registry holds about a work — the part of stage 1's record this module reads. */
export type RegistryRecord = Pick<WorkRecord, "title" | "authors" | "year">;

export type RegistryLookup =
  | { kind: "found"; record: RegistryRecord }
  | { kind: "not-found" }
  | { kind: "unavailable"; why: string };

/** Stage 1's `lookupWork`, injected so this module and its tests need no database. */
export type LookupWork = (id: WorkIdentifier) => Promise<RegistryLookup>;

/** What the registry said about the row's identifier, carried on a `read` for the record. */
export type RegistryAgreement = "agrees" | "not-found" | "unavailable" | "not-asked";

/* ---------------------------------------------------------- the result -- */

export interface PaperChunk {
  /** `c1`, `c2`, … in document order. */
  id: string;
  /** The page the chunk starts on, 1-based. */
  page: number;
  /** Offsets into the canonical text; `end` exclusive. `text` is exactly that slice. */
  start: number;
  end: number;
  words: number;
  text: string;
}

export type MatchedBy = "doi" | "arxiv" | "title-author";

/** Where the paper was looked for. */
export interface PaperAddress {
  url: string;
  from: "doi" | "arxiv" | "matched-page";
  /** The row's identifier — `null` for the matched page, which has none of the article's. */
  id: WorkIdentifier | null;
}

export type NotConfirmedWhy =
  /** The document names a different DOI or arXiv id from the row's. */
  | "different-identifier"
  /** The citation's title is not on the first page, nor in the page's `citation_title`. */
  | "title-not-found"
  /** The title is there, but neither an identifier nor the first author's surname backs it. */
  | "no-second-signal";

export interface PaperRead {
  state: "read";
  requestedUrl: string;
  /** After redirects — the PDF's own address. */
  finalUrl: string;
  host: string;
  addressFrom: PaperAddress["from"];
  pages: number;
  /** Words in the canonical text. */
  words: number;
  /** **The canonical text** — the only spelling of the paper; every chunk is a slice of it. */
  text: string;
  /** True when a *References* heading ended the text. */
  referencesCut: boolean;
  chunks: PaperChunk[];
  /** The chunk ids sent, in document order. */
  selected: string[];
  sentWords: number;
  /** `paperSentText` of the selection: what is sent, character for character. */
  sentText: string;
  /** sha256 of `sentText`, hex. */
  sentSha256: string;
  matchedBy: MatchedBy;
  registry: RegistryAgreement;
  selectionVersion: typeof PAPER_SELECTION_VERSION;
}

export type PaperEvidence =
  | PaperRead
  | { state: "no-address" }
  | { state: "unreadable"; requestedUrl: string; host: string; why: PaperUnreadableReason }
  | { state: "not-the-full-text"; requestedUrl: string; finalUrl: string; host: string }
  | { state: "not-confirmed"; requestedUrl: string; finalUrl: string; host: string; why: NotConfirmedWhy }
  | { state: "identity-conflict"; requestedUrl: string; host: string; id: WorkIdentifier; registryTitle: string };

export type PaperEvidenceState = PaperEvidence["state"];

/* --------------------------------------------------------- the address -- */

/**
 * **Which address to read**, the first that exists: the row's DOI, the row's
 * arXiv id, the page the quick check matched (it passed code's identity rule
 * there). `null` is `no-address`.
 */
export function paperAddress(workUrl: string, matchedPageUrl?: string | null): PaperAddress | null {
  const id = identityOf(workUrl);
  /* `identityOf`'s DOI has no `?`, `#` or whitespace, so it is already a path. */
  if (id.doi) {
    const workId = parseWorkId(`doi:${id.doi}`);
    if (workId) return { url: `https://doi.org/${id.doi}`, from: "doi", id: workId };
  }
  if (id.arxiv) {
    /* `arxivPdfUrl` keeps a version the article cited (`v1`); `identityOf` does not. */
    const url = arxivPdfUrl(workUrl) ?? (/\/pdf\//.test(workUrl) ? workUrl : `https://arxiv.org/pdf/${id.arxiv}`);
    const workId = parseWorkId(`arxiv:${id.arxiv}`);
    if (workId) return { url, from: "arxiv", id: workId };
  }
  if (matchedPageUrl) return { url: matchedPageUrl, from: "matched-page", id: null };
  return null;
}

/* ------------------------------------------------------ canonical text -- */

/**
 * A heading that ends the paper's own text: short, a line of its own,
 * optionally numbered (`7 References`, `VII. REFERENCES`, `References:`).
 */
const REFERENCES_HEADING =
  /^(?:(?:\d{1,2}|[ivxlc]{1,6}|[a-z])[.)]?\s+)?(?:references(?: and notes)?|bibliography|literature cited|works cited|reference list)\s*:?$/i;

export function isReferencesHeading(line: string): boolean {
  return line.length <= 40 && REFERENCES_HEADING.test(line.trim());
}

export interface CanonicalPaper {
  /** NFKC, whitespace collapsed, hyphens mended, cut at the references. Lines joined by a space, pages by a newline. */
  text: string;
  /** Where each page's text begins in `text`, ascending — for the page a chunk starts on. */
  pageStarts: { offset: number; page: number }[];
  referencesCut: boolean;
}

/**
 * **The one string the paper is**, from `readPaperText`'s pages and lines.
 *
 * NFKC first, so `ﬁ` is `fi` before anything is compared; then whitespace;
 * then the cut, on lines, because a heading is only a heading while it is a
 * line of its own; then the hyphen repair across every line in order — which
 * is how a word broken at the foot of one page and finished at the top of the
 * next is mended, where src/pdf.ts's `baselineFor`, working a page at a time,
 * cannot see both halves. Curly quotes are left as printed: `findQuote` folds
 * them, and the text stays the paper's.
 */
export function canonicalPaper(pages: readonly PaperPage[]): CanonicalPaper {
  const lines: { text: string; page: number }[] = [];
  for (const p of pages) {
    for (const raw of p.lines) {
      const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (text) lines.push({ text, page: p.page });
    }
  }

  let referencesCut = false;
  let wordsSoFar = 0;
  const firstPage = lines[0]?.page;
  const lastPage = lines.at(-1)?.page;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const enoughForShortPaper =
      wordsSoFar >= MIN_SHORT_PAPER_WORDS_BEFORE_REFERENCES &&
      (line.page !== firstPage || line.page === lastPage);
    if ((wordsSoFar >= MIN_WORDS_BEFORE_REFERENCES || enoughForShortPaper) && isReferencesHeading(line.text)) {
      lines.length = i;
      referencesCut = true;
      break;
    }
    wordsSoFar += line.text.split(" ").length;
  }

  const mended: { text: string; page: number }[] = [];
  for (const line of lines) {
    const previous = mended.at(-1);
    const joined = previous ? joinHyphenated(previous.text, line.text) : null;
    if (previous && joined !== null) previous.text = joined;
    else mended.push({ ...line });
  }

  let text = "";
  const pageStarts: CanonicalPaper["pageStarts"] = [];
  for (const line of mended) {
    const last = pageStarts.at(-1);
    if (text !== "") text += last?.page === line.page ? " " : "\n";
    if (last?.page !== line.page) pageStarts.push({ offset: text.length, page: line.page });
    text += line.text;
  }
  return { text, pageStarts, referencesCut };
}

function pageAt(pageStarts: CanonicalPaper["pageStarts"], offset: number): number {
  let page = pageStarts[0]?.page ?? 1;
  for (const start of pageStarts) {
    if (start.offset > offset) break;
    page = start.page;
  }
  return page;
}

/* -------------------------------------------------------------- chunks -- */

/** ~`CHUNK_WORDS` words each, `c1…`, each an exact slice of the canonical text. */
export function chunkPaper(canonical: CanonicalPaper): PaperChunk[] {
  const words = [...canonical.text.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const groups: { from: number; to: number }[] = [];
  for (let from = 0; from < words.length; from += CHUNK_WORDS) {
    groups.push({ from, to: Math.min(from + CHUNK_WORDS, words.length) });
  }
  const tail = groups.at(-1);
  if (groups.length > 1 && tail && tail.to - tail.from < MIN_TAIL_WORDS) {
    groups.pop();
    groups[groups.length - 1]!.to = tail.to;
  }
  return groups.map((g, i) => {
    const start = words[g.from]!.start;
    const end = words[g.to - 1]!.end;
    return {
      id: `c${i + 1}`,
      page: pageAt(canonical.pageStarts, start),
      start,
      end,
      words: g.to - g.from,
      text: canonical.text.slice(start, end),
    };
  });
}

/** Words too common to say what a passage is about. Small on purpose: this is term overlap, not retrieval. */
const STOP_WORDS = new Set(
  (
    "the and for are but not you all any can had her was one our out has him his how its may new now old see " +
    "two way who did get let say she too use that with have this will your from they know want been good much " +
    "some time very when come here just like long make many more only over such take than them well were what " +
    "which their there these those would could should about after again being below between both during each " +
    "into most other same then through under until while where because does also paper study work article " +
    "author authors cited cites cite shows show argues argue using used uses"
  ).split(" "),
);

function terms(text: string): Set<string> {
  return new Set(tokens(text).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
}

/**
 * **Which chunks are sent**: the first two (the title and the abstract), then
 * the rest by how many of the query's terms each contains — `why` and the
 * citing passages, stop-words dropped — ties to the earlier chunk, while the
 * total stays within `SENT_WORDS_BUDGET`. Returned in document order.
 * Deterministic: the same chunks and query give the same ids.
 */
export function selectChunks(
  chunks: readonly PaperChunk[],
  query: { why: string; passages: readonly string[] },
): string[] {
  const want = terms([query.why, ...query.passages].join(" "));
  const chosen = new Set<number>();
  let sent = 0;
  const take = (i: number) => {
    const chunk = chunks[i]!;
    if (sent + chunk.words > SENT_WORDS_BUDGET) return;
    chosen.add(i);
    sent += chunk.words;
  };
  for (let i = 0; i < Math.min(2, chunks.length); i++) take(i);
  const ranked = chunks
    .map((chunk, i) => {
      const have = terms(chunk.text);
      let score = 0;
      for (const t of want) if (have.has(t)) score++;
      return { i, score };
    })
    .filter(({ i }) => !chosen.has(i))
    .sort((a, b) => b.score - a.score || a.i - b.i);
  for (const { i } of ranked) take(i);
  return [...chosen].sort((a, b) => a - b).map((i) => chunks[i]!.id);
}

/**
 * **What is sent, character for character**: each selected chunk under a line
 * naming it and its page, blank-line separated. The model is to name a chunk
 * with each passage it offers, and `verifyPassage` holds it to that one chunk.
 */
export function paperSentText(chunks: readonly PaperChunk[], selected: readonly string[]): string {
  const ids = new Set(selected);
  return chunks
    .filter((c) => ids.has(c.id))
    .map((c) => `[${c.id}, page ${c.page}]\n${c.text}`)
    .join("\n\n");
}

/* ------------------------------------------------------------ identity -- */

function isPrefix(have: readonly string[], want: readonly string[]): boolean {
  return want.length > 0 && want.length <= have.length && want.every((w, i) => have[i] === w);
}

/**
 * **Does a registry's title agree with the citation's?** Deliberately lenient,
 * because a disagreement refuses the paper: one title a prefix of the other (a
 * subtitle one side drops), or most of the citation's significant words in the
 * registry's. A mistyped DOI lands on an unrelated paper, which shares neither.
 */
export function registryTitleAgrees(registryTitle: string, citationTitle: string): boolean {
  const reg = tokens(registryTitle.replace(/<[^>]*>/g, " "));
  const cit = tokens(citationTitle);
  if (reg.length === 0 || cit.length === 0) return false;
  if (isPrefix(reg, cit) || isPrefix(cit, reg)) return true;
  const want = [...terms(citationTitle)];
  if (want.length === 0) return false;
  const have = new Set(reg);
  return want.filter((w) => have.has(w)).length / want.length >= 0.8;
}

/** arXiv's own DOI (`10.48550/arxiv.1706.03762`) is an arXiv id by another name. */
function arxivOfDoi(doi: string): string | null {
  return /^10\.48550\/arxiv\.(.+)$/i.exec(doi)?.[1]?.toLowerCase() ?? null;
}

const bareArxiv = (id: string) => id.toLowerCase().replace(/v\d+$/, "");

export interface IdentityInput {
  /** The citation's title and authors, as the article gives them. */
  title: string;
  authors: string | null;
  /** The row's identifier, when it has one. */
  id: WorkIdentifier | null;
  /** The PDF's first-page lines, preserving the boundary that distinguishes its title from prose about another work. */
  firstPageLines: readonly string[];
  /** Where the PDF came from, after redirects. */
  finalUrl: string;
  /** The landing page's meta tags, when there was a landing page. */
  meta?: PaperMeta;
  /** A found registry record, which agreed with the citation's title — its first author stands in for a missing one. */
  registry?: RegistryRecord;
}

/**
 * The cited title as a heading-shaped run near the top of page one.
 *
 * Searching two thousand free-running characters let a wrong paper confirm a
 * mistyped DOI merely by citing the target in its abstract. A PDF title can span
 * lines, so compare each of the first eight possible starts and up to six joined
 * lines, but require the joined run to be exactly the title's tokens. A landing
 * page's `citation_title` is the other, stronger route below.
 */
function titleInFirstPageHeading(lines: readonly string[], title: string): boolean {
  const want = tokens(title);
  if (want.length === 0) return false;
  const starts = Math.min(lines.length, 8);
  for (let from = 0; from < starts; from++) {
    let candidate = "";
    for (let to = from; to < Math.min(lines.length, from + 6); to++) {
      candidate += `${candidate ? " " : ""}${lines[to] ?? ""}`;
      const have = tokens(candidate);
      if (have.length > want.length) break;
      if (have.length === want.length && have.every((word, i) => word === want[i])) return true;
    }
  }
  return false;
}

/**
 * **Is this document the cited work?** The plan's four rules, in the order
 * that makes the rest meaningless:
 *
 * 1. a different identifier on the document — the landing page's DOI, or the
 *    arXiv id of the final address — refuses, whatever the title says;
 * 2. the citation's title must be a heading-shaped run near the top of the
 *    first page, or be the landing page's `citation_title` — not merely occur
 *    in prose where a different paper cites it;
 * 3. and then an identifier agreeing, or
 * 4. the first author's surname in the same window.
 *
 * `resultIsTheWork` is never called here: given a synthesised DOI URL its
 * identifier branch would skip the title altogether (Sol P-2).
 */
export function confirmIdentity(input: IdentityInput): { ok: true; matchedBy: MatchedBy } | { ok: false; why: NotConfirmedWhy } {
  const rowDoi = input.id?.startsWith("doi:") ? input.id.slice(4) : null;
  const rowArxiv = input.id?.startsWith("arxiv:")
    ? bareArxiv(input.id.slice(6))
    : rowDoi
      ? arxivOfDoi(rowDoi)
      : null;
  const docDoi = input.meta?.doi ?? null;
  const finalArxiv = identityOf(input.finalUrl).arxiv;
  const docArxiv = finalArxiv ? bareArxiv(finalArxiv) : docDoi ? arxivOfDoi(docDoi) : null;

  if (rowDoi && docDoi && docDoi !== rowDoi && !(rowArxiv && docArxiv === rowArxiv)) {
    return { ok: false, why: "different-identifier" };
  }
  if (rowArxiv && docDoi && docArxiv === null) return { ok: false, why: "different-identifier" };
  if (rowArxiv && docArxiv && docArxiv !== rowArxiv) return { ok: false, why: "different-identifier" };

  /* Keep this window physically inside page one. The first 2,000 characters
     of the whole document can reach page two when the title page is sparse. */
  const window = tokens(input.firstPageLines.join(" ").slice(0, IDENTITY_WINDOW_CHARS));
  const titleOnPage = titleInFirstPageHeading(input.firstPageLines, input.title);
  const titleInMeta = titleNamesWork(input.meta?.title, input.title) === "whole";
  const surname =
    surnameOf(input.authors) ??
    (input.registry?.authors[0] ? surnameOf(input.registry.authors[0].family) : null);
  const authorOnPage = surname !== null && window.includes(surname);
  /* Landing-page metadata identifies the page, not necessarily the PDF it
     linked. If the PDF itself does not carry the title as a heading, tie it to
     the work with the first author before trusting the page's title. */
  if (!titleOnPage && !(titleInMeta && authorOnPage)) return { ok: false, why: "title-not-found" };

  if (rowDoi && docDoi === rowDoi) return { ok: true, matchedBy: "doi" };
  if (rowArxiv && docArxiv === rowArxiv) return { ok: true, matchedBy: "arxiv" };

  if (authorOnPage) return { ok: true, matchedBy: "title-author" };
  return { ok: false, why: "no-second-signal" };
}

/* ---------------------------------------------------------- the reading -- */

export interface PaperEvidenceInput {
  /** The work as *Investigate* describes it — its title, authors, link, `why` and citing passages. */
  work: Pick<InvestigateContext, "title" | "authors" | "url" | "why" | "passages">;
  /** The page the quick check matched, when it matched one. */
  matchedPageUrl?: string | null;
}

export interface PaperEvidenceDeps {
  /** Stage 1's registry lookup; `null` to read without one. */
  lookup: LookupWork | null;
  /** The caller's cancellation, joined to the read's own deadline. */
  signal?: AbortSignal;
  /** Test seams for `readPaperText`. */
  fetch?: ReadPaperOptions["fetch"];
  /** Defaults to `PAPER_READ_MS`. */
  timeoutMs?: number;
}

function logged(result: PaperEvidence, started: number): PaperEvidence {
  log("model").info(
    {
      state: result.state,
      ...("host" in result ? { host: result.host } : {}),
      ...(result.state === "read" ? { words: result.words, sentWords: result.sentWords, matchedBy: result.matchedBy } : {}),
      ...(result.state === "unreadable" || result.state === "not-confirmed" ? { why: result.why } : {}),
      ms: since(started),
    },
    `paper evidence: ${result.state}`,
  );
  return result;
}

async function askRegistry(lookup: LookupWork | null, id: WorkIdentifier | null): Promise<RegistryLookup | null> {
  if (!lookup || !id) return null;
  try {
    return await lookup(id);
  } catch (err) {
    /* The registry is corroboration, not a gate: its failure is "unavailable". */
    log("model").warn({ err: err instanceof Error ? err.name : "unknown" }, "paper evidence: registry lookup threw");
    return { kind: "unavailable", why: "threw" };
  }
}

/**
 * **Read the cited paper, or say why not.** Never throws for anything the far
 * end did; a fault of ours (a bug, pdf.js failing for a reason that is not the
 * file) propagates.
 */
export async function readPaperEvidence(
  input: PaperEvidenceInput,
  deps: PaperEvidenceDeps,
): Promise<PaperEvidence> {
  const started = Date.now();
  const { work } = input;
  const address = paperAddress(work.url, input.matchedPageUrl);
  if (!address) return logged({ state: "no-address" }, started);
  const requestedUrl = address.url;

  const registry = await askRegistry(deps.lookup, address.id);
  if (registry?.kind === "found" && address.id && !registryTitleAgrees(registry.record.title, work.title)) {
    return logged(
      {
        state: "identity-conflict",
        requestedUrl,
        host: hostOf(requestedUrl),
        id: address.id,
        registryTitle: registry.record.title,
      },
      started,
    );
  }

  const paper = await readPaperText(requestedUrl, {
    pdfOnly: true,
    timeoutMs: deps.timeoutMs ?? PAPER_READ_MS,
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
  if (paper.kind === "unreadable") {
    return logged({ state: "unreadable", requestedUrl, host: paper.host, why: paper.why }, started);
  }
  if (paper.kind === "not-pdf" || paper.format !== "pdf" || !paper.pages) {
    return logged({ state: "not-the-full-text", requestedUrl, finalUrl: paper.url, host: paper.host }, started);
  }

  const canonical = canonicalPaper(paper.pages);
  const identity = confirmIdentity({
    title: work.title,
    authors: work.authors,
    id: address.id,
    firstPageLines: paper.pages[0]?.lines ?? [],
    finalUrl: paper.url,
    ...(paper.meta ? { meta: paper.meta } : {}),
    ...(registry?.kind === "found" ? { registry: registry.record } : {}),
  });
  if (!identity.ok) {
    return logged(
      { state: "not-confirmed", requestedUrl, finalUrl: paper.url, host: paper.host, why: identity.why },
      started,
    );
  }

  const chunks = chunkPaper(canonical);
  const selected = selectChunks(chunks, { why: work.why, passages: work.passages });
  const sentText = paperSentText(chunks, selected);
  const chosen = new Set(selected);
  return logged(
    {
      state: "read",
      requestedUrl,
      finalUrl: paper.url,
      host: paper.host,
      addressFrom: address.from,
      pages: paper.pages.length,
      words: chunks.reduce((n, c) => n + c.words, 0),
      text: canonical.text,
      referencesCut: canonical.referencesCut,
      chunks,
      selected,
      sentWords: chunks.filter((c) => chosen.has(c.id)).reduce((n, c) => n + c.words, 0),
      sentText,
      sentSha256: createHash("sha256").update(sentText, "utf8").digest("hex"),
      matchedBy: identity.matchedBy,
      registry: registry === null ? "not-asked" : registry.kind === "found" ? "agrees" : registry.kind,
      selectionVersion: PAPER_SELECTION_VERSION,
    },
    started,
  );
}

/* ------------------------------------------------------------ passages -- */

export interface VerifiedPassage {
  chunk: string;
  page: number;
  /** The chunk's own characters — never the model's spelling. */
  text: string;
  /** Offsets into the canonical text. */
  start: number;
  end: number;
}

/**
 * **A quote the model says came from chunk `chunk`, checked there and only
 * there** (Sol P-1). The strict `"spaced"` pass of `findQuote` — the one for a
 * match read as a claim that the text was copied — inside that one chunk, and
 * only a chunk that was sent. At least `MIN_QUOTE_WORDS` words. `null` for
 * anything else: an unsent chunk, the wrong chunk, a paraphrase, a fragment.
 */
export function verifyPassage(evidence: PaperRead, claim: { chunk: string; quote: string }): VerifiedPassage | null {
  if (!evidence.selected.includes(claim.chunk)) return null;
  const chunk = evidence.chunks.find((c) => c.id === claim.chunk);
  if (!chunk) return null;
  const span = findQuote(chunk.text, claim.quote.normalize("NFKC"), undefined, "spaced");
  if (!span) return null;
  const raw = chunk.text.slice(span.start, span.end);
  const text = raw.trim();
  if (text.split(/\s+/).filter(Boolean).length < MIN_QUOTE_WORDS) return null;
  const lead = raw.length - raw.trimStart().length;
  const start = chunk.start + span.start + lead;
  return { chunk: chunk.id, page: chunk.page, text, start, end: start + text.length };
}
