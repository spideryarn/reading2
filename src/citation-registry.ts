/**
 * **Bibliography rows carry the registry's record** — plan 261001a stage 5
 * (docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md).
 *
 * At the end of the `bibliography` step, every row whose link is a DOI or arXiv
 * address is looked up through stage 1's `lookupWork` (src/bibliographic.ts) —
 * at most `MAX_REGISTRY_LOOKUPS`, two at a time, the cache first because
 * `lookupWork` reads it first. What it may add, and nothing else:
 *
 * - **`found`** — the registry's record names the article's work, by stage 2's
 *   rule (`registryIdentifiesCitation`, src/paper-evidence.ts: the titles agree,
 *   or an author–year label's author and year match and the article's own
 *   reference entry also contains the registry title), and its title is
 *   distinctive enough to establish identity, so a mistyped DOI cannot lend a
 *   row somebody else's authors;
 * - **`conflict`** — it does not: the article's identifier points at a
 *   different work, and the row says so;
 * - **nothing** — not found, unavailable, ambiguous, over the cap or time
 *   budget, or the lookup threw. The step never fails because of a registry.
 *
 * **Not in the step's stamp, and not in what the model is sent.** The record is
 * attached after the list is built, so `sourceHash` and `PROMPT_VERSION` mean
 * what they meant; a registry answering differently next month is not the
 * article moving. A re-run's lookups are cache hits — one database read each.
 * New work stops starting after one minute; two already-started calls finish
 * under `lookupWork`'s own bounds.
 *
 * Logged by the caller as counts only: no identifier, no title.
 */
import { doiFor, lookupWork, parseWorkId, type LookupResult, type WorkId, type WorkRecord } from "./bibliographic.js";
import { tokens } from "./citation-lookup.js";
import { registryIdentifiesCitation } from "./paper-evidence.js";
import { registryWorkOf } from "./registry-work.js";
import type { CitationRegistry, Bibliography, CitedWork } from "./types.js";

/** At most this many rows are looked up per run — `MAX_CITATIONS` today, named so a raise there does not raise this. */
export const MAX_REGISTRY_LOOKUPS = 80;
/** Lookups in flight at once. `lookupWork`'s own limiter is global; this only keeps one step from queueing on it. */
export const REGISTRY_CONCURRENCY = 2;
/** Stop starting new registry work after this long. An already-started `lookupWork` keeps its own shorter bounds. */
export const REGISTRY_LOOKUP_BUDGET_MS = 60_000;

export type LookupWork = (id: WorkId) => Promise<LookupResult>;

export interface RegistryDeps {
  lookup: LookupWork;
  /** Tests can make the run budget deterministic without waiting. */
  now?: () => number;
  lookupBudgetMs?: number;
}

/** The real registry — what src/pipeline.ts hands the step. A test checks it is `lookupWork` itself. */
export const citationRegistryDeps: RegistryDeps = { lookup: lookupWork };

export interface RegistryCounts {
  /** Rows whose link is a DOI or arXiv address. */
  identified: number;
  asked: number;
  found: number;
  /** Found rows that carry Crossref's citation count (plan 261005i). A subset of `found`. */
  counted: number;
  conflict: number;
  notFound: number;
  unavailable: number;
  /** A found record whose title was too weak to establish identity. */
  unconfirmed: number;
  /** Identified rows past `MAX_REGISTRY_LOOKUPS`, not asked. */
  overCap: number;
  /** Identified rows inside the cap that the run's wall-time budget did not start. */
  overBudget: number;
}

/**
 * The identifier a row's **link** is — a `doi.org` or `arxiv.org` address — or
 * null. A Scholar search or any other address is null by `parseWorkId`'s
 * host rule; a `web` row is the owner's private find and is never stored, but
 * is refused here too.
 */
export function rowWorkId(work: Pick<CitedWork, "url" | "linkFrom">): WorkId | null {
  if (work.linkFrom === "web" || work.linkFrom === "search") return null;
  return parseWorkId(work.url);
}

/** Words that do not make a short title identify one work rather than a class of pages. */
const GENERIC_TITLE_WORDS = new Set([
  "the", "and", "for", "from", "with", "into", "about", "introduction", "editorial", "commentary",
  "preface", "foreword", "letter", "reply", "response", "correction", "erratum", "errata", "retraction",
  "addendum", "chapter", "supplement", "supplementary", "supporting", "information", "material", "materials",
]);

/** Tails that turn a shared opening title into a different object, not a subtitle or a site name. */
const DIFFERENT_OBJECT_WORDS = new Set([
  "correction", "corrigendum", "erratum", "errata", "retraction", "addendum", "comment", "commentary", "reply",
  "response", "supplement", "supplementary", "supporting", "figure", "figures", "table", "tables", "dataset",
  "appendix", "chapter",
]);

function titleTokens(title: string): string[] {
  return tokens(title.replace(/<[^>]*>/g, " "));
}

/**
 * A title strong enough to corroborate an identifier on its own. Exact
 * "Introduction" or "Editorial" is not identity evidence: many unrelated
 * records have it. Three words and two non-generic words keeps concise titles
 * such as "Dreams and memory" while failing closed on those labels.
 */
export function registryTitleIsDistinctive(title: string): boolean {
  const words = titleTokens(title);
  const distinctive = words.filter((word) => word.length >= 3 && !GENERIC_TITLE_WORDS.has(word));
  return words.length >= 3 && distinctive.length >= 2;
}

/** A supplement/correction can begin with the parent work's whole title and still be another object. */
export function titlesDifferByObjectQualifier(a: string, b: string): boolean {
  const one = titleTokens(a);
  const two = titleTokens(b);
  const tail =
    one.length < two.length && one.every((word, i) => two[i] === word)
      ? two.slice(one.length)
      : two.length < one.length && two.every((word, i) => one[i] === word)
        ? one.slice(two.length)
        : [];
  return tail.some((word) => DIFFERENT_OBJECT_WORDS.has(word));
}

/**
 * **A confirmed record as the row keeps it, with Crossref's citation count
 * when it gave one** (plan 261005i). Only here, on the `found` verdict: a
 * conflict's record is a different work and its count is not this row's.
 * Only from Crossref, and only with the moment it was read, because the row
 * names both.
 */
function foundFor(record: WorkRecord): Extract<CitationRegistry, { kind: "found" }> {
  const { citedByCount: count, citedByCountReadAt: readAt } = record;
  const citedBy = record.source === "crossref" && count !== undefined && readAt !== undefined ? { count, readAt } : null;
  return { kind: "found", ...registryWorkOf(record), ...(citedBy !== null ? { citedBy } : {}) };
}

/** What one answer puts on the row, judged against the article's own title. */
export function registryFor(
  work: Pick<CitedWork, "title" | "year" | "reference" | "entry">,
  result: LookupResult,
): CitationRegistry | null {
  if (result.kind !== "found") return null;
  const agreed = registryIdentifiesCitation(result.record, {
    title: work.title,
    ...(work.year !== undefined ? { year: work.year } : {}),
    reference: work.entry ?? work.reference?.quote ?? null,
  });
  if (agreed === null) return { kind: "conflict", source: result.record.source };
  if (agreed === "label-unconfirmed") return null;
  /* An author–year label has no words to be weak or qualified: the record's
     first author and year matched it, and the record's own title must still
     be distinctive enough to lend the row. */
  if (agreed === "label") {
    return registryTitleIsDistinctive(result.record.title) ? foundFor(result.record) : null;
  }
  /* A weak exact title is not a disagreement, so it gets no alarming conflict
     message; it is simply not enough evidence to lend metadata to the row. */
  if (!registryTitleIsDistinctive(work.title) || !registryTitleIsDistinctive(result.record.title)) return null;
  if (titlesDifferByObjectQualifier(work.title, result.record.title)) {
    return { kind: "conflict", source: result.record.source };
  }
  return foundFor(result.record);
}

/** `items` through `fn`, at most `limit` at a time, while `mayStart` remains true. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  mayStart: () => boolean = () => true,
): Promise<{ values: (R | undefined)[]; started: number }> {
  const out: (R | undefined)[] = Array.from({ length: items.length }, () => undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length && mayStart()) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { values: out, started: next };
}

/** `lookup`, with a throw (which `lookupWork` does not do, but a dependency may) read as unavailable. */
export async function safeLookup(lookup: LookupWork, id: WorkId): Promise<LookupResult> {
  try {
    const answer = await lookup(id);
    /* `lookupWork` constructs these fields from the requested id. Keep the
       caller safe if a replacement dependency or corrupt cache does not: a
       same-title answer under another DOI is still another record. */
    if (
      answer.kind === "found" &&
      (answer.record.id !== id || answer.record.doi.toLowerCase() !== doiFor(id).toLowerCase())
    ) {
      return { kind: "unavailable", why: "error" };
    }
    return answer;
  } catch {
    return { kind: "unavailable", why: "error" };
  }
}

/**
 * **The list with each identified row's registry field set** — or cleared: a
 * row's `registry` is this run's answer, never an earlier revision's. Rows are
 * asked in list order, so the cap keeps the first eighty.
 */
export async function attachCitationRegistry(
  bibliography: Bibliography,
  deps: RegistryDeps,
): Promise<{ bibliography: Bibliography; counts: RegistryCounts }> {
  const counts: RegistryCounts = {
    identified: 0,
    asked: 0,
    found: 0,
    counted: 0,
    conflict: 0,
    notFound: 0,
    unavailable: 0,
    unconfirmed: 0,
    overCap: 0,
    overBudget: 0,
  };
  const ids = bibliography.citations.map((work) => rowWorkId(work));
  const distinct: WorkId[] = [];
  for (const id of ids) {
    if (id === null) continue;
    counts.identified++;
    if (!distinct.includes(id)) distinct.push(id);
  }
  const asked = distinct.slice(0, MAX_REGISTRY_LOOKUPS);
  const withinCap = new Set(asked);
  const answers = new Map<WorkId, LookupResult>();
  const now = deps.now ?? Date.now;
  const began = now();
  const results = await mapLimited(
    asked,
    REGISTRY_CONCURRENCY,
    (id) => safeLookup(deps.lookup, id),
    () => now() - began < (deps.lookupBudgetMs ?? REGISTRY_LOOKUP_BUDGET_MS),
  );
  for (const [i, id] of asked.entries()) {
    const answer = results.values[i];
    if (answer !== undefined) answers.set(id, answer);
  }
  counts.asked = results.started;

  const rows = bibliography.citations.map((work, i): CitedWork => {
    const { registry: _previous, ...rest } = work;
    const id = ids[i];
    if (id === null || id === undefined) return rest;
    const answer = answers.get(id);
    if (answer === undefined) {
      if (withinCap.has(id)) counts.overBudget++;
      else counts.overCap++;
      return rest;
    }
    if (answer.kind === "not-found") counts.notFound++;
    if (answer.kind === "unavailable") counts.unavailable++;
    const registry = registryFor(work, answer);
    if (registry === null) {
      if (answer.kind === "found") counts.unconfirmed++;
      return rest;
    }
    counts[registry.kind]++;
    if (registry.kind === "found" && registry.citedBy !== undefined) counts.counted++;
    return { ...rest, registry };
  });
  return { bibliography: { ...bibliography, citations: rows }, counts };
}
