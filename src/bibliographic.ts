/**
 * **One bibliographic lookup, polite across every instance.** Given a DOI or an
 * arXiv id, what Crossref or DataCite says the work is: its title, authors, year
 * and venue. Stage 1 of
 * docs/plans/261001a-citations-read-the-cited-paper-and-a-shared-bibliographic-lookup.md,
 * which has the diagram this file follows:
 *
 * ```
 * cache → claim → a service slot and a start → arXiv id: DataCite (10.48550/arxiv.<id>)
 *                                              DOI: Crossref, and on a 404 DataCite
 * ```
 *
 * **Identifiers only, never a title search** (Greg's "don't abuse them"). Where
 * an identifier came from, and whether the record agrees with what the caller
 * already knows, is the caller's business — a DOI an article typed wrongly
 * resolves perfectly to the wrong paper, so every caller checks the title.
 *
 * **The politeness lives in the database**, not in this process: the cache
 * (`bibliographic_records`), a per-identifier claim so two callers make one
 * request, globally spaced starts and leased slots per service, and a shared
 * cooldown after a 429 or 503 (src/store/pg-bibliographic.ts). Many server
 * instances each holding their own limiter would multiply it (GPT Sol, P-4).
 *
 * **An error stores nothing.** Only a found record (fresh 180 days) and a
 * not-found (7 days) are remembered; anything else is `unavailable`, and the
 * next caller may ask again — unless the service told us to wait, which every
 * caller then honours.
 *
 * **A Crossref record also carries Crossref's citation count and the moment it
 * was read** (plan 261005i), for the Citations row. A record cached before the
 * count was kept is asked about once more, by any caller, and a failed ask
 * leaves it due again: so during a Crossref outage such a record is
 * `unavailable` to every caller until one ask succeeds.
 *
 * Nothing calls this from a route or a step yet: stages 3, 5 and 6 of the plan
 * are the callers.
 */

import { ARXIV_ID_SHAPE, DOI_SHAPE, identityOf } from "./cited-in-spideryarn.js";
import { doiPath } from "./doi-url.js";
import { FetchFailure, fetchBibliographicJson } from "./fetch.js";
import { errorFields, log, type Log } from "./log.js";
import { isCitedByCount } from "./registry-work.js";
import { CONTACT_EMAIL } from "./site-text.js";

/* ------------------------------------------------------------ the types -- */

/**
 * `doi:<lower-cased doi>` or `arxiv:<lower-cased id, no version>` — the same
 * spelling `keysOf` in src/citations.ts gives a work's `idKey`, so a Citations
 * row's key is already a `WorkId` once it has been through `parseWorkId`.
 *
 * Branded, so a string that has not been parsed cannot reach `lookupWork` — a
 * malformed identifier is refused by the compiler before it can be refused at
 * run time (which `lookupWork` also does).
 */
export type WorkId = string & { readonly __workId: true };

export type Registry = "crossref" | "datacite";

/**
 * **Every outside service the shared limiter paces** — the two registries, and
 * OpenAlex, the citation index src/citation-index.ts asks. A separate union
 * from `Registry` on purpose: `Registry` is also a record's provenance
 * (`WorkRecord.source`, and the `source` CHECK on `bibliographic_records`), and
 * OpenAlex is never that (GPT Sol's F7 on plan 261004h).
 */
export type LimiterService = Registry | "openalex";

export interface WorkAuthor {
  family: string;
  given?: string;
}

/** What a registry says a work is. */
export interface WorkRecord {
  id: WorkId;
  source: Registry;
  title: string;
  authors: WorkAuthor[];
  year?: number;
  venue?: string;
  /**
   * The calendar day the registry says the work was published, `YYYY-MM-DD` —
   * only when it states a whole day. Crossref often gives a year or a month
   * alone, and DataCite a year; a day made up from those would be a date
   * nobody stated. Absent on an answer cached before 2026-10-04.
   */
  published?: string;
  /** The DOI the registry holds the record under — for an arXiv id, `10.48550/arxiv.<id>`. */
  doi: string;
  /**
   * **Crossref's `is-referenced-by-count`**: how many works Crossref holds that
   * cite this one. Only ever on a Crossref record, and only a whole number
   * `isCitedByCount` accepts. It counts citations from works whose publishers
   * deposit their reference lists, so it runs lower than Google Scholar's.
   * DataCite's count is not kept (plan 261005i § Passed over).
   */
  citedByCount?: number;
  /**
   * **When Crossref was asked for that count**, ISO, by the store's clock: on
   * every Crossref record `lookupWork` returns, count or no count, because
   * "asked, and there was none" is a different thing from "never asked". The
   * parser never sets it; `withCountReadAt` does, from the moment the answer
   * was stored. Absent on a DataCite record.
   */
  citedByCountReadAt?: string;
}

/**
 * Why there is no answer this time — none of which is remembered.
 *
 * - `cooling-down` — a service told us (by a 429 or 503) to stop for a while.
 * - `busy` — no slot, or no start, within 3 s: our own limiter said not now.
 * - `in-flight` — another caller is asking about this identifier and had not
 *   answered within 2 s.
 * - `error` — the request failed some other way (timeout, 5xx, bad JSON).
 * - `store` — the database failed; logged as an error.
 */
export type UnavailableWhy = "cooling-down" | "busy" | "in-flight" | "error" | "store";

export type LookupResult =
  | { kind: "found"; record: WorkRecord }
  | { kind: "not-found" }
  | { kind: "unavailable"; why: UnavailableWhy };

/** What is remembered: an answer, never an error. */
export type CachedAnswer = { kind: "found"; record: WorkRecord } | { kind: "not-found" };

/**
 * **An answer as the store keeps it, given the moment it was stored**: a
 * Crossref record says that is when its count was read; a DataCite record and
 * a miss say nothing. The one place that rule is written for a store kept in
 * memory and for what `lookupWork` returns from a write; the Postgres store
 * says the same thing in its `write` statement.
 */
export function withCountReadAt<A extends CachedAnswer>(answer: A, storedAt: Date): A {
  if (answer.kind !== "found" || answer.record.source !== "crossref") return answer;
  return { ...answer, record: { ...answer.record, citedByCountReadAt: storedAt.toISOString() } };
}

/* ------------------------------------------------------------ the policy -- */

/** How long an answer is an answer. A found record changes rarely; a miss may be a DOI registered next week. */
export const FRESH_FOUND_MS = 180 * 24 * 60 * 60 * 1000;
export const FRESH_NOT_FOUND_MS = 7 * 24 * 60 * 60 * 1000;

export interface Freshness {
  foundMs: number;
  notFoundMs: number;
}

export const FRESHNESS: Freshness = { foundMs: FRESH_FOUND_MS, notFoundMs: FRESH_NOT_FOUND_MS };

/**
 * **How long a claim on an identifier lasts: 45 s, not the plan's 20.** The
 * worst honest path is a DOI that Crossref does not hold: up to 3 s for a slot,
 * 3 s for a start and 8 s for the request, twice — 28 s. A claim that lapsed
 * mid-lookup would let a second caller ask too. The extra margin covers
 * database and event-loop delay around those network deadlines; a dead process
 * costs the identifier 45 s of `in-flight`, nothing more.
 */
export const CLAIM_LEASE_MS = 45_000;
/** How long a caller waits on somebody else's claim before saying `in-flight`. */
export const CLAIM_WAIT_MS = 2_000;
/** A slot's lease: the 3 s start wait plus the 8 s request and a margin for a busy event loop. */
export const SLOT_LEASE_MS = 20_000;
/** How long to wait for a slot, and how far ahead a start may be, before giving up as `busy`. */
export const MAX_WAIT_MS = 3_000;
const POLL_MS = 100;

/**
 * Starts spaced globally: **Crossref 250 ms (4/s, under its 10), DataCite
 * 500 ms (2/s, under its 1,000 per 5 minutes), OpenAlex 500 ms (2/s, under its
 * 10)**. Slots: 2, 1 and 1, seeded by the migrations — they are rows, not
 * numbers here.
 */
export const SPACING_MS: Record<LimiterService, number> = { crossref: 250, datacite: 500, openalex: 500 };

/** A 429 or 503 without `Retry-After` cools the service this long; one with it, at most an hour. */
export const DEFAULT_COOLDOWN_MS = 60_000;
export const MAX_COOLDOWN_MS = 60 * 60 * 1000;

/* ------------------------------------------------------------ the store -- */

/** A claim on an identifier, fenced by the exact moment it runs out. */
export interface IdentifierClaim {
  id: WorkId;
  until: Date;
}

export interface SlotLease {
  service: LimiterService;
  slot: number;
  until: Date;
}

export type StartTaken = { kind: "start"; waitMs: number } | { kind: "cooling-down" } | { kind: "busy" };

/**
 * What `lookupWork` needs from the database. src/store/pg-bibliographic.ts is
 * the real one; tests may hand in their own.
 */
export interface BibliographicStore {
  /** A fresh answer if there is one, and whether somebody holds a live claim. */
  read(id: WorkId, fresh: Freshness): Promise<{ answer: CachedAnswer | null; claimed: boolean }>;
  /** Claim the identifier, unless somebody holds a live claim or a fresh answer has arrived. */
  claim(id: WorkId, fresh: Freshness, leaseMs: number): Promise<IdentifierClaim | null>;
  /** Give a claim back with nothing learned. Only this claim: a later one is left alone. */
  release(claim: IdentifierClaim): Promise<void>;
  /**
   * Remember an answer and clear the claim, only while this exact claim still
   * owns the row. **The moment it was stored, by the store's clock, for every
   * answer** (a DataCite record and a miss included), or null when the claim
   * was lost and nothing was written. A Crossref record is kept with that
   * moment as its `citedByCountReadAt`.
   */
  write(claim: IdentifierClaim, answer: CachedAnswer): Promise<Date | null>;
  /** Whether the service is cooling down right now. */
  coolingDown(service: LimiterService): Promise<boolean>;
  takeSlot(service: LimiterService, leaseMs: number): Promise<SlotLease | null>;
  freeSlot(lease: SlotLease): Promise<void>;
  /** Take the next start, unless the service is cooling down or the start is more than `maxWaitMs` away. */
  takeStart(service: LimiterService, spacingMs: number, maxWaitMs: number): Promise<StartTaken>;
  /** Nobody asks `service` again for `forMs`. Never shortens a cooldown already set. */
  coolDown(service: LimiterService, forMs: number): Promise<void>;
}

/** The limiter's half of the store: what one polite request needs, and nothing about the record cache. */
export type ServiceLimiter = Pick<
  BibliographicStore,
  "coolingDown" | "takeSlot" | "freeSlot" | "takeStart" | "coolDown"
>;

export interface LookupDeps {
  store?: BibliographicStore;
  fetchJson?: (url: string) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
}

/* ------------------------------------------------------- the identifier -- */

/** DOIs are case-insensitive and in practice ASCII; anything else is refused rather than guessed. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const MAX_ID_LENGTH = 300;

/**
 * A publisher's page suffix glued onto a DOI by a copied address —
 * `10.1101/2020.06.26.174482v2.full.pdf` from bioRxiv, `….1.full` from a
 * journal. Neither registry knows those spellings (both 404'd in the 261001a
 * probe). Only the two observed publisher shapes are rewritten. DOI suffixes
 * are opaque, so a generic DOI ending `.pdf`, `.full` or `v2` is left alone.
 * A wrong strip is still caught downstream, where the registry's title must
 * agree with the citation's.
 */
const BIORXIV_STEM = "10\\.1101\\/(?:\\d{4}\\.\\d{2}\\.\\d{2}\\.)?\\d+";
const BIORXIV_PAGE = new RegExp(`^(${BIORXIV_STEM})(?:v\\d+)?\\.(?:full\\.pdf|full-text|full|abstract|short|pdf)$`, "i");
const BIORXIV_VERSION = new RegExp(`^(${BIORXIV_STEM})v\\d+$`, "i");
/* BioOne's observed article route. Keep this narrow: a DOI suffix is opaque,
   so a generic `.full`/`.pdf` rule can silently rewrite a real DOI. */
const BIOONE_PAGE = /^(10\.1636\/[a-z]+(?:-[a-z]+)*-\d{2}-\d{3}\.\d+)\.(?:full(?:\.pdf)?|abstract|short|pdf)$/i;

function withoutPageSuffix(doi: string): string {
  return doi.replace(BIORXIV_PAGE, "$1").replace(BIORXIV_VERSION, "$1").replace(BIOONE_PAGE, "$1");
}

function doiId(raw: string): WorkId | null {
  const doi = withoutPageSuffix(raw);
  const m = DOI_SHAPE.exec(doi);
  if (!m?.[1] || !PRINTABLE_ASCII.test(m[1])) return null;
  const id = `doi:${m[1].toLowerCase()}`;
  return id.length <= MAX_ID_LENGTH ? (id as WorkId) : null;
}

function arxivId(arxiv: string): WorkId | null {
  const m = ARXIV_ID_SHAPE.exec(arxiv);
  return m?.[1] ? (`arxiv:${m[1].toLowerCase()}` as WorkId) : null;
}

/**
 * A DOI or arXiv id in any of the spellings a caller holds, as a `WorkId` — or
 * null. Accepts `doi:10.…`, a bare `10.…`, a `doi.org` address, `arxiv:…`, a
 * bare arXiv id (either shape, any version) and an `arxiv.org` abs/pdf address.
 * The address forms go through `identityOf` (src/cited-in-spideryarn.ts), the
 * one parser of an identifier out of an address.
 */
export function parseWorkId(input: string): WorkId | null {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) {
    const found = identityOf(s);
    if (found.doi !== undefined) return doiId(found.doi);
    if (found.arxiv !== undefined) return arxivId(found.arxiv);
    return null;
  }
  const prefixed = /^(doi|arxiv):\s*(.+)$/i.exec(s);
  if (prefixed?.[1] && prefixed[2]) {
    return prefixed[1].toLowerCase() === "doi" ? doiId(prefixed[2]) : arxivId(prefixed[2]);
  }
  return doiId(s) ?? arxivId(s);
}

/** The DOI a lookup asks a registry about: the DOI itself, or arXiv's own at DataCite. */
export function doiFor(id: WorkId): string {
  if (id.startsWith("doi:")) return id.slice("doi:".length);
  return `10.48550/arxiv.${id.slice("arxiv:".length)}`;
}

export function crossrefUrl(doi: string): string {
  return `https://api.crossref.org/works/${doiPath(doi)}?mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
}

export function dataciteUrl(doi: string): string {
  return `https://api.datacite.org/dois/${doiPath(doi)}`;
}

/* ------------------------------------------------------------ parsing -- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/**
 * A registry string as plain text: markup stripped (Crossref titles carry
 * `<i>`, `<sub>` and sometimes MathML), the common entities decoded, whitespace
 * collapsed. Null when nothing is left.
 */
export function plainRegistryText(value: unknown, maxLength = 1000): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === "#") {
        const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return text.length > maxLength ? text.slice(0, maxLength).trimEnd() : text;
}

export function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function plausibleYear(value: unknown): number | undefined {
  const n = typeof value === "string" && /^\d{4}$/.test(value.trim()) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 1500 && n <= 2100 ? n : undefined;
}

/** Crossref's `{ "date-parts": [[2016, 5, 16]] }`, as a year. `[[null]]` happens. */
function crossrefYear(date: unknown): number | undefined {
  return plausibleYear(list(list(record(date)?.["date-parts"])[0])[0]);
}

/** `s` when it is a real calendar day spelled `YYYY-MM-DD`, else undefined. `2024-02-31` has the shape and is not one. */
export function realIsoDay(s: unknown): string | undefined {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  if (plausibleYear(Number(s.slice(0, 4))) === undefined) return undefined;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().startsWith(`${s}T`) ? s : undefined;
}

/** Crossref's `{ "date-parts": [[2016, 5, 16]] }`, as a day — only when all three parts are there. */
function crossrefDay(date: unknown): string | undefined {
  const [y, m, d] = list(list(record(date)?.["date-parts"])[0]);
  if (![y, m, d].every((n) => typeof n === "number" && Number.isInteger(n))) return undefined;
  const two = (n: unknown) => String(n).padStart(2, "0");
  return realIsoDay(`${String(y).padStart(4, "0")}-${two(m)}-${two(d)}`);
}

const MAX_AUTHORS = 100;
const MAX_NAME = 200;

function author(family: unknown, given: unknown): WorkAuthor | null {
  const f = plainRegistryText(family, MAX_NAME);
  if (f === null) return null;
  const g = plainRegistryText(given, MAX_NAME);
  return g === null ? { family: f } : { family: f, given: g };
}

function normaliseDoi(value: unknown, fallback: string): string {
  return typeof value === "string" && DOI_SHAPE.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

/**
 * Crossref's `/works/{doi}` answer as a record — or null when it has no title,
 * which no caller could check a citation against.
 */
export function parseCrossref(id: WorkId, doi: string, json: unknown): WorkRecord | null {
  const msg = record(record(json)?.message);
  if (msg === null) return null;
  const title = plainRegistryText(list(msg.title)[0]);
  if (title === null) return null;
  const authors: WorkAuthor[] = [];
  for (const raw of list(msg.author)) {
    const a = record(raw);
    if (a === null) continue;
    /* An organisation comes as `name` with no family: it is its own family. */
    const one = a.family !== undefined ? author(a.family, a.given) : author(a.name, undefined);
    if (one !== null) authors.push(one);
    if (authors.length === MAX_AUTHORS) break;
  }
  const year =
    crossrefYear(msg.issued) ??
    crossrefYear(msg["published-print"]) ??
    crossrefYear(msg["published-online"]) ??
    crossrefYear(msg.published);
  const venue = plainRegistryText(list(msg["container-title"])[0]);
  /* The earliest whole day any of the four states: online usually precedes
     print, and `issued` is Crossref's own earliest but often lacks the day. */
  const published = [msg["published-online"], msg["published-print"], msg.published, msg.issued]
    .map(crossrefDay)
    .filter((day) => day !== undefined)
    .sort()[0];
  /* Anything but a whole number the column can hold is no count, and the
     record is still an answer (plan 261005i, GPT Sol's F3). */
  const citedByCount = msg["is-referenced-by-count"];
  return {
    id,
    source: "crossref",
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue !== null ? { venue } : {}),
    ...(published !== undefined ? { published } : {}),
    doi: normaliseDoi(msg.DOI, doi),
    ...(isCitedByCount(citedByCount) ? { citedByCount } : {}),
  };
}

/**
 * DataCite's `/dois/{doi}` answer as a record — or null without a title.
 *
 * The main title is the one with no `titleType` (the others are subtitles and
 * translations), falling back to the first. A creator is `familyName` /
 * `givenName` where DataCite split it; otherwise its `name`, split at the comma
 * only for a `Personal` name written `Family, Given`, and whole for an
 * organisation.
 */
export function parseDatacite(id: WorkId, doi: string, json: unknown): WorkRecord | null {
  const attrs = record(record(record(json)?.data)?.attributes);
  if (attrs === null) return null;
  const titles = list(attrs.titles).map(record).filter((t) => t !== null);
  const main = titles.find((t) => t.titleType === undefined || t.titleType === null) ?? titles[0];
  const title = plainRegistryText(main?.title);
  if (title === null) return null;
  const authors: WorkAuthor[] = [];
  for (const raw of list(attrs.creators)) {
    const c = record(raw);
    if (c === null) continue;
    let one: WorkAuthor | null;
    if (typeof c.familyName === "string" && c.familyName.trim() !== "") {
      one = author(c.familyName, c.givenName);
    } else if (c.nameType === "Personal" && typeof c.name === "string" && c.name.includes(",")) {
      const [family, ...given] = c.name.split(",");
      one = author(family, given.join(","));
    } else {
      one = author(c.name, undefined);
    }
    if (one !== null) authors.push(one);
    if (authors.length === MAX_AUTHORS) break;
  }
  const year = plausibleYear(attrs.publicationYear);
  const publisher = attrs.publisher;
  const venue =
    plainRegistryText(record(attrs.container)?.title) ??
    plainRegistryText(typeof publisher === "string" ? publisher : record(publisher)?.name);
  return {
    id,
    source: "datacite",
    title,
    authors,
    ...(year !== undefined ? { year } : {}),
    ...(venue !== null ? { venue } : {}),
    doi: normaliseDoi(attrs.doi, doi),
  };
}

/* ------------------------------------------------------------ the lookup -- */

type Asked = CachedAnswer | { kind: "unavailable"; why: UnavailableWhy };

interface Resolved {
  store: BibliographicStore;
  fetchJson: (url: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  log: Log;
}

async function resolveDeps(deps: LookupDeps): Promise<Resolved> {
  /* The Postgres store is loaded only when nobody handed one in, so a test of
     the parsing or the orchestration never opens a database connection. */
  const store = deps.store ?? (await import("./store/pg-bibliographic.js")).pgBibliographicStore;
  return {
    store,
    fetchJson: deps.fetchJson ?? ((url) => fetchBibliographicJson(url)),
    sleep: deps.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    log: deps.log ?? log("pipeline").child({ lookup: "bibliographic" }),
  };
}

/** What a turn needs: the limiter, and a way to wait. */
export interface TurnDeps {
  store: ServiceLimiter;
  sleep: (ms: number) => Promise<void>;
}

/** A service slot, polled for up to `MAX_WAIT_MS`. */
async function slotFor(service: LimiterService, d: TurnDeps): Promise<SlotLease | null> {
  for (let waited = 0; ; waited += POLL_MS) {
    const lease = await d.store.takeSlot(service, SLOT_LEASE_MS);
    if (lease !== null || waited >= MAX_WAIT_MS) return lease;
    await d.sleep(POLL_MS);
  }
}

/**
 * A turn that was refused before any request went out, and where: the service
 * was already `cooling`, there was `no-slot`, there was `no-start` (too far
 * off, or cooling by then), or it `cooled-while-waiting` for its start.
 */
export interface TurnRefused {
  kind: "refused";
  why: "cooling-down" | "busy";
  at: "cooling" | "no-slot" | "no-start" | "cooled-while-waiting";
}

/**
 * **One request's turn at a service**: its cooldown respected, a leased slot,
 * a globally spaced start, and the slot freed whatever `request` does. The one
 * copy of the politeness, shared by the registry lookup below and by
 * src/citation-index.ts. `request` is handed how long the start made it wait,
 * for its log line.
 */
export async function inServiceTurn<T>(
  service: LimiterService,
  d: TurnDeps,
  request: (waitMs: number) => Promise<T>,
): Promise<{ kind: "ran"; value: T } | TurnRefused> {
  if (await d.store.coolingDown(service)) return { kind: "refused", why: "cooling-down", at: "cooling" };
  const lease = await slotFor(service, d);
  if (lease === null) return { kind: "refused", why: "busy", at: "no-slot" };
  try {
    const start = await d.store.takeStart(service, SPACING_MS[service], MAX_WAIT_MS);
    if (start.kind !== "start") return { kind: "refused", why: start.kind, at: "no-start" };
    if (start.waitMs > 0) {
      await d.sleep(start.waitMs);
      /* A request already in flight may have set a provider-wide cooldown while
         this start was waiting. Do not turn a valid reservation into one more
         request after the provider has told the fleet to stop. */
      if (await d.store.coolingDown(service)) {
        return { kind: "refused", why: "cooling-down", at: "cooled-while-waiting" };
      }
    }
    return { kind: "ran", value: await request(start.waitMs) };
  } finally {
    await d.store.freeSlot(lease);
  }
}

/**
 * **A 429 or a 503 cools the service for everybody**: its `Retry-After`, else a
 * minute, at most an hour. Returns how long, or null when `err` is neither.
 */
export async function coolAfter(
  err: FetchFailure,
  service: LimiterService,
  store: ServiceLimiter,
): Promise<number | null> {
  if (err.status !== 429 && err.status !== 503) return null;
  const forMs = Math.min(err.retryAfterMs ?? DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS);
  await store.coolDown(service, Math.max(forMs, 1_000));
  return forMs;
}

/** One request to one registry, inside its slot, its start and its cooldown. */
async function askService(id: WorkId, service: Registry, doi: string, d: Resolved): Promise<Asked> {
  const turn = await inServiceTurn(service, d, async (waitMs): Promise<Asked> => {
    const started = Date.now();
    const url = service === "crossref" ? crossrefUrl(doi) : dataciteUrl(doi);
    try {
      const json = await d.fetchJson(url);
      const parsed = service === "crossref" ? parseCrossref(id, doi, json) : parseDatacite(id, doi, json);
      d.log.info(
        { id, service, status: 200, outcome: parsed ? "found" : "no-title", ms: Date.now() - started, waitMs },
        "bibliographic lookup",
      );
      /* A record with no title is, to every caller, no record: each of them
         checks a citation's title against it. Remembered as a miss for 7 days
         rather than asked about again on every call. */
      return parsed ? { kind: "found", record: parsed } : { kind: "not-found" };
    } catch (err) {
      const ms = Date.now() - started;
      if (!(err instanceof FetchFailure)) throw err;
      const status = err.status;
      if (status === 404 || status === 410) {
        d.log.info({ id, service, status, outcome: "not-found", ms, waitMs }, "bibliographic lookup");
        return { kind: "not-found" };
      }
      const cooldownMs = await coolAfter(err, service, d.store);
      if (cooldownMs !== null) {
        d.log.warn({ id, service, status, outcome: "cooling-down", cooldownMs, ms, waitMs }, "bibliographic lookup");
        return { kind: "unavailable", why: "cooling-down" };
      }
      d.log.warn({ id, service, status, code: err.code, outcome: "error", ms, waitMs }, "bibliographic lookup");
      return { kind: "unavailable", why: "error" };
    }
  });
  if (turn.kind === "ran") return turn.value;
  if (turn.at === "no-slot") {
    d.log.info({ id, service, outcome: "busy", reason: "no-slot" }, "bibliographic lookup");
  } else if (turn.at === "no-start") {
    d.log.info({ id, service, outcome: turn.why }, "bibliographic lookup");
  }
  return { kind: "unavailable", why: turn.why };
}

/** arXiv: DataCite. A DOI: Crossref, and only on its 404 DataCite. */
async function ask(id: WorkId, d: Resolved): Promise<Asked> {
  const doi = doiFor(id);
  if (id.startsWith("arxiv:")) return await askService(id, "datacite", doi, d);
  const crossref = await askService(id, "crossref", doi, d);
  if (crossref.kind !== "not-found") return crossref;
  return await askService(id, "datacite", doi, d);
}

/** Somebody else is asking: wait up to `CLAIM_WAIT_MS` for their answer. */
async function awaitOther(id: WorkId, d: Resolved): Promise<LookupResult> {
  for (let waited = 0; waited < CLAIM_WAIT_MS; ) {
    await d.sleep(POLL_MS * 2);
    waited += POLL_MS * 2;
    const seen = await d.store.read(id, FRESHNESS);
    if (seen.answer !== null) return seen.answer;
    if (!seen.claimed) break;
  }
  return { kind: "unavailable", why: "in-flight" };
}

/**
 * **What a registry says this work is** — `found`, `not-found`, or
 * `unavailable` with the reason. Never throws for anything a registry or the
 * database does; throws a `TypeError` for an identifier that is not a `WorkId`,
 * before any request.
 */
export async function lookupWork(id: WorkId, deps: LookupDeps = {}): Promise<LookupResult> {
  if (parseWorkId(id) !== id) throw new TypeError("lookupWork takes a WorkId from parseWorkId");
  const d = await resolveDeps(deps);
  const started = Date.now();
  let claim: IdentifierClaim | null = null;
  try {
    const cached = await d.store.read(id, FRESHNESS);
    if (cached.answer !== null) {
      d.log.debug({ id, outcome: cached.answer.kind, cacheHit: true, ms: Date.now() - started }, "bibliographic lookup");
      return cached.answer;
    }
    if (!cached.claimed) claim = await d.store.claim(id, FRESHNESS, CLAIM_LEASE_MS);
    if (claim === null) {
      /* Somebody else holds it — or answered between our read and our claim,
         which the claim refuses just the same. */
      const result = await awaitOther(id, d);
      d.log.debug({ id, outcome: result.kind, cacheHit: result.kind !== "unavailable", waited: true, ms: Date.now() - started }, "bibliographic lookup");
      return result;
    }
    const asked = await ask(id, d);
    if (asked.kind === "unavailable") {
      await d.store.release(claim);
      claim = null;
      return asked;
    }
    const storedAt = await d.store.write(claim, asked);
    claim = null;
    if (storedAt === null) {
      /* This process paused past its lease and a successor owns the row. Its
         answer may be perfectly plausible, but it is no longer authorised to
         publish it or to clear the successor's claim. */
      return await awaitOther(id, d);
    }
    /* What the next caller will read from the cache, so the two agree: a
       Crossref record carries the moment its count was read. */
    return withCountReadAt(asked, storedAt);
  } catch (err) {
    d.log.error({ id, outcome: "store", ms: Date.now() - started, ...errorFields(err) }, "bibliographic lookup failed");
    if (claim !== null) await d.store.release(claim).catch(() => {});
    return { kind: "unavailable", why: "store" };
  }
}
