/**
 * Pipeline stage — the **citations**: every work the piece cites, where it
 * cites it, and a link out. docs/plans/260911g-citations-mode.md is the design
 * and GPT Sol's review of it; this file is stage 1 of that plan.
 *
 * **There is no command line here.** Re-running it against one article is a
 * job: `POST /api/jobs { slug, steps: ["citations"], force: ["citations"] }`.
 *
 * ## The split: what the model says, and what code decides
 *
 * The model sees `articleWithIds` — block ids and **plain text**. It cannot see
 * an href, a `noteId`, or which paragraph a footnote hangs off. So it is asked
 * only for what it can see — a title, authors, a year, one sentence on what
 * the piece uses the work for, two scores, and `{block, quote}` places — and
 * code does the rest:
 *
 * 1. **Every place is verified** (`verifyPlace`): the block must exist and the
 *    quote must be found in its text by `findQuote`'s whitespace-preserving
 *    pass. What is stored is the article's characters, not the model's typing.
 * 2. **Footnotes are expanded** (`noteMarkers`): a place inside a note block
 *    counts as cited at every body block carrying a `data-spya-note-ref` marker
 *    for that note. That is where Wikipedia's and gwern's citations live.
 * 3. **The link is derived** (`linkFor`), in the plan's order — a unique DOI,
 *    a unique arXiv id, a unique title-matching anchor in the reference, a
 *    unique anchor that is the mention's own words — and otherwise a Scholar
 *    search, labelled as one. **The model never writes a URL that is stored**:
 *    a remembered DOI looks exactly as right as a real one.
 * 4. **Ids are minted here** and inherited across re-runs by `key` (`keysOf`).
 *
 * ## Replace, not append
 *
 * A re-run replaces the list, like `ideas` and `timeline`. What survives is the
 * id of every work whose key comes back — which is what stage 3's stored
 * lookups are keyed on. Unlike those two, **the id is inherited even when the
 * article has moved** (`sourceHash` differs): a DOI names the same paper
 * whatever happened to the paragraphs around it, which is not true of an idea
 * anchored to a quote.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { anthropicCallFailed } from "./anthropic-call.js";
import { articleWithIds } from "./article-prompt.js";
import { isBody } from "./block-policy.js";
import { mintUniqueId } from "./ids.js";
import type { Article } from "./article-input.js";
import { stageFailure } from "./job-failure.js";
import { jsdom } from "./jsdom-lazy.js";
import { MODEL_REFUSED } from "./messages.js";
import { streamMessage, wasRefused } from "./messages-stream.js";
import { CAPABLE_MODEL, type Effort } from "./models.js";
import { REF_ATTR } from "./notes.js";
import { parseJsonAnswer } from "./parse-json.js";
import { findQuote } from "./quote-match.js";
import {
  articleWithIdsFingerprint,
  type BlockFingerprint,
  fallbackHeadTitle,
  type MetaFingerprintWithUrl,
} from "./source-hash.js";
import type { ArtifactStore } from "./store/artifacts.js";
import { budgetFor, truncationFailure } from "./token-budget.js";
import {
  type Block,
  type BlockId,
  type CitedWork,
  type CitationDrops,
  type CitationFind,
  type CitationLinkFrom,
  type CitationPlace,
  type Citations,
  type CitationScoreDrops,
  MAX_CITATIONS,
  type Meta,
  type Tree,
} from "./types.js";

export { MAX_CITATIONS };
export type { CitedWork, CitationDrops, CitationPlace, Citations, CitationScoreDrops };

/**
 * Bumped whenever the prompt changes what a row *is*. Exported so tests assert
 * against the current value rather than pinning a literal.
 */
/* `citations/2`, 2026-09-11: the quote rule forbids "..." and quoting across
   blocks — the stage-1 runs' commonest reason a place failed verification. */
export const PROMPT_VERSION = "citations/2";

/** Mentions kept per work. The first-cited jump needs one; three is room for the shorthand and the note. */
export const MAX_MENTIONS = 3;
/** Field caps the prompt states, and what code clips to. They are also what `PER_WORK_TOKENS` is sized on. */
export const TITLE_CAP = 120;
export const WHY_CAP = 160;
export const AUTHORS_CAP = 120;
export const QUOTE_CAP = 120;

/**
 * `medium`, as a constant here rather than a row in `STAGE_EFFORT`, because this
 * is not an `ArticleStage` (src/types.ts § StepName, the `citations` note): it
 * sends every block, bibliography included, so it shares no cached prefix with
 * the stages in that table. Medium because this is careful extraction rather
 * than argument — the judgement it does make, relevance, is a reading of the
 * whole piece and not a chain of inference. `SPIDERYARN_PIPELINE_EFFORT` still
 * overrides it, as it does for every stage `effortFor` serves.
 */
const EFFORT: Effort = "medium";

/**
 * **The answer estimate** — `base + entries × per-entry`, fed to `budgetFor`
 * (Sol's F10). Per entry: a title ≤ 120 chars (~30 tokens), authors (~25), a
 * year, `why` ≤ 160 chars (~40), two scores, a reference and up to three
 * mentions at a block id plus a ≤ 120-char quote each (~45 apiece), and the JSON
 * around them. About 320; 350 for slack. Footnote expansion in code is what
 * keeps this small — the model never lists the thirteen paragraphs a Wikipedia
 * note is cited from.
 *
 * **Sized for the cap, always**, rather than guessed from the article: a
 * bibliography's length is not readable off the word count, and `max_tokens` is
 * a ceiling, not a purchase. 400 + 80 × 350 = 28,400, plus the default
 * reasoning headroom.
 */
export const BASE_TOKENS = 400;
export const PER_WORK_TOKENS = 350;
export function answerEstimate(entries: number = MAX_CITATIONS): number {
  return BASE_TOKENS + entries * PER_WORK_TOKENS;
}

/**
 * What this artefact was written from: every block, the tree, and the cited
 * head (`articleWithIds` prints a `URL:` line) — `articleWithIdsFingerprint`,
 * the hash `ideas` uses, over the same blocks.
 *
 * **One known gap, stated rather than hidden:** the links are derived from each
 * block's *html*, and `BlockFingerprint` carries only its text. A publisher
 * changing an href and nothing else leaves this artefact reporting itself
 * current. Folding html into the hash would widen every store projection that
 * computes it, for a case that is rare and costs a wrong-but-labelled link.
 */
export function inputFingerprint(
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): string {
  return articleWithIdsFingerprint(blocks, tree, meta);
}

/** Does this artefact still describe the article, tree and metadata? */
export function isStale(
  citations: Citations,
  blocks: readonly BlockFingerprint[],
  tree: Tree,
  meta: MetaFingerprintWithUrl | null,
): boolean {
  return citations.sourceHash !== inputFingerprint(blocks, tree, meta);
}

export function emptyDrops(): CitationDrops {
  return {
    unknownIds: 0,
    unquoted: 0,
    relocated: 0,
    extraMentions: 0,
    unanchored: 0,
    malformed: 0,
    overCap: 0,
    merged: 0,
    clipped: 0,
    modelUrls: 0,
  };
}

export function noScoreDrops(): CitationScoreDrops {
  return { relevanceAbsent: 0, relevanceRejected: 0, influenceAbsent: 0, influenceRejected: 0 };
}

/* ---------------------------------------------------------- reading raw -- */

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** 0–1, or nothing. Out of range is a model error, not a signal to clamp. */
function score(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value;
}

/** `undefined` is absent; anything else `score()` refuses is rejected — `scoreCounting` in src/glossary.ts. */
function scoreCounting(
  value: unknown,
  scores: CitationScoreDrops,
  absent: "relevanceAbsent" | "influenceAbsent",
  rejected: "relevanceRejected" | "influenceRejected",
): number | undefined {
  if (value === undefined) {
    scores[absent]++;
    return undefined;
  }
  const kept = score(value);
  if (kept === undefined) scores[rejected]++;
  return kept;
}

/** Shorten to `cap` characters at a word boundary, and say so. */
function clip(value: string, cap: number, drops: CitationDrops): string {
  if (value.length <= cap) return value;
  drops.clipped++;
  const cut = value.slice(0, cap - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > cap / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/u, "")}…`;
}

interface RawPlace {
  block?: unknown;
  blockId?: unknown;
  quote?: unknown;
}

interface RawWork {
  title?: unknown;
  authors?: unknown;
  year?: unknown;
  why?: unknown;
  relevance?: unknown;
  influence?: unknown;
  reference?: unknown;
  mentions?: unknown;
  /* Never read for anything but a counter — see `CitationDrops.modelUrls`. */
  url?: unknown;
  link?: unknown;
  doi?: unknown;
  href?: unknown;
}

/**
 * Believe a place only if the article backs it up — the id exists and the words
 * are there.
 *
 * `"spaced"`, the pass that reads a match as *the model copied this*, because
 * that is the claim being made (src/quote-match.ts § `passes`). And the stored
 * quote is **sliced out of the block**, as src/quotes.ts § `place` does: the
 * model's string is a locator.
 */
export function verifyPlace(
  raw: unknown,
  byId: ReadonlyMap<string, Block>,
  drops: CitationDrops,
): CitationPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as RawPlace;
  const id = text(p.block) || text(p.blockId);
  const block = byId.get(id);
  if (!block) {
    drops.unknownIds++;
    return null;
  }
  const quote = text(p.quote);
  if (!quote) {
    drops.unquoted++;
    return null;
  }
  const span = findQuote(block.text, quote, undefined, "spaced");
  if (span) return { blockId: block.id, quote: block.text.slice(span.start, span.end), start: span.start };
  /* **Not in the block it named — but maybe in exactly one other.** The words
     are the evidence and the id is the model's guess at where they are; when
     the words sit verbatim in one other block and nowhere else, that block is
     where the article cites the work. Two or more candidates is ambiguity, and
     ambiguity is dropped: the same rule `locate` in src/quotes.ts keeps. */
  let found: { block: Block; start: number; end: number } | null = null;
  for (const other of byId.values()) {
    if (other.id === block.id) continue;
    const at = findQuote(other.text, quote, undefined, "spaced");
    if (!at) continue;
    if (found) {
      drops.unquoted++;
      return null;
    }
    found = { block: other, start: at.start, end: at.end };
  }
  if (!found) {
    drops.unquoted++;
    return null;
  }
  drops.relocated++;
  return {
    blockId: found.block.id,
    quote: found.block.text.slice(found.start, found.end),
    start: found.start,
  };
}

/** A work as read and verified, before its link, its key and its id. */
export interface Draft {
  title: string;
  authors?: string;
  year?: string;
  why: string;
  relevance?: number;
  influence?: number;
  reference?: CitationPlace;
  mentions: CitationPlace[];
}

/**
 * Turn what the model said into works, believing as little as possible. A work
 * needs a title, a `why`, and **at least one verified place** — a row with no
 * place is a claim with no way back to the page.
 */
export function toDrafts(
  raw: unknown,
  blocks: readonly Block[],
  drops: CitationDrops,
  scores: CitationScoreDrops,
): Draft[] {
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const out: Draft[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const draft = readDraft(item, byId, drops, scores);
    if (draft) out.push(draft);
  }
  /* **No cut here.** The cap counts works, and these are still rows — the
     shorthand cite and its full entry are two of them until `buildCitations`
     folds them. `keepLeanedOnMost` cuts after both folds. GPT Sol F13. */
  return out;
}

/**
 * **Past the cap, keep the works the piece leans on most** — the prompt's own
 * instruction, which the model does not always obey: spider silk came back with
 * 100 rows on the stage-1 run. Highest `relevance` first (an unscored work
 * last), the model's order as the tie-break, and the kept rows stay in the
 * model's order.
 *
 * **Run on works, after both folds**, never on the raw rows: cut first and
 * eighty copies of one work take the whole allowance, the distinct work behind
 * them is gone, and the foot says "these are the 80" over one row. GPT Sol F13,
 * 2026-09-12.
 */
function keepLeanedOnMost<T extends { draft: Draft }>(items: T[], drops: CitationDrops): T[] {
  if (items.length <= MAX_CITATIONS) return items;
  drops.overCap += items.length - MAX_CITATIONS;
  const kept = new Set(
    items
      .map((w, i) => ({ r: w.draft.relevance ?? -1, i }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .slice(0, MAX_CITATIONS)
      .map((x) => x.i),
  );
  return items.filter((_, i) => kept.has(i));
}

/** What a model writes when it should have left a field out. */
const PLACEHOLDER = /^(unknown|unknown authors?|n\/?a|none|not (given|stated|known)|no authors?|-+)$/i;

function given(value: string): string {
  return PLACEHOLDER.test(value) ? "" : value;
}

/** One work, or `null` with the reason counted. */
function readDraft(
  item: unknown,
  byId: ReadonlyMap<string, Block>,
  drops: CitationDrops,
  scores: CitationScoreDrops,
): Draft | null {
  if (!item || typeof item !== "object") {
    drops.malformed++;
    return null;
  }
  const w = item as RawWork;
  if (w.url !== undefined || w.link !== undefined || w.doi !== undefined || w.href !== undefined) {
    drops.modelUrls++;
  }
  const title = text(w.title);
  const why = text(w.why);
  if (!title || !why) {
    drops.malformed++;
    return null;
  }
  const reference = w.reference === undefined ? null : verifyPlace(w.reference, byId, drops);
  const mentions = verifyMentions(w.mentions, byId, drops);
  if (!reference && mentions.length === 0) {
    drops.unanchored++;
    return null;
  }
  const authors = given(text(w.authors));
  const year = typeof w.year === "number" ? String(w.year) : given(text(w.year));
  const relevance = scoreCounting(w.relevance, scores, "relevanceAbsent", "relevanceRejected");
  const influence = scoreCounting(w.influence, scores, "influenceAbsent", "influenceRejected");
  return {
    title: clip(title, TITLE_CAP, drops),
    ...(authors ? { authors: clip(authors, AUTHORS_CAP, drops) } : {}),
    ...(year && year.length <= 16 ? { year } : {}),
    why: clip(why, WHY_CAP, drops),
    ...(relevance === undefined ? {} : { relevance }),
    ...(influence === undefined ? {} : { influence }),
    ...(reference ? { reference } : {}),
    mentions,
  };
}

/** The verified mentions, deduplicated, at most `MAX_MENTIONS`. */
function verifyMentions(
  raw: unknown,
  byId: ReadonlyMap<string, Block>,
  drops: CitationDrops,
): CitationPlace[] {
  const mentions: CitationPlace[] = [];
  for (const m of Array.isArray(raw) ? raw : []) {
    const place = verifyPlace(m, byId, drops);
    if (!place) continue;
    if (mentions.some((x) => x.blockId === place.blockId && x.start === place.start)) continue;
    if (mentions.length === MAX_MENTIONS) {
      drops.extraMentions++;
      continue;
    }
    mentions.push(place);
  }
  return mentions;
}

/* ------------------------------------------------------------ footnotes -- */

/** Apparatus rather than argument: a note, or a bibliography entry. */
function isApparatus(block: Block): boolean {
  return Boolean(block.noteId) || block.role === "footnote" || block.role === "reference";
}

/** A block of the argument — where "first cited" may land. */
export function isBodyBlock(block: Block): boolean {
  return !isApparatus(block) && isBody(block);
}

const MARKER = new RegExp(`${REF_ATTR}="([^"]+)"`, "g");

/**
 * Every body block carrying a marker for each note, in document order.
 *
 * Read off the html with a pattern rather than a parse: the attribute is ours,
 * stamped by stage 2 after `scrubReserved` took every forged copy off the page
 * (src/notes.ts), so its spelling is known exactly.
 */
export function noteMarkers(blocks: readonly Block[]): Map<string, BlockId[]> {
  const out = new Map<string, BlockId[]>();
  for (const block of blocks) {
    if (!isBodyBlock(block) || !block.html.includes(REF_ATTR)) continue;
    for (const m of block.html.matchAll(MARKER)) {
      const noteId = m[1];
      if (!noteId) continue;
      const list = out.get(noteId) ?? [];
      if (list[list.length - 1] !== block.id) list.push(block.id);
      out.set(noteId, list);
    }
  }
  return out;
}

/**
 * Where the work is cited in the body, and where its *first cited* jump goes.
 *
 * Body mentions count directly; a place in a note counts at every marker for
 * that note. A work found only in apparatus with no marker pointing at it — a
 * bibliography entry the text never cites by number — jumps to its entry, with
 * `citedInBody: false`, and sorts after the rest.
 */
export function placesOf(
  draft: Draft,
  blocks: readonly Block[],
  position: ReadonlyMap<string, number>,
  markers: ReadonlyMap<string, BlockId[]>,
): { citedAt: BlockId[]; firstCited: BlockId; citedInBody: boolean } {
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const places = [...(draft.reference ? [draft.reference] : []), ...draft.mentions];
  const body = new Set<BlockId>();
  for (const place of places) {
    const block = byId.get(place.blockId);
    if (!block) continue;
    if (isBodyBlock(block)) body.add(block.id);
    if (block.noteId) for (const at of markers.get(block.noteId) ?? []) body.add(at);
  }
  const at = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  const citedAt = [...body].sort((a, b) => at(a) - at(b));
  if (citedAt[0]) return { citedAt, firstCited: citedAt[0], citedInBody: true };
  const earliest = places.map((p) => p.blockId).sort((a, b) => at(a) - at(b))[0];
  /* `toDrafts` refuses a work with no place, so `earliest` is always there;
     the fallback is for the type, and names a block the work really is in. */
  return { citedAt, firstCited: earliest ?? places[0]!.blockId, citedInBody: false };
}

/* ----------------------------------------------------------------- links -- */

/** A DOI as it is written: `10.` + registrant + `/` + suffix. */
const DOI = /\b(10\.\d{4,9}\/[^\s"'<>?#]+)/gi;
/** A modern or pre-2007 arXiv id, in a URL. */
const ARXIV_URL =
  /arxiv\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/gi;
/** The same, as the text writes it: `arXiv:2001.08361`. */
const ARXIV_TEXT = /\barxiv:\s?(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(?:v\d+)?/gi;

/** Trim the punctuation a sentence puts after a DOI, keeping a bracket the DOI opened. */
function trimDoi(raw: string): string {
  let doi = raw.replace(/[.,;:]+$/, "");
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ] as const) {
    while (doi.endsWith(close) && doi.split(open).length < doi.split(close).length) {
      doi = doi.slice(0, -1).replace(/[.,;:]+$/, "");
    }
  }
  return doi;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Every DOI and arXiv id in some strings, normalised for comparison. */
export function identifiersIn(strings: readonly string[]): { dois: string[]; arxivs: string[] } {
  const dois = new Map<string, string>();
  const arxivs = new Set<string>();
  for (const s of strings) {
    const plain = decoded(s);
    for (const m of plain.matchAll(DOI)) {
      const doi = trimDoi(m[1] ?? "");
      if (doi) dois.set(doi.toLowerCase(), doi);
    }
    for (const m of plain.matchAll(ARXIV_URL)) if (m[1]) arxivs.add(m[1].toLowerCase());
    for (const m of plain.matchAll(ARXIV_TEXT)) if (m[1]) arxivs.add(m[1].toLowerCase());
  }
  return { dois: [...dois.values()], arxivs: [...arxivs] };
}

/** An anchor in a block that points off the page. */
export interface Anchor {
  href: string;
  text: string;
  /** The anchor's `title` attribute — gwern writes the work's title there. */
  label: string;
  /** Every URL the anchor carries: href, and gwern's `data-url-original`/`data-href-mobile`. */
  urls: string[];
}

/** Attributes on an anchor that hold the address the author meant. */
const URL_ATTRS = ["href", "data-url-original", "data-href-mobile"] as const;

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

let parser: { doc: Document } | null = null;
function scratch(): Document {
  /* One document for the whole run: a fragment is parsed into a fresh `div` of
     it per block, which costs a fraction of a `new JSDOM` each time. */
  parser ??= { doc: new (jsdom().JSDOM)("").window.document };
  return parser.doc;
}

/** The external anchors in one block's html. Our own note links (`#…`) are never external. */
export function anchorsOf(html: string): Anchor[] {
  if (!html.includes("<a")) return [];
  const holder = scratch().createElement("div");
  holder.innerHTML = html;
  const out: Anchor[] = [];
  for (const a of holder.querySelectorAll("a[href]")) {
    const href = httpUrl(a.getAttribute("href"));
    if (!href) continue;
    const urls = URL_ATTRS.map((n) => httpUrl(a.getAttribute(n))).filter(
      (u): u is string => u !== null,
    );
    out.push({
      href,
      text: text(a.textContent),
      label: text(a.getAttribute("title")),
      urls,
    });
  }
  return out;
}

const STOP = new Set(
  "a an and the of in on for to with by from at as is are was be or its it this that into via vs".split(
    " ",
  ),
);

/** A string reduced to its significant words. Comparison only. */
export function wordsOf(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Does this anchor text name this title? Most of the title's words must be in
 * it, and most of its words must be the title's — so an author's name, which
 * shares nothing with the title, never matches, and nor does a whole sentence
 * that happens to contain two of the title's words.
 */
export function namesTitle(anchorText: string, title: string): boolean {
  const t = new Set(wordsOf(title));
  const a = wordsOf(anchorText);
  if (t.size === 0 || a.length === 0) return false;
  const shared = new Set(a.filter((w) => t.has(w))).size;
  return shared >= Math.min(2, t.size) && shared >= Math.ceil(0.6 * t.size) && shared / new Set(a).size >= 0.5;
}

/**
 * Does an anchor's `title` attribute name this title? **Recall only**: gwern
 * writes `'Title', Authors Year` there, so the attribute is a description of a
 * work rather than words in a sentence, and the authors and year it adds are
 * not evidence against the match. Nearly all of the title must be in it.
 */
export function labelNamesTitle(label: string, title: string): boolean {
  const t = new Set(wordsOf(title));
  if (t.size === 0) return false;
  const shared = new Set(wordsOf(label).filter((w) => t.has(w))).size;
  return shared >= Math.min(2, t.size) && shared >= Math.ceil(0.8 * t.size);
}

/**
 * **Does a search result name this work?** Stage 3's third rule
 * (src/citation-find.ts): a URL the search returned can still be the wrong
 * work — a review of it, a page about its author — so a found page is kept only
 * if its own title names the work (`namesTitle`, both directions) or its
 * excerpt carries the work's title words **as a run**, in order.
 *
 * The excerpt test is a phrase, not a bag of words, because an excerpt is a
 * whole page's opening and a bag would find "language", "models" and "few"
 * scattered through almost anything. A title of one significant word never
 * matches by excerpt — too common to be evidence — only by the page's title.
 */
export function pageNamesTitle(page: { title?: string; excerpt?: string }, title: string): boolean {
  if (page.title && namesTitle(page.title, title)) return true;
  if (!page.excerpt) return false;
  const want = wordsOf(title);
  if (want.length < 2) return false;
  const have = wordsOf(page.excerpt);
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((w, j) => have[i + j] === w)) return true;
  }
  return false;
}

/**
 * **Put stage 3's kept finds onto the list, at read time.** Only a row whose
 * link is a `search` is upgraded — to the found page, `linkFrom: "web"` — so a
 * link the article gave always wins over one we went looking for, even if a
 * find for that id is stored (a re-run can turn a searched row into a DOI row
 * and inherit its id). The artefact itself is never changed.
 */
export function attachFinds(citations: Citations, finds: ReadonlyMap<string, CitationFind>): Citations {
  if (finds.size === 0) return citations;
  let changed = false;
  const works = citations.citations.map((work) => {
    const find = finds.get(work.id);
    if (!find || work.linkFrom !== "search") return work;
    changed = true;
    const { url, ...found } = find;
    return { ...work, url, linkFrom: "web" as const, found };
  });
  return changed ? { ...citations, citations: works } : citations;
}

/** Anchor text that says nothing about which work it is. */
const GENERIC = new Set(
  "here this link paper source article study post report pdf website site see read more".split(" "),
);

function isGeneric(anchorText: string): boolean {
  const words = wordsOf(anchorText);
  return words.length < 2 || words.every((w) => GENERIC.has(w));
}

function normal(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** The link for one DOI / arXiv id. */
function doiUrl(doi: string): string {
  return `https://doi.org/${doi}`;
}
function arxivUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`;
}

/** A search for the work, never its address. */
export function scholarUrl(title: string, authors?: string): string {
  const surname = firstAuthor(authors);
  const q = `"${title}"${surname ? ` ${surname}` : ""}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(q)}`;
}

/** The first author's name as the article gives it — "Sapede, D.; Seydel, T." → "Sapede". */
export function firstAuthor(authors?: string): string {
  if (!authors) return "";
  const first = authors.split(/;|,|\s&\s|\band\b/)[0] ?? "";
  return first.replace(/\bet al\.?/i, "").trim();
}

/**
 * An anchor's own identifier, when it carries exactly one — gwern links the
 * title to its archived PDF and keeps the arXiv address in
 * `data-url-original`, so the anchor chosen by title can still give `arxiv`.
 */
function fromAnchor(anchor: Anchor): { url: string; linkFrom: CitationLinkFrom } {
  const { dois, arxivs } = identifiersIn(anchor.urls);
  if (dois.length === 1 && dois[0]) return { url: doiUrl(dois[0]), linkFrom: "doi" };
  if (dois.length === 0 && arxivs.length === 1 && arxivs[0]) {
    return { url: arxivUrl(arxivs[0]), linkFrom: "arxiv" };
  }
  return { url: anchor.href, linkFrom: "article" };
}

/**
 * **The link, from the article, by code** — the plan's one safety property.
 *
 * The blocks rules 1–3 read are the work's **entry**: its verified reference, or
 * failing that the note blocks among its mentions (a work found only inside a
 * footnote has its entry there).
 *
 * 1. **Exactly one DOI** in the entry's text and hrefs → `doi.org`.
 * 2. **No DOI and exactly one arXiv id** → `arxiv.org/abs`.
 *    Both only when **no other work in this run shares that entry block**:
 *    a gwern note naming three papers holds three identifiers, or one paper's
 *    identifier and two papers without — and either way a block-level id would
 *    be handed to the wrong work.
 * 3. **Exactly one external anchor in the entry whose text (or `title`
 *    attribute) names the title** — `namesTitle`. An author's Wikipedia page
 *    before the paper's link does not name the title, so it is never chosen.
 * 4. **Exactly one external anchor in a mention block whose text is the
 *    mention's own words**, and is not a generic label.
 * 5. **Otherwise a Scholar search**, shown as a search.
 *
 * Every ambiguity falls through, because a link to the wrong work is worse than
 * a search.
 */
export function linkFor(
  draft: Draft,
  byId: ReadonlyMap<string, Block>,
  /** How many works in this run use this block as their entry. */
  claims: ReadonlyMap<string, number>,
): { url: string; linkFrom: CitationLinkFrom } {
  const entry = entryBlocks(draft, byId);

  const alone = entry.every((b) => (claims.get(b.id) ?? 0) <= 1);
  if (alone && entry.length > 0) {
    const strings = entry.flatMap((b) => [b.text, ...anchorsOf(b.html).flatMap((a) => a.urls)]);
    const { dois, arxivs } = identifiersIn(strings);
    if (dois.length === 1 && dois[0]) return { url: doiUrl(dois[0]), linkFrom: "doi" };
    if (dois.length === 0 && arxivs.length === 1 && arxivs[0]) {
      return { url: arxivUrl(arxivs[0]), linkFrom: "arxiv" };
    }
  }

  const titled = unique(
    entry.flatMap((b) => anchorsOf(b.html)).filter(
      (a) => namesTitle(a.text, draft.title) || (a.label !== "" && labelNamesTitle(a.label, draft.title)),
    ),
  );
  if (titled) return fromAnchor(titled);

  const mentioned = mentionAnchor(draft, byId);
  if (mentioned) return fromAnchor(mentioned);

  return { url: scholarUrl(draft.title, draft.authors), linkFrom: "search" };
}

/** Rule 4: the one anchor in the mention blocks that IS a mention's own words, or nothing. */
function mentionAnchor(draft: Draft, byId: ReadonlyMap<string, Block>): Anchor | null {
  const spoken: Anchor[] = [];
  for (const mention of draft.mentions) {
    const block = byId.get(mention.blockId);
    if (!block) continue;
    const quote = normal(mention.quote);
    const anchors = anchorsOf(block.html);
    for (const a of anchors) {
      const words = normal(a.text);
      if (!words || isGeneric(a.text) || !quote.includes(words)) continue;
      /* **The anchor has to BE the quote, near enough** — most of its words.
         Containment alone linked a work to Wikipedia's *Toughness* page on the
         stage-1 spider-silk run, because "unit of toughness" sat inside a longer
         quoted sentence: a concept link, not the work's address. */
      if (wordsOf(a.text).length < 0.6 * wordsOf(mention.quote).length) continue;
      /* **And not an encyclopedia's concept page**, unless its words name the
         work. Wikipedia's prose links people and ideas, and stage 1 linked works
         to Heron_of_Alexandria, Pappus_of_Alexandria and Atomic_force_microscopy
         through exactly this rule. Rule 3 is not affected: a reference whose
         title links to the work's own article ("De re publica") is fine. */
      if (/(^|\.)wikipedia\.org$/.test(hostOf(a.href)) && !namesTitle(a.text, draft.title)) continue;
      /* Unique in the block, as well as across the mentions: the same words
         linked twice in one paragraph to two places says nothing about which. */
      if (anchors.filter((b) => normal(b.text) === words).length > 1) continue;
      spoken.push(a);
    }
  }
  return unique(spoken);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/** The one anchor, when every candidate points at the same address; otherwise nothing. */
function unique(anchors: readonly Anchor[]): Anchor | null {
  const hrefs = new Set(anchors.map((a) => a.href));
  return hrefs.size === 1 ? (anchors[0] ?? null) : null;
}

/** The blocks that hold the work's entry — its reference, else its note-block mentions. */
function entryBlocks(draft: Draft, byId: ReadonlyMap<string, Block>): Block[] {
  if (draft.reference) {
    const block = byId.get(draft.reference.blockId);
    return block ? [block] : [];
  }
  const out: Block[] = [];
  for (const m of draft.mentions) {
    const block = byId.get(m.blockId);
    if (block && isApparatus(block) && !out.includes(block)) out.push(block);
  }
  return out;
}

/* -------------------------------------------------- identity and dedupe -- */

/**
 * **The two keys a work is known by.** `idKey` from its link — `doi:`, `arxiv:`,
 * or `url:` for an article-given address — and `workKey` from what the model
 * wrote: normalised title, first author and year. A Scholar search has no
 * `idKey`, because the search is ours and says nothing about identity.
 */
export function keysOf(work: Pick<CitedWork, "title" | "authors" | "year" | "url" | "linkFrom">): {
  idKey: string | null;
  workKey: string;
} {
  let idKey: string | null = null;
  if (work.linkFrom === "doi") idKey = `doi:${work.url.slice("https://doi.org/".length).toLowerCase()}`;
  else if (work.linkFrom === "arxiv") idKey = `arxiv:${work.url.slice("https://arxiv.org/abs/".length).toLowerCase()}`;
  else if (work.linkFrom === "article") idKey = `url:${canonicalUrl(work.url)}`;
  const workKey = `work:${keyWords(work.title)}|${keyWords(firstAuthor(work.authors))}|${keyWords(work.year ?? "")}`;
  return { idKey, workKey };
}

/**
 * Every letter-and-digit run, lower-cased. **Not `wordsOf`**: that drops short
 * words and stopwords, which is right for judging whether an anchor names a
 * title and wrong for identity — "Part 1" and "Part 2" are two works.
 */
function keyWords(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’'`]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

/** Fold `b` into `a`: `a`'s fields win, `b` fills the gaps, the places are unioned. */
function mergeInto(a: Draft, b: Draft, drops: CitationDrops): Draft {
  const mentions = [...a.mentions];
  for (const m of b.mentions) {
    if (mentions.some((x) => x.blockId === m.blockId && x.start === m.start)) continue;
    if (mentions.length === MAX_MENTIONS) {
      drops.extraMentions++;
      continue;
    }
    mentions.push(m);
  }
  const reference = a.reference ?? b.reference;
  const authors = a.authors ?? b.authors;
  const year = a.year ?? b.year;
  const relevance = maxOf(a.relevance, b.relevance);
  const influence = maxOf(a.influence, b.influence);
  return {
    title: a.title,
    why: a.why,
    ...(authors ? { authors } : {}),
    ...(year ? { year } : {}),
    ...(relevance === undefined ? {} : { relevance }),
    ...(influence === undefined ? {} : { influence }),
    ...(reference ? { reference } : {}),
    mentions,
  };
}

function maxOf(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

/** Merge drafts sharing a key, keeping the first's place in the list. */
function mergeBy<T extends { draft: Draft }>(
  items: T[],
  keyOf: (item: T) => string | null,
  drops: CitationDrops,
  combine: (kept: T, folded: T) => T,
): T[] {
  const out: T[] = [];
  const at = new Map<string, number>();
  for (const item of items) {
    const key = keyOf(item);
    const hit = key === null ? undefined : at.get(key);
    if (hit === undefined) {
      if (key !== null) at.set(key, out.length);
      out.push(item);
      continue;
    }
    drops.merged++;
    out[hit] = combine(out[hit]!, item);
  }
  return out;
}

/** Ids from the list this run replaces, by `key`. A key two old rows share lends nothing. */
export function idsByKey(onDisk: Citations | null): Map<string, string> {
  const seen = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const c of onDisk?.citations ?? []) {
    if (!c || typeof c.id !== "string" || typeof c.key !== "string") continue;
    if (seen.has(c.key)) ambiguous.add(c.key);
    else seen.set(c.key, c.id);
  }
  for (const key of ambiguous) seen.delete(key);
  return seen;
}

/* ------------------------------------------------------------- the build -- */

/**
 * The artefact, from what the model said plus what code could verify and
 * derive of it.
 */
export function buildCitations(
  parsed: { works?: unknown; capped?: unknown },
  opts: {
    slug: string;
    blocks: readonly Block[];
    sourceHash: string;
    elapsedMs: number;
    inherit: Map<string, string> | null;
    drops: CitationDrops;
    scores: CitationScoreDrops;
  },
): Citations {
  /* `{}` is a failed answer, not an article that cites nothing — the timeline's
     lesson (src/timeline.ts § buildTimeline). */
  if (!Array.isArray(parsed.works)) {
    throw new Error(
      "The model's answer has no `works` array in it. An article that cites nothing comes back " +
        'as `{"works": []}`; this came back as something else, which is a failed answer.',
    );
  }
  const { blocks, drops } = opts;
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const position = new Map(blocks.map((b, i) => [b.id as string, i]));
  const markers = noteMarkers(blocks);

  /* 1 — verify, then fold duplicates the model wrote twice by title+author+year
     (the shorthand and the full entry), BEFORE the links, so the merged row
     derives its link from the union of both rows' places. */
  const drafts = toDrafts(parsed.works, blocks, drops, opts.scores);
  const byWork = mergeBy(
    drafts.map((draft) => ({ draft })),
    ({ draft }) => keysOf({ ...draft, url: "", linkFrom: "search" }).workKey,
    drops,
    (a, b) => ({ draft: mergeInto(a.draft, b.draft, drops) }),
  );

  /* 2 — links. `claims` is what lets rules 1 and 2 refuse a block that is the
     entry of more than one work. */
  const claims = new Map<string, number>();
  for (const { draft } of byWork) {
    for (const b of entryBlocks(draft, byId)) claims.set(b.id, (claims.get(b.id) ?? 0) + 1);
  }
  const linked = byWork.map(({ draft }) => ({ draft, ...linkFor(draft, byId, claims) }));

  /* 3 — fold again on the identifier: two rows the article links to one DOI or
     one address are one work. The better-evidenced link is kept. */
  const RANK: Record<CitationLinkFrom, number> = { doi: 0, arxiv: 1, article: 2, web: 3, search: 4 };
  const folded = mergeBy(
    linked,
    (w) => keysOf({ ...w.draft, url: w.url, linkFrom: w.linkFrom }).idKey,
    drops,
    (a, b) => ({
      draft: mergeInto(a.draft, b.draft, drops),
      ...(RANK[b.linkFrom] < RANK[a.linkFrom]
        ? { url: b.url, linkFrom: b.linkFrom }
        : { url: a.url, linkFrom: a.linkFrom }),
    }),
  );

  /* 3½ — the cap, on works rather than rows, now that both folds are done. */
  const works = keepLeanedOnMost(folded, drops);

  if (works.length === 0 && parsed.works.length > 0) {
    const d = drops;
    throw new Error(
      `The model named ${parsed.works.length} works and none of them could be anchored to the ` +
        "article, so there is nothing to write. " +
        `Dropped: ${d.unanchored} with no usable place, ${d.unknownIds} places naming a block id ` +
        `that is not in this article, ${d.unquoted} whose quote could not be found in the block ` +
        `it named, ${d.malformed} malformed.`,
    );
  }

  /* 4 — identity. Keys counted on this side too: two fresh rows with one key
     would both claim the old id. */
  const keyed = works.map((w) => {
    const { idKey, workKey } = keysOf({ ...w.draft, url: w.url, linkFrom: w.linkFrom });
    return { ...w, key: idKey ?? workKey };
  });
  const counts = new Map<string, number>();
  for (const w of keyed) counts.set(w.key, (counts.get(w.key) ?? 0) + 1);
  const taken = new Set<string>(opts.inherit?.values() ?? []);

  const citations: CitedWork[] = keyed.map((w) => {
    const old = counts.get(w.key) === 1 ? opts.inherit?.get(w.key) : undefined;
    return {
      id: old ?? mintUniqueId(taken),
      key: w.key,
      ...w.draft,
      ...placesOf(w.draft, blocks, position, markers),
      url: w.url,
      linkFrom: w.linkFrom,
    };
  });

  const capped = parsed.capped === true || drops.overCap > 0;
  return {
    version: PROMPT_VERSION,
    generator: CAPABLE_MODEL,
    slug: opts.slug,
    sourceHash: opts.sourceHash,
    citations: inFirstCitedOrder(citations, position),
    capped,
    generatedAt: new Date().toISOString(),
    elapsedMs: opts.elapsedMs,
  };
}

/**
 * Body-cited works by their first body block, then bibliography-only works by
 * their entry. Index as the tie-break, so two works first cited in one
 * paragraph keep the model's order.
 */
export function inFirstCitedOrder(
  citations: CitedWork[],
  position: ReadonlyMap<string, number>,
): CitedWork[] {
  const at = (id: string) => position.get(id) ?? Number.MAX_SAFE_INTEGER;
  return citations
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      if (a.c.citedInBody !== b.c.citedInBody) return a.c.citedInBody ? -1 : 1;
      const d = at(a.c.firstCited) - at(b.c.firstCited);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.c);
}

/**
 * **The coverage witness** (Fable's condition on overruling Sol's F5): how many
 * notes and bibliography entries the article has, against how many the list
 * reached. A silent under-return on a 60-item bibliography shows up here, in a
 * run, rather than nowhere. Counts only.
 */
export interface Coverage {
  /** Distinct notes in the article. */
  notes: number;
  /** Distinct notes at least one row was found in. */
  notesReached: number;
  /** Bibliography entries outside any note (`role: "reference"`). */
  references: number;
  referencesReached: number;
  /** Rows written. */
  works: number;
}

export function coverageOf(blocks: readonly Block[], citations: Citations): Coverage {
  const byId = new Map(blocks.map((b) => [b.id as string, b]));
  const notes = new Set(blocks.map((b) => b.noteId).filter((n): n is string => Boolean(n)));
  const refs = blocks.filter((b) => !b.noteId && b.role === "reference");
  const notesReached = new Set<string>();
  const refsReached = new Set<string>();
  for (const c of citations.citations) {
    for (const p of [...(c.reference ? [c.reference] : []), ...c.mentions]) {
      const block = byId.get(p.blockId);
      if (block?.noteId) notesReached.add(block.noteId);
      else if (block?.role === "reference") refsReached.add(block.id);
    }
  }
  return {
    notes: notes.size,
    notesReached: notesReached.size,
    references: refs.length,
    referencesReached: refsReached.size,
    works: citations.citations.length,
  };
}

/* ---------------------------------------------------------- the baseline -- */

/**
 * A previous `citations` artefact this store cannot read — the sibling of
 * `TimelineBaselineUnusable`. Carrying on would mint a fresh id for every work
 * and orphan every stored stage-3 lookup, quietly.
 */
export class CitationsBaselineUnusable extends Error {
  constructor(readonly slug: string) {
    super(
      `citations "${slug}": there is a previous citations artefact and this store cannot read ` +
        "it — it will not parse, is of the wrong shape, or is past the size the store reads back.\n" +
        "Every id in it is one a stored web lookup is keyed on (docs/plans/260911g-citations-mode.md), " +
        "so carrying on would mint a fresh id for every work and orphan them, quietly.\n" +
        "Nothing has been written — the citations are still the previous run's.\n" +
        "Put it back from a backup, or delete it deliberately if this article's citations really " +
        "are starting again from nothing.",
    );
    this.name = "CitationsBaselineUnusable";
  }
}

/**
 * The previous citations, **from the store**, for their ids. The four-state
 * table `previousIdeasFrom` (src/ideas.ts) documents, with one difference: the
 * ids are inherited whether or not `sourceHash` matches — see the header.
 */
export async function previousCitationsFrom(
  store: Pick<ArtifactStore, "readBaseline">,
  slug: string,
): Promise<Citations | null> {
  const outcome = await store.readBaseline(slug, "citations", "citations");
  if (outcome.state === "unusable") throw new CitationsBaselineUnusable(slug);
  return outcome.state === "ok" ? outcome.value : null;
}

/* ------------------------------------------------------------ the prompt -- */

const SYSTEM = `You are listing the WORKS this article cites, so that a reader can find each one.

WHAT COUNTS AS A WORK

A book, paper, article, report, dataset, talk, post or other piece the article
points to as a source — through a bibliography or reference list, a footnote,
a name and year in the text ("Tulving (1983)"), or a linked title. Not a person
on their own, not an organisation, not a topic or a concept, and not this
article itself.

One row per work. If the article cites the same work in several places — a
shorthand in the text and a full entry in the bibliography — that is ONE row.

WHERE THE ARTICLE CITES IT

Every place is {"block": "<block id>", "quote": "<words copied from that block>"}.

  "block" — MUST be one of the ids listed in the article above. Never invent one.
  "quote" — copied VERBATIM from that block, character for character, at most
            ${QUOTE_CAP} characters: just enough to find the spot — "Tulving
            (1983)", "Kaplan et al 2020", or the start of the entry. One
            continuous run of words from ONE block: never join two pieces with
            "...", and never quote across two blocks. If you cannot copy it
            exactly, leave the place out.

"reference" — the work's own entry in a bibliography, reference list or note,
if the article has one. Quote the start of the entry: the authors and the title.
When a work is named only inside a footnote, that note is its reference. You do
NOT need to find the footnote's number in the text — we do that.

"mentions" — up to ${MAX_MENTIONS} places in the main text that cite it, earliest
first. Leave it empty rather than repeat the reference.

A work with no place you can quote will be thrown away, so do not offer one.

NO LINKS

Never write a URL, a DOI or any other address, anywhere in your answer. Links are
taken from the article itself, by code. An address from memory is worse than
none: it looks exactly as right as a real one and can send the reader to the
wrong work.

THE FIELDS

"title" — the work's title as the article gives it, at most ${TITLE_CAP}
characters. If the article gives no title, only "Smith (2019)", write that.
"authors" — as the article gives them: "Tulving", "Porter, Vollrath, Shao".
Leave it out if the article gives none.
"year" — as the article gives it. Leave it out if none.
"why" — one plain sentence, at most ${WHY_CAP} characters: what THIS piece uses the
work for — the finding it builds on, the claim it supports, the view it argues
against. Not a summary of the work. Do not begin "The article", "The author" or
"This work". The article's own words for the things it names, ordinary words for
everything else: plainer than the article, never further from it.
"relevance" 0-1 — how much THIS piece's argument leans on the work. 1: the piece
is built on it. 0.5: it carries one step of the argument. 0.1: a passing mention
or further reading.
"influence" 0-1 — how influential the work is in its own field, from what you
know. 1: a landmark nearly everyone in the field knows. 0.5: well known to
specialists. 0.1: obscure, or you do not know it. When you do not know the work,
say so with a low number rather than guessing high.
Both scores are required on every row.

HOW MANY

At most ${MAX_CITATIONS} rows. If the article cites more than ${MAX_CITATIONS} works,
keep the ${MAX_CITATIONS} it leans on most and set "capped": true. Otherwise
"capped": false.

OUTPUT

JSON only, no prose, no code fence:

{"capped": false, "works": [
  {
    "title": "...",
    "authors": "...",
    "year": "...",
    "why": "...",
    "relevance": 0.0,
    "influence": 0.0,
    "reference": {"block": "spya-k3m9qt", "quote": "..."},
    "mentions": [{"block": "spya-a1b2c3", "quote": "..."}]
  }
]}

"authors", "year", "reference" and "mentions" may be omitted — but every row
needs a reference or at least one mention. An article that cites nothing is
{"capped": false, "works": []}.`;

/* Exported for the tests. */
export function renderPrompt(): string {
  return `List the works this article cites — at most ${MAX_CITATIONS}.`;
}

export function systemPrompt(): string {
  return SYSTEM;
}

function parseJson(raw: string): { works?: unknown; capped?: unknown } {
  return parseJsonAnswer<{ works?: unknown; capped?: unknown }>(raw, "the model's answer");
}

/* -------------------------------------------------------------- the call -- */

export interface CitationsRun {
  citations: Citations;
  drops: CitationDrops;
  scores: CitationScoreDrops;
  coverage: Coverage;
  /** The `max_tokens` sent, and the answer estimate it was built from — for the real-run notes. */
  maxTokens: number;
  answerTokens: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  elapsedMs: number;
}

export async function generateCitations(opts: {
  article: Article;
  onProgress?: (detail: string) => void;
  signal?: AbortSignal;
  cacheArticle?: boolean;
  /**
   * The citations this article already has, or `null` **only** when it has
   * none — `previousCitationsFrom`. Required, for the reason `generateIdeas`'s
   * `previous` is: an optional parameter is what a refactor drops while every
   * run goes on reporting success and minting fresh ids.
   */
  previous: Citations | null;
}): Promise<CitationsRun> {
  const { blocks, tree } = opts.article;
  const realMeta: Meta | null = opts.article.meta;
  /* The stub carries one field and nothing else — src/ideas.ts has the whole
     argument for why a second field on it would make every metadata-less
     article stale for ever. */
  const meta: Meta = realMeta ?? ({ title: fallbackHeadTitle(tree) } as Meta);
  const sourceHash = inputFingerprint(blocks, tree, realMeta);
  const inherit = opts.previous ? idsByKey(opts.previous) : null;
  const started = Date.now();

  const answerTokens = answerEstimate();
  const maxTokens = budgetFor("citations", answerTokens);
  const effort = (process.env.SPIDERYARN_PIPELINE_EFFORT as Effort | undefined) ?? EFFORT;

  let message: Anthropic.Message;
  try {
    const call = streamMessage(
      "citations",
      {
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        output_config: { effort },
        system: [
          {
            type: "text" as const,
            /* **Every block**, not `isBodyEvidence`'s — the bibliography and the
               notes are what this stage is for, and the one stage that must
               read them. It is also why this shares no cached prefix with
               `ideas` (src/types.ts § StepName). */
            text: articleWithIds(meta, [...blocks]),
            ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
          },
          { type: "text" as const, text: SYSTEM },
        ],
        messages: [{ role: "user", content: renderPrompt() }],
      },
      { ...(opts.signal ? { signal: opts.signal } : {}) },
    );
    if (opts.onProgress) {
      const report = opts.onProgress;
      let chars = 0;
      let last = 0;
      call.onText((delta) => {
        chars += delta.length;
        const now = Date.now();
        if (now - last < 500) return;
        last = now;
        report(`${Math.round(chars / 1000)}k characters of citations so far`);
      });
    }
    message = await call.finalMessage();
  } catch (err) {
    throw anthropicCallFailed(err);
  }
  if (wasRefused(message)) {
    throw stageFailure(MODEL_REFUSED, { authored: "the model answered with stop_reason: refusal" });
  }
  const answerText = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (message.stop_reason === "max_tokens") {
    throw truncationFailure("citations", maxTokens, answerTokens, {
      outputTokens: message.usage.output_tokens,
      answerChars: answerText.length,
    });
  }

  const drops = emptyDrops();
  const scores = noScoreDrops();
  const citations = buildCitations(parseJson(answerText), {
    slug: tree.slug,
    blocks,
    sourceHash,
    elapsedMs: Date.now() - started,
    inherit,
    drops,
    scores,
  });
  return {
    citations,
    drops,
    scores,
    coverage: coverageOf(blocks, citations),
    maxTokens,
    answerTokens,
    model: CAPABLE_MODEL,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    elapsedMs: Date.now() - started,
  };
}
