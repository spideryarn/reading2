/**
 * **The evidence a cited work's blurb may be written from — and nothing else.**
 * Plan 261017h stage 3a: docs/plans/261017h-stage-3-design-citation-blurbs.md
 * § 3, as amended by its design review (G6, G9, G10). No model is called here,
 * nothing is stored, and nothing reaches the screen: this is the cascade that
 * says, for each row of a Bibliography, either *here is an abstract we are
 * sure is this work's* or *why there is none*.
 *
 * ```
 * DOI / arXiv id ─► lookupWork (cached; Crossref, DataCite) ─► identity agreed? ─► its abstract
 *        │                                                                      └─ none, and a DOI:
 *        │                                                                         OpenAlex by DOI ─► a reconstruction (never a book or a chapter)
 * title only, imported from a web address ─► one Crossref query.bibliographic ─► the strict rule ─► its abstract
 * ```
 *
 * **The title search is a stated, bounded exception** to src/bibliographic.ts's
 * "identifiers only" (its header says so, and why): at most
 * `MAX_TITLE_SEARCHES` a run, Crossref's polite pool, the shared limiter, and
 * **only when the caller says the article came from a public web address**
 * (G6) — an uploaded file may be a confidential manuscript whose reference list
 * names its authors' unpublished work. The *unpublished* word list below is a
 * second guard, not the claim.
 *
 * **Pure, with its dependencies handed in** (`EvidenceDeps`); the real ones
 * are `citationEvidenceDeps()`. Every row given comes back answered exactly
 * once, as a `RowEvidence`:
 *
 * - `evidence` — the text, where it came from, a link built by code, when it
 *   was read, and its hash. `kind` says whose words they are: the author's
 *   abstract, or OpenAlex's reconstruction of one, which is labelled as such
 *   (the spike's Searle reprint was a reconstruction that said the opposite of
 *   Searle — docs/investigations/261017c-citation-blurbs-cost-and-quality.md).
 * - `no-evidence` — why not. A *registry* negative carries `checkedAt`, and is
 *   worth asking again after `REGISTRY_NEGATIVE_TTL_MS` (G9); a *structural*
 *   one (a label, an unpublished work, no identity to look up) is not.
 * - `transient` — the registry was busy or cooling, OpenAlex refused us, the
 *   run's cap or budget ran out. Never stored; the next run asks again.
 *
 * ## What may be logged from this file
 *
 * Row ids, services, statuses and counts. Never a title, an author or a query:
 * they are the article's characters.
 */

import { createHash } from "node:crypto";

import {
  coolAfter,
  doiFor,
  inServiceTurn,
  list,
  lookupWork,
  parseWorkId,
  plausibleYear,
  record,
  registryAbstract,
  type ServiceLimiter,
  type UnavailableWhy,
  type WorkId,
} from "./bibliographic.js";
import { tokens, surnameOf } from "./citation-lookup.js";
import {
  type LookupWork,
  mapLimited,
  registryFor,
  registryTitleIsDistinctive,
  rowWorkId,
  safeLookup,
  titlesDifferByObjectQualifier,
} from "./citation-registry.js";
import { doiPath, doiUrl } from "./doi-url.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { log as rootLog, type Log } from "./log.js";
import { authorYearLabel } from "./paper-evidence.js";
import { CONTACT_EMAIL } from "./site-text.js";
import type { CitedWork } from "./types.js";

/* ------------------------------------------------------------ the policy -- */

/** At most this many Crossref title queries a run — the bounded exception's bound. */
export const MAX_TITLE_SEARCHES = 60;
/** Identifier lookups in flight at once, and title searches at once, each. */
export const EVIDENCE_CONCURRENCY = 2;
/** After this long no new lookup starts; the rows left are transient. One already started keeps its own bounds. */
export const LOOKUP_BUDGET_MS = 120_000;
/** The most of an abstract a prompt is given. */
export const EVIDENCE_CAP = 2_500;
/** A registry negative is worth asking again after this long: the registry cache's own miss lifetime (G9). */
export const REGISTRY_NEGATIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Bump when what counts as evidence changes, so a stored hash says which rules made it. */
const EVIDENCE_HASH_DOMAIN = "citation-evidence/1";

/** Crossref types a book-looking entry may match (G10). `book-chapter` is not one. */
export const ACCEPTED_BOOK_TYPES = ["book", "monograph", "edited-book", "reference-book"] as const;
/** Crossref types a title search never accepts: a review, a figure or a table, a dataset. */
const REFUSED_TYPES = new Set(["peer-review", "component", "dataset"]);
/** OpenAlex types whose "abstract" is not the cited work's own: a reprint's chapter, a whole book. */
const OPENALEX_REFUSED_TYPES = new Set(["book", "book-chapter"]);

/* ------------------------------------------------------------- the types -- */

export type EvidenceKind = "author-abstract" | "registry-reconstruction";
export type EvidenceSource = "crossref" | "datacite" | "openalex";

export interface Evidence {
  kind: EvidenceKind;
  source: EvidenceSource;
  /** How the work was reached: by the row's own identifier, or by a title search. */
  via: "id" | "title";
  workId: WorkId;
  /** Built by code from `workId`: a doi.org or arxiv.org address, never a registry's or a model's. */
  url: string;
  host: string;
  /** When the text was read, ISO. */
  readAt: string;
  /** The abstract, plain, at most `EVIDENCE_CAP`. */
  text: string;
  /** A hash of the text and where it came from, which an artefact may keep in its place. */
  evidenceHash: string;
}

/** No evidence, for a reason that will not change until the row does. */
export type StructuralWhy =
  /** No DOI or arXiv id, and not a title-only row we may search — or a title too weak, or no author, to search by. */
  | "no-identifier-or-title"
  /** The title is an author–year label ("Zacks et al. (2007)"), which no record is titled. */
  | "label-only"
  /** The entry says the work is unpublished, in preparation, under review, submitted or forthcoming. */
  | "unpublished"
  /** A title-only row in an article not imported from a public web address (G6). */
  | "title-search-off";

/** No evidence, because of what a registry said today; asked again after `REGISTRY_NEGATIVE_TTL_MS` (G9). */
export type RegistryWhy = "not-found" | "no-abstract" | "not-identified" | "conflict";

/** No answer this run, and none stored: the next run asks again. */
export type TransientWhy = UnavailableWhy | "over-budget" | "over-cap" | "openalex-off";

export type RowEvidence =
  | { state: "evidence"; evidence: Evidence }
  | { state: "no-evidence"; why: StructuralWhy }
  | { state: "no-evidence"; why: RegistryWhy; checkedAt: string }
  | { state: "transient"; why: TransientWhy };

/** What the cascade reads of a Bibliography row. */
export type EvidenceRow = Pick<CitedWork, "id" | "title" | "url" | "linkFrom"> &
  Partial<Pick<CitedWork, "authors" | "year" | "entry" | "reference" | "registry">>;

export interface EvidenceOptions {
  /**
   * **True only for an article imported from a public web address** (G6). An
   * uploaded file gets identifier lookups alone.
   */
  titleSearch: boolean;
}

export interface EvidenceDeps {
  lookup: LookupWork;
  fetchJson: (url: string) => Promise<unknown>;
  limiter: ServiceLimiter;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: Log;
  /** Tests shorten it; the step uses `LOOKUP_BUDGET_MS`. */
  lookupBudgetMs?: number;
}

export interface EvidenceCounts {
  rows: number;
  evidence: number;
  /** Every outcome, keyed `state:why` (or `evidence:<kind>`). */
  outcomes: Record<string, number>;
  titleQueries: number;
  openAlexQueries: number;
}

/** The real dependencies: the shared, cached lookup; the allow-listed JSON fetch; the Postgres limiter. */
export async function citationEvidenceDeps(): Promise<EvidenceDeps> {
  return {
    lookup: lookupWork,
    fetchJson: (url) => fetchBibliographicJson(url),
    limiter: (await import("./store/pg-bibliographic.js")).pgBibliographicStore,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
    now: Date.now,
    log: rootLog("pipeline").child({ lookup: "citation-evidence" }),
  };
}

/* ------------------------------------------------------------ the text -- */

/** The opening of `text`, at most `EVIDENCE_CAP`, cut at a word. */
function capped(text: string): string {
  if (text.length <= EVIDENCE_CAP) return text;
  const cut = text.slice(0, EVIDENCE_CAP);
  const atWord = cut.replace(/\s+\S*$/, "");
  return (atWord.length > EVIDENCE_CAP / 2 ? atWord : cut).trimEnd();
}

function arxivUrl(id: WorkId): string {
  return `https://arxiv.org/abs/${id.slice("arxiv:".length)}`;
}

/**
 * **The work's address, built by code from its identifier** — arxiv.org for an
 * arXiv id, doi.org for a DOI. The one builder: for the evidence a note is
 * written from, and for every read that shows the note
 * (src/citation-blurbs-identity.ts § `shownBlurb`), so a stored address is
 * never passed through to a reader.
 */
export function evidenceUrl(workId: WorkId): string {
  return workId.startsWith("arxiv:") ? arxivUrl(workId) : doiUrl(doiFor(workId));
}

function evidenceOf(
  kind: EvidenceKind,
  source: EvidenceSource,
  via: Evidence["via"],
  workId: WorkId,
  readAt: string,
  abstract: string,
): Evidence {
  const url = evidenceUrl(workId);
  const text = capped(abstract);
  const evidenceHash = createHash("sha256")
    .update([EVIDENCE_HASH_DOMAIN, kind, source, workId, text].join("\n"), "utf8")
    .digest("hex")
    .slice(0, 16);
  return { kind, source, via, workId, url, host: new URL(url).hostname, readAt, text, evidenceHash };
}

/**
 * OpenAlex's `abstract_inverted_index` as text — word → positions, back into
 * order. Positions past 2,000 are dropped (OpenAlex's own index is capped near
 * there, and a malformed one must not allocate an enormous array).
 */
export function invertedToText(index: unknown): string | null {
  const words: string[] = [];
  for (const [word, positions] of Object.entries(record(index) ?? {})) {
    for (const p of list(positions)) {
      if (typeof p === "number" && Number.isInteger(p) && p >= 0 && p < 2000) words[p] = word;
    }
  }
  return registryAbstract(words.filter((w) => w !== undefined).join(" "));
}

/* ------------------------------------------------------- the row's shape -- */

/** "A, B, and C (2019)" — the three-or-more-author label `authorYearLabel` does not cover. */
const LABEL_LIST = /^[\p{Lu}][\p{L}'’-]+(?:,\s+[\p{Lu}][\p{L}'’-]+)*,?\s+and\s+[\p{Lu}][\p{L}'’-]+\s+\(\d{4}[a-z]?\)$/u;

function isLabel(title: string): boolean {
  return authorYearLabel(title) !== null || LABEL_LIST.test(title.trim());
}

/** Words that say a work is not (yet) published — a reference a manuscript makes to its authors' own work. */
const UNPUBLISHED = /\b(?:in preparation|under review|submitted|forthcoming|unpublished|personal communication)\b/i;

function saysUnpublished(row: EvidenceRow): boolean {
  return [row.title, row.year, row.entry, row.reference?.quote].some((s) => s !== undefined && UNPUBLISHED.test(s));
}

/** An entry that names a book: an ISBN, a Press, Publishers, Books, or an editor. */
const BOOK_LOOKING = /\bISBN\b|\bPress\b|\bPublishers?\b|\bBooks\b|\((?:Ed|Eds)\.?\)/i;

function looksLikeABook(row: EvidenceRow): boolean {
  return [row.entry, row.reference?.quote].some((s) => s !== undefined && BOOK_LOOKING.test(s));
}

function yearOf(year: string | undefined): number | undefined {
  return plausibleYear(year?.match(/\b\d{4}\b/)?.[0]);
}

/* ------------------------------------------------- the strict title rule -- */

function titleWords(title: string): string {
  return tokens(title.replace(/<[^>]*>/g, " ")).join(" ");
}

/** The part of a title before its first subtitle (": " or "? "), as words. */
function headWords(title: string): string {
  return titleWords(title.split(/[:?]\s/)[0] ?? "");
}

/** Equal once normalised, or one is the other plus a subtitle — and never a correction or another object. */
function titlesAgree(recordTitle: string, workTitle: string): boolean {
  const a = titleWords(recordTitle);
  const b = titleWords(workTitle);
  if (a === "" || b === "") return false;
  if (titlesDifferByObjectQualifier(recordTitle, workTitle)) return false;
  return a === b || headWords(recordTitle) === b || headWords(workTitle) === a;
}

/** Crossref's first author's family name (`sequence: "first"`, else the first listed), or null. */
function crossrefFirstAuthor(item: Record<string, unknown>): string | null {
  const authors = list(item.author).map(record).filter((a) => a !== null);
  const first = authors.find((a) => a.sequence === "first") ?? authors[0];
  const family = first?.family ?? first?.name;
  return typeof family === "string" && family.trim() !== "" ? family : null;
}

function crossrefTitle(item: Record<string, unknown>): string {
  const title = list(item.title)[0];
  const subtitle = list(item.subtitle)[0];
  if (typeof title !== "string") return "";
  return typeof subtitle === "string" && subtitle.trim() !== "" ? `${title}: ${subtitle}` : title;
}

/**
 * **Whether a Crossref search item is this row's work** — the strict rule
 * (design § 3, G10), every clause required:
 *
 * - the titles agree: equal once normalised, or equal up to a subtitle, with no
 *   object qualifier between them (a correction, a reply, a supplement);
 * - **Crossref's first author** has the row's first author's surname — a
 *   second author's agreement is not enough, and neither is the year alone;
 * - the years are within one of each other, when both give one;
 * - the item is not a peer review, a component or a dataset;
 * - an entry that looks like a book matches only a book-type record
 *   (`ACCEPTED_BOOK_TYPES`), never a chapter or an article.
 */
export function crossrefItemIdentifies(raw: unknown, row: EvidenceRow): boolean {
  const item = record(raw);
  if (item === null) return false;
  if (!titlesAgree(crossrefTitle(item), row.title)) return false;
  const surname = surnameOf(row.authors ?? null);
  const first = crossrefFirstAuthor(item);
  if (surname === null || first === null || !tokens(first).includes(surname)) return false;
  const rowYear = yearOf(row.year);
  const itemYear = plausibleYear(list(list(record(item.issued)?.["date-parts"])[0])[0]);
  if (rowYear !== undefined && itemYear !== undefined && Math.abs(rowYear - itemYear) > 1) return false;
  const type = typeof item.type === "string" ? item.type : "";
  if (REFUSED_TYPES.has(type)) return false;
  if (looksLikeABook(row) && !(ACCEPTED_BOOK_TYPES as readonly string[]).includes(type)) return false;
  return true;
}

/** The longest query sent, in characters, cut at a word. */
const MAX_QUERY = 300;

/** The row's title words and its first author's surname, as one line for `query.bibliographic`. */
function titleQuery(row: EvidenceRow, surname: string): string {
  let query = "";
  for (const word of [...tokens(row.title), surname]) {
    const next = query === "" ? word : `${query} ${word}`;
    if (next.length > MAX_QUERY) break;
    query = next;
  }
  return query;
}

export function crossrefSearchUrl(query: string): string {
  const params = new URLSearchParams({
    "query.bibliographic": query,
    rows: "5",
    select: "DOI,title,subtitle,type,abstract,author,issued",
    mailto: CONTACT_EMAIL,
  });
  return `https://api.crossref.org/works?${params.toString()}`;
}

export function openAlexAbstractUrl(doi: string): string {
  return `https://api.openalex.org/works/doi:${doiPath(doi)}?select=display_name,type,abstract_inverted_index&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
}

/* ------------------------------------------------------------ the cascade -- */

/** Which queue a row joins, or its answer already. */
type Route = { kind: "id"; id: WorkId } | { kind: "title"; surname: string } | { kind: "done"; answer: RowEvidence };

function routeOf(row: EvidenceRow, options: EvidenceOptions, checkedAt: string): Route {
  const id = rowWorkId(row);
  if (id !== null) {
    if (row.registry?.kind === "conflict") return { kind: "done", answer: { state: "no-evidence", why: "conflict", checkedAt } };
    return { kind: "id", id };
  }
  if (row.linkFrom !== "search") return { kind: "done", answer: { state: "no-evidence", why: "no-identifier-or-title" } };
  if (saysUnpublished(row)) return { kind: "done", answer: { state: "no-evidence", why: "unpublished" } };
  if (isLabel(row.title)) return { kind: "done", answer: { state: "no-evidence", why: "label-only" } };
  if (!options.titleSearch) return { kind: "done", answer: { state: "no-evidence", why: "title-search-off" } };
  const surname = surnameOf(row.authors ?? null);
  if (!registryTitleIsDistinctive(row.title) || surname === null) {
    return { kind: "done", answer: { state: "no-evidence", why: "no-identifier-or-title" } };
  }
  return { kind: "title", surname };
}

/** The run's state shared by every worker: the OpenAlex breaker and the counts. */
interface Run {
  d: EvidenceDeps;
  checkedAt: () => string;
  openAlexOff: boolean;
  titleQueries: number;
  openAlexQueries: number;
}

function negative(why: RegistryWhy, run: Run): RowEvidence {
  return { state: "no-evidence", why, checkedAt: run.checkedAt() };
}

/** OpenAlex's reconstruction of a confirmed DOI's abstract, or why not. */
async function fromOpenAlex(rowId: string, id: WorkId, run: Run): Promise<RowEvidence> {
  if (run.openAlexOff) return { state: "transient", why: "openalex-off" };
  const { d } = run;
  const doi = doiFor(id);
  run.openAlexQueries++;
  type Got = { kind: "json"; json: unknown } | { kind: "answer"; answer: RowEvidence };
  const turn = await inServiceTurn("openalex", { store: d.limiter, sleep: d.sleep }, async (): Promise<Got> => {
    /* Another row may have tripped the breaker while this one waited for its turn. */
    if (run.openAlexOff) return { kind: "answer", answer: { state: "transient", why: "openalex-off" } };
    try {
      return { kind: "json", json: await d.fetchJson(openAlexAbstractUrl(doi)) };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const status = err.status;
      if (status === 404 || status === 410) return { kind: "answer", answer: negative("no-abstract", run) };
      if (status === 401) {
        /* A key we sent and it refused, or one it now demands: ours to fix, not a busy service. */
        run.openAlexOff = true;
        d.log.error({ row: rowId, service: "openalex", status, outcome: "configuration" }, "citation evidence");
        return { kind: "answer", answer: { state: "transient", why: "openalex-off" } };
      }
      if (status === 403 || status === 429) {
        run.openAlexOff = true;
        await coolAfter(err, "openalex", d.limiter);
        d.log.warn({ row: rowId, service: "openalex", status, outcome: "off-for-run" }, "citation evidence");
        return { kind: "answer", answer: { state: "transient", why: "openalex-off" } };
      }
      const cooldownMs = await coolAfter(err, "openalex", d.limiter);
      d.log.warn({ row: rowId, service: "openalex", status, code: err.code, outcome: cooldownMs !== null ? "cooling-down" : "error" }, "citation evidence");
      return { kind: "answer", answer: { state: "transient", why: cooldownMs !== null ? "cooling-down" : "error" } };
    }
  });
  if (turn.kind === "refused") return { state: "transient", why: turn.why };
  if (turn.value.kind === "answer") return turn.value.answer;
  const work = record(turn.value.json);
  const type = typeof work?.type === "string" ? work.type : "";
  /* A reprint's chapter or a whole book: the "abstract" is somebody's stitching of the text (Searle). */
  if (OPENALEX_REFUSED_TYPES.has(type)) return negative("no-abstract", run);
  const text = invertedToText(work?.abstract_inverted_index);
  if (text === null) return negative("no-abstract", run);
  return { state: "evidence", evidence: evidenceOf("registry-reconstruction", "openalex", "id", id, run.checkedAt(), text) };
}

/** A row with a DOI or arXiv id: the shared lookup, its identity, its abstract — then OpenAlex for a DOI. */
async function byIdentifier(row: EvidenceRow, id: WorkId, run: Run): Promise<RowEvidence> {
  const result = await safeLookup(run.d.lookup, id);
  if (result.kind === "unavailable") return { state: "transient", why: result.why };
  if (result.kind === "not-found") return negative("not-found", run);
  const verdict = registryFor(row, result);
  if (verdict === null) return negative("not-identified", run);
  if (verdict.kind === "conflict") return negative("conflict", run);
  const rec = result.record;
  if (rec.abstract !== undefined) {
    const readAt = rec.abstractReadAt ?? run.checkedAt();
    return { state: "evidence", evidence: evidenceOf("author-abstract", rec.source, "id", id, readAt, rec.abstract) };
  }
  /* arXiv's own DOIs live at DataCite, which already gave what it has. */
  if (id.startsWith("arxiv:") || doiFor(id).startsWith("10.48550/")) return negative("no-abstract", run);
  return await fromOpenAlex(row.id, id, run);
}

/** A title-only row: one Crossref search, the strict rule, the matching item's abstract. */
async function byTitle(row: EvidenceRow, surname: string, run: Run): Promise<RowEvidence> {
  const { d } = run;
  run.titleQueries++;
  type Got = { kind: "json"; json: unknown } | { kind: "transient"; why: TransientWhy };
  const turn = await inServiceTurn("crossref", { store: d.limiter, sleep: d.sleep }, async (): Promise<Got> => {
    try {
      return { kind: "json", json: await d.fetchJson(crossrefSearchUrl(titleQuery(row, surname))) };
    } catch (err) {
      if (!(err instanceof FetchFailure)) throw err;
      const cooldownMs = await coolAfter(err, "crossref", d.limiter);
      d.log.warn(
        { row: row.id, service: "crossref", what: "title-search", status: err.status, code: err.code, outcome: cooldownMs !== null ? "cooling-down" : "error" },
        "citation evidence",
      );
      return { kind: "transient", why: cooldownMs !== null ? "cooling-down" : "error" };
    }
  });
  if (turn.kind === "refused") return { state: "transient", why: turn.why };
  if (turn.value.kind === "transient") return { state: "transient", why: turn.value.why };
  const items = list(record(record(turn.value.json)?.message)?.items);
  for (const raw of items) {
    if (!crossrefItemIdentifies(raw, row)) continue;
    const item = record(raw);
    const id = typeof item?.DOI === "string" ? parseWorkId(item.DOI) : null;
    if (id === null || !id.startsWith("doi:")) continue;
    const abstract = registryAbstract(item?.abstract);
    if (abstract === null) return negative("no-abstract", run);
    return { state: "evidence", evidence: evidenceOf("author-abstract", "crossref", "title", id, run.checkedAt(), abstract) };
  }
  return negative("not-found", run);
}

/** One worker's call, with a throw from a dependency read as a transient error rather than a lost run. */
async function guarded(rowId: string, run: Run, ask: () => Promise<RowEvidence>): Promise<RowEvidence> {
  try {
    return await ask();
  } catch (err) {
    run.d.log.warn({ row: rowId, outcome: "error", err: err instanceof Error ? err.name : typeof err }, "citation evidence");
    return { state: "transient", why: "error" };
  }
}

function outcomeKey(answer: RowEvidence): string {
  return answer.state === "evidence"
    ? `evidence:${answer.evidence.kind}`
    : answer.state === "no-evidence"
      ? `no-evidence:${answer.why}`
      : `transient:${answer.why}`;
}

/**
 * **The evidence for every row, by entry id** — each row answered once.
 * Identifier lookups and title searches run as two queues of
 * `EVIDENCE_CONCURRENCY` side by side; neither starts anything after the
 * budget, and title searches stop at `MAX_TITLE_SEARCHES`, in list order.
 */
export async function collectEvidence(
  rows: readonly EvidenceRow[],
  options: EvidenceOptions,
  d: EvidenceDeps,
): Promise<{ byEntry: Map<string, RowEvidence>; counts: EvidenceCounts }> {
  const started = d.now();
  const budget = d.lookupBudgetMs ?? LOOKUP_BUDGET_MS;
  const run: Run = {
    d,
    checkedAt: () => new Date(d.now()).toISOString(),
    openAlexOff: false,
    titleQueries: 0,
    openAlexQueries: 0,
  };
  const byEntry = new Map<string, RowEvidence>();
  const ids: { row: EvidenceRow; id: WorkId }[] = [];
  const titles: { row: EvidenceRow; surname: string }[] = [];
  for (const row of rows) {
    const route = routeOf(row, options, run.checkedAt());
    if (route.kind === "done") byEntry.set(row.id, route.answer);
    else if (route.kind === "id") ids.push({ row, id: route.id });
    else if (titles.length < MAX_TITLE_SEARCHES) titles.push({ row, surname: route.surname });
    else byEntry.set(row.id, { state: "transient", why: "over-cap" });
  }
  const mayStart = () => d.now() - started < budget;
  const [byId, byTitles] = await Promise.all([
    mapLimited(ids, EVIDENCE_CONCURRENCY, ({ row, id }) => guarded(row.id, run, () => byIdentifier(row, id, run)), mayStart),
    mapLimited(titles, EVIDENCE_CONCURRENCY, ({ row, surname }) => guarded(row.id, run, () => byTitle(row, surname, run)), mayStart),
  ]);
  /* A row the budget did not start has no value: transient, asked next run. */
  for (const [queue, done] of [[ids, byId], [titles, byTitles]] as const) {
    for (const [i, { row }] of queue.entries()) {
      byEntry.set(row.id, done.values[i] ?? { state: "transient", why: "over-budget" });
    }
  }

  const outcomes: Record<string, number> = {};
  let evidence = 0;
  for (const answer of byEntry.values()) {
    const key = outcomeKey(answer);
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    if (answer.state === "evidence") evidence++;
  }
  const counts: EvidenceCounts = {
    rows: rows.length,
    evidence,
    outcomes,
    titleQueries: run.titleQueries,
    openAlexQueries: run.openAlexQueries,
  };
  d.log.info({ ...counts, ms: d.now() - started, titleSearch: options.titleSearch }, "citation evidence");
  return { byEntry, counts };
}
