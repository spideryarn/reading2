/**
 * **The registry backfill** — the DOI, the journal and the publication day or
 * year, for articles imported before `withRegistryFacts` existed.
 * docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md
 * § Stage 2, and § GPT Sol's plan review, which wins where they differ.
 *
 * Two halves that never run in one process:
 *
 * - `dryRun` reads every article with a current revision inside a read-only
 *   transaction, finds its candidates without a model, asks the registries,
 *   lets `withRegistryFacts` (src/article-registry.ts) decide unchanged, and
 *   returns a `Plan`.
 * - `applyPlan` writes exactly that plan and asks no registry, so what a
 *   person read is what is written.
 *
 * scripts/backfill-registry-facts.ts is the thin command over these.
 *
 * ## The four things apply refuses, and why each is a refusal
 *
 * - **A plan made against another database.** The plan names its target.
 * - **A revision that is no longer the article's current one.** The article row
 *   is locked first, so a publication cannot land between the check and the
 *   write.
 * - **An article with an unfinished draft.** The draft was copied before this
 *   write and would publish later without the facts; its lineage guard compares
 *   revision ids, which this write leaves alone, so nothing else would notice.
 * - **A column that holds something else now.** A day and a year are one fact
 *   at two precisions: filling either needs both empty.
 *
 * ## What may be logged from this file
 *
 * Nothing goes through src/log.ts. The plan carries each article's title, so a
 * person can check a row; the script prints it to its own stdout and nowhere
 * else.
 */
import { parse } from "pg-connection-string";

import { ownIdsOfDocument, ownIdsOfPage, ownIdsOfPdf, withRegistryFacts, type RegistryOutcome } from "./article-registry.js";
import {
  lookupWork,
  realIsoDay,
  type BibliographicStore,
  type CachedAnswer,
  type LimiterService,
  type LookupDeps,
  type LookupResult,
  type WorkId,
} from "./bibliographic.js";
import { jsdom } from "./jsdom-lazy.js";
import { frontPagesWithStamps } from "./pdf.js";
import { publishedYearOf, type Author, type Meta } from "./types.js";

/* ------------------------------------------------------------ the target -- */

/** Which database, including the username that routes a shared Supabase pooler. Never a password. */
export interface BackfillTarget {
  host: string;
  port: string;
  database: string;
  user: string;
}

/**
 * `pg`'s own parser, so this names what `pg` would dial
 * (scripts/stripe-target.ts § `whyNotProduction` has the reason).
 */
export function backfillTargetOf(url: string): BackfillTarget {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(url);
  } catch {
    throw new PlanRefused("the database URL cannot be parsed");
  }
  /* No ambient PGUSER/PGPORT/PGDATABASE defaults: the plan must identify
     exactly what a later process will dial. On a shared pooler the username,
     not the host or database name, identifies the project. */
  if (
    !parsed.host || !parsed.user || !parsed.database || !parsed.port ||
    !/^\d+$/.test(parsed.port) || Number(parsed.port) < 1 || Number(parsed.port) > 65535
  ) {
    throw new PlanRefused("the database URL must explicitly name its host, port, database and user");
  }
  return { host: parsed.host.toLowerCase(), port: String(Number(parsed.port)), database: parsed.database, user: parsed.user };
}

export function sameTarget(a: BackfillTarget, b: BackfillTarget): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database && a.user === b.user;
}

export function targetLabel(t: BackfillTarget): string {
  return `${t.user}@${t.host}:${t.port}/${t.database}`;
}

/* --------------------------------------------------------------- the plan -- */

/** What `pg`'s `Client` and `PoolClient` both are, as far as this file needs. */
export interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

/** One article and its current revision, as the dry run reads them. */
export interface ArticleRow {
  articleId: string;
  slug: string;
  revisionId: string;
  title: string | null;
  byline: string | null;
  authors: Author[] | null;
  doi: string | null;
  journal: string | null;
  publishedAt: string | null;
  publishedYear: number | null;
  finalUrl: string | null;
  requestedUrl: string | null;
  /** Came off the reader's own disk, so it has no address to resolve against. */
  uploaded: boolean;
  rawSourceSha256: string | null;
  rawSourceKind: string | null;
  hasTimeline: boolean;
  hasDraft: boolean;
}

/**
 * - the three of `RegistryOutcome`, from `withRegistryFacts`;
 * - `no-source` — the revision references no stored document;
 * - `source-unreadable` — it references one that is missing, corrupt, or a PDF
 *   pdf.js cannot open.
 */
export type PlanOutcome = RegistryOutcome | "no-source" | "source-unreadable";

/** The four columns, by their database names. A key is present only when apply should fill it. */
export interface PlanWrite {
  doi?: string;
  journal?: string;
  published_at?: string;
  published_year?: number;
}

export const PLAN_COLUMNS = ["doi", "journal", "published_at", "published_year"] as const;
export type PlanColumn = (typeof PLAN_COLUMNS)[number];

export interface PlanRow {
  slug: string;
  articleId: string;
  revisionId: string;
  title: string;
  sourceKind: "pdf" | "html" | null;
  outcome: PlanOutcome;
  /** The identifiers found, in the order they would be asked. */
  candidates: string[];
  /** Each one actually asked, and what came back. `unavailable:*` is no answer, not a miss. */
  asked: { id: string; answer: string }[];
  write: PlanWrite;
  hasTimeline: boolean;
  hasDraft: boolean;
  /** An error's class name, for `source-unreadable`. */
  note?: string;
}

export interface PlanTotals {
  articles: number;
  byOutcome: Record<PlanOutcome, number>;
  rowsWithAWrite: number;
  byColumn: Record<PlanColumn, number>;
  /** Articles that gain a `published_at` and have a Timeline: it will show as out of date. */
  timelinesMadeStale: number;
  /** Rows apply would refuse today, because a draft is unfinished. */
  rowsWithAWriteAndADraft: number;
  /** Lookups that got no answer. Above zero, a `none-agreed` may only mean nobody answered. */
  lookupsUnanswered: number;
}

export interface Plan {
  version: 1;
  target: BackfillTarget;
  madeAt: string;
  /** False on a database the `published_year` migration has not reached. Apply refuses a year there. */
  publishedYearColumn: boolean;
  totals: PlanTotals;
  rows: PlanRow[];
}

/** The stored document, `null` when the revision references none. Throws when it references one it cannot read. */
export type ReadSource = (row: ArticleRow) => Promise<{ bytes: Uint8Array; kind: "pdf" | "html" } | null>;

export interface PlanDeps {
  readSource: ReadSource;
  lookup: (id: WorkId) => Promise<LookupResult>;
  now?: () => Date;
  /** Called after each article, for a progress line. */
  onRow?: (row: PlanRow, index: number, of: number) => void;
}

const FRONT_PAGES = 2;

/**
 * The identifiers an article's own address carries, after whatever its
 * document declared. Wider than the import, which reads a PDF's pages only: a
 * paper fetched from `arxiv.org/pdf/…` names itself in its address, and a
 * candidate costs one request and still has to agree on title and author.
 */
function idsOfAddresses(row: ArticleRow): WorkId[] {
  if (row.uploaded) return [];
  return [row.finalUrl, row.requestedUrl].flatMap((url) => ownIdsOfPage({ doi: undefined, url }));
}

type Candidates =
  | { kind: "found"; sourceKind: "pdf" | "html"; ids: WorkId[] }
  | { kind: "no-source" }
  | { kind: "source-unreadable"; sourceKind: "pdf" | "html" | null; note: string };

function storedKind(row: ArticleRow): "pdf" | "html" | null {
  return row.rawSourceKind === "pdf" || row.rawSourceKind === "html" ? row.rawSourceKind : null;
}

/** The candidates, without a model: a PDF's first two pages, or a page's own meta tags and address. */
export async function candidatesOf(row: ArticleRow, readSource: ReadSource): Promise<Candidates> {
  let ids: WorkId[];
  let sourceKind: "pdf" | "html";
  try {
    const source = await readSource(row);
    if (source === null) return { kind: "no-source" };
    sourceKind = source.kind;
    if (source.kind === "pdf") {
      ids = ownIdsOfPdf(await frontPagesWithStamps(source.bytes, { pages: FRONT_PAGES }));
    } else {
      /* A `VirtualConsole` with nothing attached, for the reason
         src/extract.ts § `readingArm` gives: jsdom's default prints the page's
         own words to stderr. No scripts run and nothing is fetched. */
      const { JSDOM, VirtualConsole } = jsdom();
      const url = row.uploaded ? null : row.finalUrl;
      const dom = new JSDOM(new TextDecoder().decode(source.bytes), {
        ...(url === null ? {} : { url }),
        virtualConsole: new VirtualConsole(),
      });
      try {
        ids = ownIdsOfDocument(dom.window.document, url);
      } finally {
        dom.window.close();
      }
    }
  } catch (err) {
    return { kind: "source-unreadable", sourceKind: storedKind(row), note: err instanceof Error ? err.name : "Error" };
  }
  return { kind: "found", sourceKind, ids: [...new Set([...ids, ...idsOfAddresses(row)])] };
}

/** The revision as `withRegistryFacts` wants it: only the fields it reads. */
function metaOf(row: ArticleRow): Meta {
  return {
    slug: row.slug,
    title: row.title ?? "",
    ...(row.byline === null ? {} : { byline: row.byline }),
    ...(row.authors === null ? {} : { authors: row.authors }),
    ...(row.doi === null ? {} : { doi: row.doi }),
    ...(row.journal === null ? {} : { journal: row.journal }),
    ...(row.publishedAt === null ? {} : { publishedAt: row.publishedAt }),
    ...(row.publishedYear === null ? {} : { publishedYear: row.publishedYear }),
  };
}

/**
 * What to fill, from what the row holds and what `withRegistryFacts` decided.
 * A column only when it is empty today; a day or a year only when **both** are
 * (plan § F2).
 */
export function writeFor(row: ArticleRow, decided: Meta): PlanWrite {
  const noDate = row.publishedAt === null && row.publishedYear === null;
  const day = noDate ? realIsoDay(decided.publishedAt) : undefined;
  const year = noDate && day === undefined ? publishedYearOf(decided.publishedYear) : undefined;
  return {
    ...(row.doi === null && decided.doi ? { doi: decided.doi } : {}),
    ...(row.journal === null && decided.journal ? { journal: decided.journal } : {}),
    ...(day !== undefined ? { published_at: day } : {}),
    ...(year !== undefined ? { published_year: year } : {}),
  };
}

async function planRow(row: ArticleRow, deps: PlanDeps): Promise<PlanRow> {
  const base = {
    slug: row.slug,
    articleId: row.articleId,
    revisionId: row.revisionId,
    title: row.title ?? "",
    hasTimeline: row.hasTimeline,
    hasDraft: row.hasDraft,
  };
  const found = await candidatesOf(row, deps.readSource);
  if (found.kind === "no-source") {
    return { ...base, sourceKind: null, outcome: "no-source", candidates: [], asked: [], write: {} };
  }
  if (found.kind === "source-unreadable") {
    return { ...base, sourceKind: found.sourceKind, outcome: "source-unreadable", candidates: [], asked: [], write: {}, note: found.note };
  }
  const asked: { id: string; answer: string }[] = [];
  const facts = await withRegistryFacts(metaOf(row), found.ids, {
    lookup: async (id) => {
      const answer = await deps.lookup(id);
      asked.push({ id, answer: answer.kind === "unavailable" ? `unavailable:${answer.why}` : answer.kind });
      return answer;
    },
  });
  return {
    ...base,
    sourceKind: found.sourceKind,
    outcome: facts.outcome,
    candidates: found.ids,
    asked,
    write: facts.outcome === "agreed" ? writeFor(row, facts.meta) : {},
  };
}

function hasWrite(row: PlanRow): boolean {
  return PLAN_COLUMNS.some((column) => row.write[column] !== undefined);
}

export function totalsOf(rows: readonly PlanRow[]): PlanTotals {
  const byOutcome: Record<PlanOutcome, number> = {
    agreed: 0,
    "none-agreed": 0,
    "no-candidate": 0,
    "no-source": 0,
    "source-unreadable": 0,
  };
  const byColumn: Record<PlanColumn, number> = { doi: 0, journal: 0, published_at: 0, published_year: 0 };
  for (const row of rows) {
    byOutcome[row.outcome]++;
    for (const column of PLAN_COLUMNS) if (row.write[column] !== undefined) byColumn[column]++;
  }
  return {
    articles: rows.length,
    byOutcome,
    rowsWithAWrite: rows.filter(hasWrite).length,
    byColumn,
    timelinesMadeStale: rows.filter((r) => r.write.published_at !== undefined && r.hasTimeline).length,
    rowsWithAWriteAndADraft: rows.filter((r) => hasWrite(r) && r.hasDraft).length,
    lookupsUnanswered: rows.reduce((n, r) => n + r.asked.filter((a) => a.answer.startsWith("unavailable")).length, 0),
  };
}

/** One row an article, in the order given. Sequential: the registries are asked one at a time. */
export async function buildPlan(
  articles: readonly ArticleRow[],
  about: { target: BackfillTarget; publishedYearColumn: boolean },
  deps: PlanDeps,
): Promise<Plan> {
  const rows: PlanRow[] = [];
  for (const [index, article] of articles.entries()) {
    const row = await planRow(article, deps);
    rows.push(row);
    deps.onRow?.(row, index, articles.length);
  }
  return {
    version: 1,
    target: about.target,
    madeAt: (deps.now?.() ?? new Date()).toISOString(),
    publishedYearColumn: about.publishedYearColumn,
    totals: totalsOf(rows),
    rows,
  };
}

/* ------------------------------------------------------------ the reading -- */

export async function hasPublishedYearColumn(db: Queryable): Promise<boolean> {
  const found = await db.query(
    `select 1 from information_schema.columns
      where table_schema = 'spideryarn' and table_name = 'article_revisions' and column_name = 'published_year'`,
  );
  return found.rows.length > 0;
}

/** Every article that has a current revision, by slug. */
export async function readArticles(db: Queryable, publishedYearColumn: boolean): Promise<ArticleRow[]> {
  const year = publishedYearColumn ? "r.published_year" : "null::integer";
  const found = await db.query(
    `select a.id as "articleId", a.slug, r.id as "revisionId", r.title, r.byline, r.authors, r.doi, r.journal,
            r.published_at as "publishedAt", ${year} as "publishedYear",
            r.final_url as "finalUrl", r.requested_url as "requestedUrl",
            (r.raw_filename is not null) as uploaded,
            r.raw_source_sha256 as "rawSourceSha256", r.raw_source_kind as "rawSourceKind",
            (r.timeline is not null) as "hasTimeline",
            exists (select 1 from spideryarn.article_revisions d
                     where d.article_id = a.id and d.status = 'draft') as "hasDraft"
       from spideryarn.articles a
       join spideryarn.article_revisions r on r.id = a.current_revision_id
      order by a.slug`,
  );
  return found.rows as ArticleRow[];
}

/**
 * **The dry run.** `BEGIN READ ONLY` before the first read, `ROLLBACK` after
 * the last, and no commit anywhere: Postgres itself refuses a write from this
 * session, whatever this code or anything it calls goes on to do.
 */
export async function dryRun(
  db: Queryable,
  target: BackfillTarget,
  deps: PlanDeps & { only?: (row: ArticleRow) => boolean },
): Promise<Plan> {
  await db.query("begin read only");
  try {
    const publishedYearColumn = await hasPublishedYearColumn(db);
    const all = await readArticles(db, publishedYearColumn);
    const articles = deps.only ? all.filter(deps.only) : all;
    return await buildPlan(articles, { target, publishedYearColumn }, deps);
  } finally {
    /* Swallowed: a session that died while the registries were being asked has
       committed nothing either way, and its error must not replace the plan. */
    await db.query("rollback").catch(() => {});
  }
}

/* ------------------------------------------------------- the registries -- */

/**
 * **`lookupWork`'s store, in memory, for one process asking one at a time**
 * (plan § F3). The routing, the bounded waits, the Crossref-then-DataCite
 * fallback, the spacings and the cooldown are all `lookupWork`'s own; this
 * only keeps their state somewhere that is not the database, because the dry
 * run is read-only and a cached record from before 2026-10-04 has no day.
 * Nothing is read from or written to the registry cache table.
 *
 * A claim and a slot are always granted: there is nobody else here to hold one.
 */
export function memoryBibliographicStore(now: () => number = Date.now): BibliographicStore {
  const answers = new Map<WorkId, CachedAnswer>();
  const coolUntil: Record<LimiterService, number> = { crossref: 0, datacite: 0, openalex: 0 };
  const nextStart: Record<LimiterService, number> = { crossref: 0, datacite: 0, openalex: 0 };
  return {
    read: async (id) => ({ answer: answers.get(id) ?? null, claimed: false }),
    claim: async (id, _fresh, leaseMs) => ({ id, until: new Date(now() + leaseMs) }),
    release: async () => {},
    write: async (claim, answer) => {
      answers.set(claim.id, answer);
      return true;
    },
    coolingDown: async (service) => now() < coolUntil[service],
    takeSlot: async (service, leaseMs) => ({ service, slot: 1, until: new Date(now() + leaseMs) }),
    freeSlot: async () => {},
    takeStart: async (service, spacingMs, maxWaitMs) => {
      if (now() < coolUntil[service]) return { kind: "cooling-down" };
      const at = Math.max(now(), nextStart[service]);
      if (at - now() > maxWaitMs) return { kind: "busy" };
      nextStart[service] = at + spacingMs;
      return { kind: "start", waitMs: at - now() };
    },
    coolDown: async (service, forMs) => {
      coolUntil[service] = Math.max(coolUntil[service], now() + forMs);
    },
  };
}

/** The real registries through `lookupWork`, with nothing kept in the database. */
export function registryLookup(deps: Omit<LookupDeps, "store"> = {}): (id: WorkId) => Promise<LookupResult> {
  const store = memoryBibliographicStore();
  return (id) => lookupWork(id, { ...deps, store });
}

/* -------------------------------------------------------------- the apply -- */

/** A plan this file will not apply at all. Nothing has been written. */
export class PlanRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanRefused";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown, what: string): string {
  if (typeof value !== "string" || value === "") throw new PlanRefused(`the plan file has no ${what}`);
  return value;
}

/**
 * A plan file, checked before anything is written from it: it has been on
 * disk, and every value in `write` goes into a reader's article. Only what
 * apply reads is checked and kept.
 */
export function parsePlan(json: unknown): Pick<Plan, "version" | "target" | "madeAt" | "rows"> {
  const plan = json as Partial<Plan> | null;
  if (typeof plan !== "object" || plan === null || plan.version !== 1) {
    throw new PlanRefused("this is not a version 1 backfill plan file");
  }
  const target = plan.target as Partial<BackfillTarget> | undefined;
  if (
    !target || typeof target.host !== "string" || typeof target.port !== "string" ||
    typeof target.database !== "string" || typeof target.user !== "string" || target.user === ""
  ) {
    throw new PlanRefused("the plan file needs a target with host, port, database and user; make a new dry-run plan");
  }
  if (!Array.isArray(plan.rows)) throw new PlanRefused("the plan file has no rows");
  const rows = plan.rows.map((raw: Partial<PlanRow>, i): PlanRow => {
    const slug = text(raw.slug, `slug on row ${i}`);
    const articleId = text(raw.articleId, `article id for "${slug}"`);
    const revisionId = text(raw.revisionId, `revision id for "${slug}"`);
    if (!UUID.test(articleId) || !UUID.test(revisionId)) throw new PlanRefused(`"${slug}" has an id that is not a uuid`);
    const w = (raw.write ?? {}) as Record<string, unknown>;
    const unknown = Object.keys(w).filter((key) => !(PLAN_COLUMNS as readonly string[]).includes(key));
    if (unknown.length > 0) throw new PlanRefused(`"${slug}" would write ${unknown.join(", ")}, which is not a column this fills`);
    const write: PlanWrite = {};
    if (w.doi !== undefined) write.doi = text(w.doi, `doi for "${slug}"`);
    if (w.journal !== undefined) write.journal = text(w.journal, `journal for "${slug}"`);
    if (w.published_at !== undefined) {
      const day = realIsoDay(w.published_at);
      if (day === undefined || day !== w.published_at) throw new PlanRefused(`"${slug}" has a published_at that is not a calendar day`);
      write.published_at = day;
    }
    if (w.published_year !== undefined) {
      const year = publishedYearOf(w.published_year);
      if (year === undefined) throw new PlanRefused(`"${slug}" has a published_year that is not a year`);
      write.published_year = year;
    }
    if (write.published_at !== undefined && write.published_year !== undefined) {
      throw new PlanRefused(`"${slug}" would write both a day and a year`);
    }
    return {
      slug,
      articleId,
      revisionId,
      title: typeof raw.title === "string" ? raw.title : "",
      sourceKind: raw.sourceKind === "pdf" || raw.sourceKind === "html" ? raw.sourceKind : null,
      outcome: (raw.outcome ?? "agreed") as PlanOutcome,
      candidates: [],
      asked: [],
      write,
      hasTimeline: raw.hasTimeline === true,
      hasDraft: raw.hasDraft === true,
    };
  });
  return { version: 1, target: target as BackfillTarget, madeAt: typeof plan.madeAt === "string" ? plan.madeAt : "", rows };
}

export type ApplyRefusal = "article-gone" | "revision-not-current" | "unfinished-draft" | "something-else-there";

export type ApplyRowResult =
  | { slug: string; outcome: "written"; columns: PlanColumn[] }
  | { slug: string; outcome: "already" }
  | { slug: string; outcome: "refused"; reason: ApplyRefusal; columns?: PlanColumn[] };

export interface ApplyResult {
  rows: ApplyRowResult[];
  written: number;
  already: number;
  refused: number;
}

type Held = Record<PlanColumn, string | number | null>;

/**
 * One row's verdict from what the revision holds now. **Whole rows**: if any
 * column the plan fills holds something else, nothing on the row is written,
 * so a refused row is exactly as it was found.
 *
 * - a column is `already` done when it holds the plan's value;
 * - `doi` and `journal` are free when null;
 * - a day or a year is free only when **both** date columns are null.
 */
export function rowVerdict(
  write: PlanWrite,
  held: Held,
): { kind: "write"; columns: PlanColumn[] } | { kind: "already" } | { kind: "conflict"; columns: PlanColumn[] } {
  const toWrite: PlanColumn[] = [];
  const conflicts: PlanColumn[] = [];
  const noDate = held.published_at === null && held.published_year === null;
  for (const column of PLAN_COLUMNS) {
    const wanted = write[column];
    if (wanted === undefined) continue;
    const isDate = column === "published_at" || column === "published_year";
    const other = column === "published_at" ? held.published_year : held.published_at;
    if (held[column] === wanted && (!isDate || other === null)) continue;
    if (isDate ? noDate : held[column] === null) toWrite.push(column);
    else conflicts.push(column);
  }
  if (conflicts.length > 0) return { kind: "conflict", columns: conflicts };
  return toWrite.length > 0 ? { kind: "write", columns: toWrite } : { kind: "already" };
}

/**
 * **Write a plan.** One transaction. Refuses the whole plan, before `begin`,
 * when it was made against another database or carries a year the database has
 * no column for. After that each article is settled on its own, and one
 * article's refusal does not stop the others.
 *
 * @throws PlanRefused with nothing written. Anything else thrown rolls the
 *   transaction back, so again nothing is written.
 */
export async function applyPlan(
  db: Queryable,
  plan: Pick<Plan, "target" | "rows">,
  target: BackfillTarget,
): Promise<ApplyResult> {
  if (!sameTarget(plan.target, target)) {
    throw new PlanRefused(
      `this plan was made against ${targetLabel(plan.target)}, and this command is pointed at ${targetLabel(target)}. ` +
        "Make a new plan against the database you mean to write.",
    );
  }
  const todo = plan.rows.filter(hasWrite);
  const yearColumn = await hasPublishedYearColumn(db);
  if (!yearColumn && todo.some((row) => row.write.published_year !== undefined)) {
    throw new PlanRefused(
      "this plan fills published_year, and this database has no such column yet. Deploy first, so the migration runs, then apply.",
    );
  }
  const yearRead = yearColumn ? "published_year" : "null::integer as published_year";

  const rows: ApplyRowResult[] = [];
  await db.query("begin");
  try {
    /* The app's multi-article sweeps lock in actual slug order under C
       collation. Plan order and plan labels are editable, so neither is a
       lock-order authority. Acquire every article lock before revision locks. */
    const locked = await db.query(
      'select id, current_revision_id from spideryarn.articles where id = any($1::uuid[]) order by slug collate "C" for update',
      [[...new Set(todo.map((row) => row.articleId))]],
    );
    const articles = new Map(locked.rows.map((raw) => {
      const article = raw as { id: string; current_revision_id: string | null };
      return [article.id, article];
    }));
    for (const row of todo) {
      /* Publication and beginDraftIn take this same article lock, so neither
         can land between the pointer/draft checks and commit. */
      const article = articles.get(row.articleId);
      const current = article?.current_revision_id;
      if (article === undefined) {
        rows.push({ slug: row.slug, outcome: "refused", reason: "article-gone" });
        continue;
      }
      if (current !== row.revisionId) {
        rows.push({ slug: row.slug, outcome: "refused", reason: "revision-not-current" });
        continue;
      }
      const drafts = await db.query(
        "select 1 from spideryarn.article_revisions where article_id = $1 and status = 'draft' limit 1",
        [row.articleId],
      );
      if (drafts.rows.length > 0) {
        rows.push({ slug: row.slug, outcome: "refused", reason: "unfinished-draft" });
        continue;
      }
      const held = await db.query(
        `select doi, journal, published_at, ${yearRead} from spideryarn.article_revisions where id = $1 for update`,
        [row.revisionId],
      );
      const verdict = rowVerdict(row.write, held.rows[0] as Held);
      if (verdict.kind === "conflict") {
        rows.push({ slug: row.slug, outcome: "refused", reason: "something-else-there", columns: verdict.columns });
        continue;
      }
      if (verdict.kind === "already") {
        rows.push({ slug: row.slug, outcome: "already" });
        continue;
      }
      /* Column names come from `PLAN_COLUMNS`, never from the file. The
         `is null` guards repeat the verdict in the statement that writes, so
         the two cannot come apart. */
      const sets = verdict.columns.map((column, i) => `${column} = $${i + 2}`);
      const fillsDate = verdict.columns.some((c) => c === "published_at" || c === "published_year");
      const guards = [
        ...verdict.columns.filter((c) => c === "doi" || c === "journal").map((c) => `${c} is null`),
        ...(fillsDate ? ["published_at is null", ...(yearColumn ? ["published_year is null"] : [])] : []),
      ];
      const done = await db.query(
        `update spideryarn.article_revisions set ${sets.join(", ")} where id = $1 and ${guards.join(" and ")}`,
        [row.revisionId, ...verdict.columns.map((column) => row.write[column])],
      );
      if (done.rowCount !== 1) {
        throw new Error(`the write for "${row.slug}" changed ${done.rowCount} rows where one was locked and checked`);
      }
      rows.push({ slug: row.slug, outcome: "written", columns: verdict.columns });
    }
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
  const count = (outcome: ApplyRowResult["outcome"]) => rows.filter((r) => r.outcome === outcome).length;
  return { rows, written: count("written"), already: count("already"), refused: count("refused") };
}

/**
 * Whether an apply did what it was asked. False when nothing was written and
 * nothing was already there, so a run that did nothing cannot read as success.
 */
export function applySucceeded(result: ApplyResult): boolean {
  return result.written + result.already > 0;
}
