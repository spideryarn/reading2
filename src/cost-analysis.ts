/**
 * **The cost analysis an agent runs** — `npm run cost:analyse`
 * (scripts/cost-analysis.ts). Pure: cube rows and detail rows in, one
 * `CostAnalysis` out, which is the `--json` output and what the HTML report is
 * drawn from. No database, no clock, no network.
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md
 * § The analysis an agent runs, as changed by § What GPT Sol's plan review changed.
 *
 * ## Two reads, and they must agree
 *
 * The rankings are folds of the **cube** through src/cost-cube.ts — the same
 * functions `/admin/costs` uses, so a figure here and a figure on the page have
 * one definition. The **leads** need what the cube throws away (one call's own
 * cost, its job, its tokens), so they come from **detail rows**. `analyseCosts`
 * compares the two reads first and throws if they differ by one call or one
 * nano-dollar: a report built from two reads that disagree is worse than none.
 *
 * ## What a lead is, and is not
 *
 * A lead is a measured shape worth a person's or an agent's look, with the
 * figures behind it and **one sentence saying what it does not show**. The
 * script has no opinions: whether a step bought twice was wasted, or a cheaper
 * model would do, is not in the ledger. An agent's conclusions go into the
 * report through `--commentary`.
 *
 * Tokens are compared **inside one wire only**. `reported_input_tokens`
 * excludes cached tokens on the Messages wire and includes them on the chat
 * wire (docs/investigations/261005a-…, check 1), so there is no cross-wire
 * token total anywhere in this file, and no summed duration.
 *
 * Server-side: it imports src/cost-categories.ts, which reaches the pipeline.
 */

import { formatSpendNanos } from "./admin.js";
import { costCategoryOf } from "./cost-categories.js";
import {
  type ArticleKey,
  type CostCubeGroup,
  type CostCubeRow,
  type CubeGroup,
  type CubeTotals,
  FAILURE_NOTES,
  type FailureCause,
  type FailureCounts,
  type FailureGroup,
  type OwnerEmails,
  articleKeyOf,
  articleKeyString,
  dimensionValue,
  estimatedCashNanos,
  failureCauses,
  failureCountsBy,
  failureCountsOf,
  groupRows,
  modelOf,
  pivotRows,
  taskOf,
  totalsOf,
} from "./cost-cube.js";
import { partitionByScope, spread } from "./cost-report.js";
import type { SpendDetailRow } from "./store/ai-calls-spend-pg.js";
import { TRANSPORT_ATTEMPTS } from "./transport-retry.js";

/* ------------------------------------------------------------ thresholds -- */

/** An article is "far above the median" at this multiple of it … */
export const ARTICLE_OUTLIER_TIMES = 5;
/** … and at least this much, so a cheap corpus does not flag everything. */
export const ARTICLE_OUTLIER_MIN_NANOS = 500_000_000;
/** A single call is an outlier at this multiple of its task's median call … */
export const CALL_OUTLIER_TIMES = 10;
/** … and at least this much. */
export const CALL_OUTLIER_MIN_NANOS = 250_000_000;
/** A task is looked at for cache use from this many calls on one wire … */
export const CACHE_MIN_CALLS = 20;
/** … and this much recorded on it … */
export const CACHE_MIN_NANOS = 1_000_000_000;
/** … and flagged when less than this share of its prompt tokens were cache reads. */
export const CACHE_LOW_SHARE = 0.1;
/**
 * … and only when a job of it typically makes at least this many calls: the
 * clearest case for reuse, and the only one this lead looks for. Flagging
 * every low share was eight false alarms out of eight on production,
 * 2026-10-05. **It is a narrower question, not a clean bill**: a cache can also
 * be reused across requests, and across tasks in one job
 * (docs/project/prompt-caching.md), and neither is examined. The "median" is
 * the lower middle value (`spread` in src/cost-report.ts), so jobs of 1 and 3
 * calls read as 1. GPT Sol, final check of plan 261005a.
 */
export const CACHE_MIN_CALLS_PER_JOB = 2;
/**
 * A task's p95 call is shown from this many priced calls. With fewer, the
 * nearest-rank p95 is simply the largest call, shown twice. The number stays
 * in the data, beside how many calls it rests on.
 */
export const P95_MIN_CALLS = 20;

/** How many examples a lead's table lists before the rest are only counted. */
const MOST_EXAMPLES = 15;

/* ----------------------------------------------------------------- shapes -- */

/** One value in a lead's evidence, typed so each renderer formats it once. */
export type Cell =
  | { kind: "text"; text: string }
  | { kind: "money"; nanos: number }
  | { kind: "count"; count: number }
  /** 0 to 1, or null when there was nothing to divide by. */
  | { kind: "share"; share: number | null }
  | { kind: "times"; times: number | null };

export interface EvidenceTable {
  columns: string[];
  rows: Cell[][];
  /** Rows the table left out, when it lists only the largest. */
  omitted: number;
}

export interface Lead {
  id: string;
  title: string;
  /** One or two plain sentences: what was measured, and what it does not show. */
  detail: string;
  evidence: { facts: { label: string; value: Cell }[]; table: EvidenceTable | null };
  /** The recorded amount at stake, by the definition `detail` gives. Leads sort on it. */
  amountNanos: number;
  /** `measured`: the ledger says exactly this. `suggestive`: a shape that may have an innocent cause. */
  confidence: "measured" | "suggestive";
}

export interface Slice {
  key: string;
  label: string;
  recordedNanos: number;
  /** Of its parent, 0 to 1; null when the parent recorded nothing. */
  share: number | null;
  calls: number;
}

export interface UserRank extends Slice {
  unpricedCalls: number;
  topTasks: Slice[];
}

export interface ArticleRank extends Slice {
  /** Whose article it is, as a label. */
  owner: string;
  /** Distinct `job_id`s among its calls. */
  jobs: number;
  /** Recorded amount over the median article's; null when the median is zero. */
  timesMedian: number | null;
  byTask: Slice[];
  byModel: Slice[];
}

export interface TaskRank extends Slice {
  /** src/cost-categories.ts; more than one when the task's rows span categories. */
  categories: string[];
  pricedCalls: number;
  unpricedCalls: number;
  /** Distinct articles among its calls; "no article" is not one. */
  articles: number;
  /**
   * Recorded amount per **priced** call, from detail rows. Null when none was
   * priced. `calls` is how many priced calls the three figures rest on; a
   * renderer shows `p95Nanos` only from `P95_MIN_CALLS` of them.
   */
  perCall: { medianNanos: number; p95Nanos: number; maxNanos: number; calls: number } | null;
  /** The models that answered, each with its share of the task. */
  models: Slice[];
}

export interface ModelRank extends Slice {
  tasks: Slice[];
}

/** One task on one wire: the only place token figures are compared. */
export interface CacheUse {
  task: string;
  /** `messages` or `chat`. */
  wire: string;
  calls: number;
  /**
   * The median number of this task's calls on this wire in one job — or, for
   * request work with no job id, in one run. Reuse inside a job needs several.
   */
  medianCallsPerJob: number;
  articles: number;
  recordedNanos: number;
  /** Cache reads over the wire's own prompt-token total; null when that is zero. */
  cacheReadShare: number | null;
  flagged: boolean;
}

/** What OpenRouter's own record says an unpriced call cost. */
export type UnpricedLookup =
  | { kind: "found"; creditsNanos: number; upstreamNanos: number }
  /** They hold no record under this id. */
  | { kind: "no-record" }
  /** The lookup did not complete. **Could not check — never a zero.** */
  | { kind: "failed" };

export interface LookupSummary {
  /** Unpriced calls in scope. */
  unpricedCalls: number;
  /** Of those, the ones with no generation id: nothing to ask about. */
  noGenerationId: number;
  /** Had an id and were not asked: over the per-run cap. */
  notAsked: number;
  asked: number;
  found: number;
  noRecord: number;
  failed: number;
  /** What the found records say was charged to our credits … */
  creditsNanos: number;
  /** … and to somebody's own key upstream. */
  upstreamNanos: number;
  /** Both, added: what the recorded amount is known to be short by. A floor. */
  knownShortfallNanos: number;
}

export interface CostTotals {
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
  /** The three pockets added. A floor wherever `unpricedCalls` is not zero. */
  recordedNanos: number;
  /** Credits plus the fee it took to buy them; the other two pockets untouched. */
  estimatedCashNanos: number;
  calls: number;
  pricedCalls: number;
  unpricedCalls: number;
  /** `outcome <> 'ok'`; their money is in the figures above as well. */
  failedCalls: number;
  failedRecordedNanos: number;
  /** `YYYY-MM-DD` UTC, or null when there are no calls. */
  firstDay: string | null;
  lastDay: string | null;
}

export interface CostAnalysis {
  /** Which database every figure came from. */
  target: { kind: "local" | "production"; description: string };
  window: { since: string | null; until: string | null; label: string };
  /** ISO. */
  generatedAt: string;
  /** `product`: request and job-step scope only. `all`: evals and the CLI too. */
  scope: "product" | "all";
  /** What the scope left out of every figure below. */
  excluded: { calls: number; recordedNanos: number };
  /** Where user labels came from, in words. */
  userLabels: string;
  totals: CostTotals;
  users: UserRank[];
  articles: {
    /** Articles with at least one call; "no article" is not one. */
    count: number;
    medianNanos: number;
    /** Calls attributed to no article, and what they recorded. */
    noArticle: { calls: number; recordedNanos: number };
    top: ArticleRank[];
  };
  tasks: TaskRank[];
  models: ModelRank[];
  overTime: {
    /** Every UTC day from the first call to the last, empty ones included. */
    days: string[];
    /** Largest first. */
    categories: string[];
    /** Day → category → recorded nano-dollars. */
    nanos: Record<string, Record<string, number>>;
  };
  cacheUse: CacheUse[];
  /**
   * Failures and retries, by the folds `/admin/costs` draws its section from
   * (src/cost-cube.ts § failures and retries). Counts, never rates; a null
   * figure is "not measured".
   */
  failures: {
    total: FailureCounts;
    /** Every UTC day with a call, oldest first. */
    byDay: FailureGroup[];
    /** The most retries, give-ups, part-way deaths, stalls and timeouts first. */
    byTask: FailureGroup[];
    /** The commonest first. */
    causes: FailureCause[];
    /** What the counts are not, in plain words. */
    notes: string[];
  };
  /** Null unless `--lookup-unpriced` was given. */
  lookup: LookupSummary | null;
  /** Most money first. */
  leads: Lead[];
}

export interface CostAnalysisInput {
  target: CostAnalysis["target"];
  window: CostAnalysis["window"];
  generatedAt: string;
  /** `spendCube` over the window. */
  cube: readonly CostCubeGroup[];
  /** `spendDetail` over the same window, by the same asker. */
  detail: readonly SpendDetailRow[];
  /** Owner id → email, for the owners the Auth listing knows. */
  emails: ReadonlyMap<string, string | null>;
  userLabels: string;
  includeNonProduct: boolean;
  /** How many articles get their breakdown. */
  top: number;
  /** Call id → what OpenRouter says, when unpriced calls were looked up. */
  lookups: ReadonlyMap<string, UnpricedLookup> | null;
}

/** The cube and the detail rows do not describe the same ledger. */
export class CostReadsDisagree extends Error {
  constructor(what: string, cube: number, detail: number, message?: string) {
    super(
      message ??
        (`the two reads of the ledger disagree on ${what}: the cube says ${cube}, the detail rows say ${detail}. ` +
          "No report was built. A call written between the two reads would do this; run it again."),
    );
    this.name = "CostReadsDisagree";
  }
}

/* ------------------------------------------------------- one row's money -- */

/** A detail row's recorded amount: its three pockets, a null read as nothing recorded. */
export function detailRecordedNanos(row: SpendDetailRow): number {
  return (row.creditsUsedNanos ?? 0) + (row.byokUpstreamNanos ?? 0) + (row.computedCostNanos ?? 0);
}

/**
 * `UNPRICED_CALLS` of src/store/ai-calls-spend-pg.ts, for one row. The two are
 * held together by `assertReadsAgree`, which compares their counts.
 */
export function detailIsUnpriced(row: SpendDetailRow): boolean {
  if (row.costSource === "computed") return false;
  return row.isByok === true ? row.byokUpstreamNanos === null : row.creditsUsedNanos === null;
}

/**
 * The cube's three attempt measures, for one row: `COUNTED_ATTEMPTS`, `RETRIES`
 * and `GAVE_UP` of src/store/ai-calls-spend-pg.ts written out again, and held
 * to them by `assertReadsAgree`.
 */
export function detailAttempt(row: SpendDetailRow): { counted: number; retries: number; gaveUp: number } {
  const gaveUp =
    row.outcome === "error" && row.failurePhase === "before_answer" && row.attempt === TRANSPORT_ATTEMPTS;
  return {
    counted: row.attempt === null ? 0 : 1,
    retries: row.attempt !== null && row.attempt > 1 ? 1 : 0,
    gaveUp: gaveUp ? 1 : 0,
  };
}

/** Throws `CostReadsDisagree` unless both reads hold the same calls and the same money. */
export function assertReadsAgree(
  cube: readonly CostCubeGroup[],
  detail: readonly SpendDetailRow[],
): void {
  const totals = totalsOf(cube);
  const sum = (pick: (row: SpendDetailRow) => number | null) =>
    detail.reduce((n, row) => n + (pick(row) ?? 0), 0);
  const cubeSum = (pick: (row: CostCubeGroup) => number) => cube.reduce((n, row) => n + pick(row), 0);
  const checks: [string, number, number][] = [
    ["the number of calls", totals.calls, detail.length],
    ["the credits pocket (nano-dollars)", totals.creditsNanos, sum((r) => r.creditsUsedNanos)],
    ["the BYOK pocket (nano-dollars)", totals.byokNanos, sum((r) => r.byokUpstreamNanos)],
    ["the computed pocket (nano-dollars)", totals.computedNanos, sum((r) => r.computedCostNanos)],
    ["the number of unpriced calls", totals.unpricedCalls, detail.filter(detailIsUnpriced).length],
    ["the number of counted attempts", cubeSum((g) => g.counted), sum((r) => detailAttempt(r).counted)],
    ["the number of retries", cubeSum((g) => g.retries), sum((r) => detailAttempt(r).retries)],
    ["the number of calls that gave up", cubeSum((g) => g.gaveUp), sum((r) => detailAttempt(r).gaveUp)],
  ];
  for (const [what, fromCube, fromDetail] of checks) {
    if (fromCube !== fromDetail) throw new CostReadsDisagree(what, fromCube, fromDetail);
  }

  /* Grand totals are necessary but not sufficient: losing one task and adding
     another call for the same money would otherwise pass, then let the cube's
     rankings and the detail-derived leads describe different populations.
     SQL may emit two rows that become identical after another owner's slug is
     masked, so merge equal public keys on both sides before comparing. */
  interface AgreementTotals {
    calls: number;
    creditsNanos: number;
    byokNanos: number;
    computedNanos: number;
    unpricedCalls: number;
    counted: number;
    retries: number;
    gaveUp: number;
  }
  const keyOf = (row: {
    day: string;
    ownerId: string;
    articleId: string | null;
    articleSlug: string | null;
    recordedSlugHash: string | null;
    scopeKind: string;
    job: string;
    stepName: string | null;
    wire: string;
    requestedModel: string;
    answeredModel: string | null;
    upstream: string | null;
    providerAccount: string;
    costSource: string;
    isByok: boolean | null;
    outcome: string;
    failurePhase: string | null;
    failureClass: string | null;
    failureStatus: number | null;
  }): string =>
    JSON.stringify([
      row.day,
      row.ownerId,
      row.articleId,
      row.articleSlug,
      row.recordedSlugHash,
      row.scopeKind,
      row.job,
      row.stepName,
      row.wire,
      row.requestedModel,
      row.answeredModel,
      row.upstream,
      row.providerAccount,
      row.costSource,
      row.isByok,
      row.outcome,
      row.failurePhase,
      row.failureClass,
      row.failureStatus,
    ]);
  const addAgreement = (
    groups: Map<string, AgreementTotals>,
    key: string,
    values: AgreementTotals,
  ): void => {
    const seen = groups.get(key) ?? {
      calls: 0,
      creditsNanos: 0,
      byokNanos: 0,
      computedNanos: 0,
      unpricedCalls: 0,
      counted: 0,
      retries: 0,
      gaveUp: 0,
    };
    seen.calls += values.calls;
    seen.creditsNanos += values.creditsNanos;
    seen.byokNanos += values.byokNanos;
    seen.computedNanos += values.computedNanos;
    seen.unpricedCalls += values.unpricedCalls;
    seen.counted += values.counted;
    seen.retries += values.retries;
    seen.gaveUp += values.gaveUp;
    groups.set(key, seen);
  };
  const cubeGroups = new Map<string, AgreementTotals>();
  for (const row of cube) {
    addAgreement(cubeGroups, keyOf(row), {
      calls: row.calls,
      creditsNanos: row.creditsNanos,
      byokNanos: row.byokNanos,
      computedNanos: row.computedNanos,
      unpricedCalls: row.unpricedCalls,
      counted: row.counted,
      retries: row.retries,
      gaveUp: row.gaveUp,
    });
  }
  const detailGroups = new Map<string, AgreementTotals>();
  for (const row of detail) {
    addAgreement(detailGroups, keyOf({ ...row, day: row.startedAt.slice(0, 10) }), {
      calls: 1,
      creditsNanos: row.creditsUsedNanos ?? 0,
      byokNanos: row.byokUpstreamNanos ?? 0,
      computedNanos: row.computedCostNanos ?? 0,
      unpricedCalls: detailIsUnpriced(row) ? 1 : 0,
      ...detailAttempt(row),
    });
  }
  let cubeDifferent = 0;
  let detailDifferent = 0;
  let differentGroups = 0;
  const groupKeys = new Set([...cubeGroups.keys(), ...detailGroups.keys()]);
  for (const key of groupKeys) {
    const fromCube = cubeGroups.get(key);
    const fromDetail = detailGroups.get(key);
    if (JSON.stringify(fromCube) === JSON.stringify(fromDetail)) continue;
    differentGroups++;
    if (fromCube) cubeDifferent++;
    if (fromDetail) detailDifferent++;
  }
  if (cubeDifferent > 0 || detailDifferent > 0) {
    throw new CostReadsDisagree(
      "the grouped population",
      cubeDifferent,
      detailDifferent,
      `the two reads of the ledger disagree on the grouped population: ${groupKeys.size} bucket(s) were compared and ${differentGroups} differed. ` +
        "No report was built.",
    );
  }
}

/* ---------------------------------------------------------------- helpers -- */

/** Money in a sentence: cents from a dollar up, the exact figure below. */
function usd(nanos: number): string {
  if (nanos === 0) return "$0";
  return nanos >= 1e9 ? `$${(nanos / 1e9).toFixed(2)}` : formatSpendNanos(nanos);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

const text = (value: string): Cell => ({ kind: "text", text: value });
const money = (nanos: number): Cell => ({ kind: "money", nanos });
const count = (n: number): Cell => ({ kind: "count", count: n });
const share = (value: number | null): Cell => ({ kind: "share", share: value });
const times = (value: number | null): Cell => ({ kind: "times", times: value });

function table(columns: string[], rows: Cell[][], limit = MOST_EXAMPLES): EvidenceTable {
  return { columns, rows: rows.slice(0, limit), omitted: Math.max(0, rows.length - limit) };
}

function slices(groups: readonly CubeGroup[], parentNanos: number): Slice[] {
  return groups.map((g) => ({
    key: g.key,
    label: g.label,
    recordedNanos: g.recordedNanos,
    share: parentNanos > 0 ? g.recordedNanos / parentNanos : null,
    calls: g.calls,
  }));
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

/** What an article is called: the asker's own by slug, anybody else's by an opaque id. */
function articleLabel(key: ArticleKey, slug: string | null): string {
  switch (key.kind) {
    case "article":
      return slug ?? `article ${shortId(key.id)}`;
    case "recorded":
      return slug ?? `recorded article ${shortId(key.id)}`;
    case "none":
      return "no article";
    default:
      return unreachable(key);
  }
}

function unreachable(value: never): never {
  throw new Error(`unhandled case: ${JSON.stringify(value)}`);
}

const NO_ARTICLE = articleKeyString({ kind: "none" });

interface Call {
  row: SpendDetailRow;
  nanos: number;
  unpriced: boolean;
  task: string;
  model: string;
  articleKey: string;
  articleLabel: string;
  /** The article's opaque label whoever owns it: two identities under one slug differ here. */
  articleOpaque: string;
}

function callOf(row: SpendDetailRow): Call {
  const key = articleKeyOf(row);
  return {
    articleOpaque: articleLabel(key, null),
    row,
    nanos: detailRecordedNanos(row),
    unpriced: detailIsUnpriced(row),
    task: taskOf(row),
    model: modelOf(row),
    articleKey: articleKeyString(key),
    articleLabel: articleLabel(key, row.articleSlug),
  };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const sumNanos = (calls: readonly Call[]): number => calls.reduce((n, c) => n + c.nanos, 0);

/** Every UTC day from `first` to `last`, both `YYYY-MM-DD`. */
function daysBetween(first: string, last: string): string[] {
  const days: string[] = [];
  const end = Date.parse(`${last}T00:00:00.000Z`);
  for (let at = Date.parse(`${first}T00:00:00.000Z`); at <= end; at += 86_400_000) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}

/* ------------------------------------------------------------- the leads -- */

/**
 * **Lead 1: one step, one article, more than one job.**
 *
 * Not "re-run" and not "wasted": the ledger cannot say whether the reader asked
 * again, the article changed, or the first job failed (GPT Sol, F1). A second
 * *collector* under one job is a different question, which
 * scripts/ai-cost.ts § `duplicateJobSteps` asks.
 */
function leadSeveralJobs(calls: readonly Call[]): Lead | null {
  const steps = calls.filter(
    (c) =>
      c.row.scopeKind === "job_step" &&
      c.row.stepName !== null &&
      c.row.jobId !== null &&
      c.articleKey !== NO_ARTICLE,
  );
  /* NUL between the parts, so no article key or step name can merge two groups. */
  const byArticleStep = groupBy(steps, (c) => `${c.articleKey}\u0000${c.task}`);
  const repeated: {
    article: string;
    key: string;
    step: string;
    jobs: number;
    firstDay: string;
    lastDay: string;
    total: number;
    extra: number;
  }[] = [];
  for (const group of byArticleStep.values()) {
    const perJob = [...groupBy(group, (c) => c.row.jobId as string).values()].map(sumNanos);
    if (perJob.length < 2) continue;
    const total = perJob.reduce((a, b) => a + b, 0);
    const first = group[0] as Call;
    /* The UTC days of the group's calls: an afternoon of development and a
       reader coming back three weeks later are the same count of jobs. */
    const days = group.map((c) => c.row.startedAt.slice(0, 10)).sort();
    repeated.push({
      article: first.articleLabel,
      key: first.articleOpaque,
      firstDay: days[0] as string,
      lastDay: days[days.length - 1] as string,
      step: first.task,
      jobs: perJob.length,
      total,
      extra: total - Math.max(...perJob),
    });
  }
  if (repeated.length === 0) return null;
  repeated.sort((a, b) => b.extra - a.extra || b.total - a.total);
  const extraJobs = repeated.reduce((n, r) => n + r.jobs - 1, 0);
  const extra = repeated.reduce((n, r) => n + r.extra, 0);
  const total = repeated.reduce((n, r) => n + r.total, 0);
  return {
    id: "step-in-several-jobs",
    title: "A step bought in more than one job for one article",
    detail:
      `Measured: ${plural(repeated.length, "article-step")} of ${byArticleStep.size.toLocaleString("en-US")} ` +
      `${repeated.length === 1 ? "was" : "were"} bought in more than one job, ${plural(extraJobs, "extra job")} in all; ` +
      `those article-steps recorded ${usd(total)}, and all but the most expensive job of each recorded ${usd(extra)}. ` +
      "It does not show why: the ledger cannot tell a reader asking for a step again from a retry after a failure or an article that changed, so none of this is shown to be avoidable. " +
      "Each row has the article's opaque key, because two articles can carry one slug, and the first and last day of its jobs.",
    evidence: {
      facts: [
        { label: "Article-steps bought in more than one job", value: count(repeated.length) },
        { label: "Article-steps with a job at all", value: count(byArticleStep.size) },
        { label: "Extra jobs", value: count(extraJobs) },
        { label: "Recorded on those article-steps, every job", value: money(total) },
        { label: "Recorded on all but the most expensive job of each", value: money(extra) },
      ],
      table: table(
        [
          "Article",
          "Article key",
          "Step",
          "Jobs",
          "First job (UTC day)",
          "Last job (UTC day)",
          "Every job",
          "All but the most expensive",
        ],
        repeated.map((r) => [
          text(r.article),
          text(r.key),
          text(r.step),
          count(r.jobs),
          text(r.firstDay),
          text(r.lastDay),
          money(r.total),
          money(r.extra),
        ]),
      ),
    },
    amountNanos: extra,
    confidence: "measured",
  };
}

/** **Lead 2: money on calls that did not finish.** */
function leadNotFinished(calls: readonly Call[]): Lead | null {
  const failed = calls.filter((c) => c.row.outcome !== "ok");
  if (failed.length === 0) return null;
  const amount = sumNanos(failed);
  const byTask = [...groupBy(failed, (c) => c.task)]
    .map(([task, list]) => ({
      task,
      calls: list.length,
      unpriced: list.filter((c) => c.unpriced).length,
      nanos: sumNanos(list),
    }))
    .sort((a, b) => b.nanos - a.nanos || b.calls - a.calls);
  const unpriced = failed.filter((c) => c.unpriced).length;
  return {
    id: "not-finished",
    title: "Money on calls that did not finish",
    detail:
      `Measured: ${plural(failed.length, "call")} ended as an error or were stopped, and the ledger records ${usd(amount)} on them. ` +
      `That figure is a floor: ${plural(unpriced, "of them reports", "of them report")} no money at all, and the 2026-10-05 audit found OpenRouter had charged for stopped calls the ledger shows as nothing. ` +
      "It does not show what the reader got for it, or whether the call was stopped on purpose.",
    evidence: {
      facts: [
        { label: "Calls that did not finish", value: count(failed.length) },
        { label: "Recorded on them", value: money(amount) },
        { label: "Of them, reporting no money", value: count(unpriced) },
      ],
      table: table(
        ["Mode or task", "Calls", "Reporting no money", "Recorded"],
        byTask.map((t) => [text(t.task), count(t.calls), count(t.unpriced), money(t.nanos)]),
      ),
    },
    amountNanos: amount,
    confidence: "measured",
  };
}

function summariseLookups(
  unpriced: readonly Call[],
  lookups: ReadonlyMap<string, UnpricedLookup>,
): LookupSummary {
  const summary: LookupSummary = {
    unpricedCalls: unpriced.length,
    noGenerationId: 0,
    notAsked: 0,
    asked: 0,
    found: 0,
    noRecord: 0,
    failed: 0,
    creditsNanos: 0,
    upstreamNanos: 0,
    knownShortfallNanos: 0,
  };
  for (const call of unpriced) {
    if (call.row.generationId === null) {
      summary.noGenerationId++;
      continue;
    }
    const answer = lookups.get(call.row.id);
    if (!answer) {
      summary.notAsked++;
      continue;
    }
    summary.asked++;
    switch (answer.kind) {
      case "found":
        summary.found++;
        summary.creditsNanos += answer.creditsNanos;
        summary.upstreamNanos += answer.upstreamNanos;
        break;
      case "no-record":
        summary.noRecord++;
        break;
      case "failed":
        summary.failed++;
        break;
      default:
        unreachable(answer);
    }
  }
  summary.knownShortfallNanos = summary.creditsNanos + summary.upstreamNanos;
  return summary;
}

/** **Lead 3: calls that reported no money**, and what OpenRouter says they cost when asked. */
function leadUnpriced(
  calls: readonly Call[],
  lookups: ReadonlyMap<string, UnpricedLookup> | null,
): { lead: Lead | null; lookup: LookupSummary | null } {
  const unpriced = calls.filter((c) => c.unpriced);
  const lookup = lookups ? summariseLookups(unpriced, lookups) : null;
  if (unpriced.length === 0) return { lead: null, lookup };
  const shortfallOf = (list: readonly Call[]): number =>
    list.reduce((n, c) => {
      const answer = lookups?.get(c.row.id);
      return answer?.kind === "found" ? n + answer.creditsNanos + answer.upstreamNanos : n;
    }, 0);
  const groups = [...groupBy(unpriced, (c) => `${c.task}\u0000${c.model}`).values()]
    .map((list) => {
      const first = list[0] as Call;
      return {
        task: first.task,
        model: first.model,
        calls: list.length,
        withId: list.filter((c) => c.row.generationId !== null).length,
        shortfall: shortfallOf(list),
      };
    })
    .sort((a, b) => b.shortfall - a.shortfall || b.calls - a.calls);
  const withId = unpriced.filter((c) => c.row.generationId !== null).length;
  const measured = lookup
    ? `OpenRouter was asked about ${plural(lookup.asked, "of them", "of them")}: ${lookup.found} had a record, ` +
      `${lookup.noRecord} had none and ${lookup.failed} could not be checked. The records found add up to ${usd(lookup.knownShortfallNanos)} ` +
      `(${usd(lookup.creditsNanos)} from our credits, ${usd(lookup.upstreamNanos)} billed to a provider key), which is the known shortfall and a floor.`
    : `${plural(withId, "of them carries", "of them carry")} an OpenRouter generation id and could be asked about with --lookup-unpriced; nobody asked in this run, so the shortfall is unknown, not zero.`;
  return {
    lookup,
    lead: {
      id: "unpriced",
      title: "Calls that reported no money",
      detail:
        `Measured: ${plural(unpriced.length, "call")} happened and recorded no amount, so every total here is short by what they cost. ${measured} ` +
        "It does not show the cost of a call with no generation id, or of one OpenRouter has no record of.",
      evidence: {
        facts: [
          { label: "Calls reporting no money", value: count(unpriced.length) },
          { label: "Of them, with a generation id", value: count(withId) },
          ...(lookup
            ? [
                { label: "Asked of OpenRouter", value: count(lookup.asked) },
                { label: "Record found", value: count(lookup.found) },
                { label: "No record", value: count(lookup.noRecord) },
                { label: "Could not check", value: count(lookup.failed) },
                { label: "Had an id, not asked (over the cap)", value: count(lookup.notAsked) },
                { label: "Known shortfall", value: money(lookup.knownShortfallNanos) },
              ]
            : []),
        ],
        table: table(
          ["Mode or task", "Model", "Calls", "With a generation id", ...(lookup ? ["Known shortfall"] : [])],
          groups.map((g) => [
            text(g.task),
            text(g.model),
            count(g.calls),
            count(g.withId),
            ...(lookup ? [money(g.shortfall)] : []),
          ]),
        ),
      },
      amountNanos: lookup?.knownShortfallNanos ?? 0,
      confidence: "measured",
    },
  };
}

/** **Lead 4: articles far above the median article**, and the task responsible. */
function leadArticleOutliers(
  rows: readonly CostCubeRow[],
  articles: readonly CubeGroup[],
  medianNanos: number,
): Lead | null {
  if (medianNanos <= 0) return null;
  const far = articles.filter(
    (a) =>
      a.recordedNanos >= ARTICLE_OUTLIER_TIMES * medianNanos &&
      a.recordedNanos >= ARTICLE_OUTLIER_MIN_NANOS,
  );
  if (far.length === 0) return null;
  const excess = far.reduce((n, a) => n + a.recordedNanos - medianNanos, 0);
  const lines = far.map((a) => {
    const mine = rows.filter((r) => dimensionValue(r, "article").key === a.key);
    const top = groupRows(mine, "task")[0];
    return [
      text(a.label),
      money(a.recordedNanos),
      times(a.recordedNanos / medianNanos),
      text(top?.label ?? "—"),
      money(top?.recordedNanos ?? 0),
      share(top && a.recordedNanos > 0 ? top.recordedNanos / a.recordedNanos : null),
    ];
  });
  return {
    id: "article-outliers",
    title: "Articles far above the median article",
    detail:
      `Measured: ${plural(far.length, "article")} recorded at least ${ARTICLE_OUTLIER_TIMES} times the median article (${usd(medianNanos)}) and at least ${usd(ARTICLE_OUTLIER_MIN_NANOS)}; ` +
      `together they are ${usd(excess)} above what that many median articles would have recorded. ` +
      "It does not show that anything went wrong: a long paper, or one its reader used heavily, costs more for good reason, and the ledger holds no article length.",
    evidence: {
      facts: [
        { label: "Articles far above the median", value: count(far.length) },
        { label: "Articles with any call", value: count(articles.length) },
        { label: "Median article", value: money(medianNanos) },
        { label: "Recorded above the median, together", value: money(excess) },
      ],
      table: table(
        ["Article", "Recorded", "Times the median", "Largest mode or task", "Its amount", "Its share"],
        lines,
      ),
    },
    amountNanos: excess,
    confidence: "measured",
  };
}

/** **Lead 5: single calls far above their task's median call.** */
function leadCallOutliers(calls: readonly Call[]): Lead | null {
  const far: { call: Call; median: number }[] = [];
  for (const list of groupBy(calls.filter((c) => !c.unpriced), (c) => c.task).values()) {
    const median = spread(list.map((c) => c.nanos)).median;
    if (median <= 0) continue;
    for (const call of list) {
      if (call.nanos >= CALL_OUTLIER_TIMES * median && call.nanos >= CALL_OUTLIER_MIN_NANOS) {
        far.push({ call, median });
      }
    }
  }
  if (far.length === 0) return null;
  far.sort((a, b) => b.call.nanos - a.call.nanos);
  const excess = far.reduce((n, f) => n + f.call.nanos - f.median, 0);
  return {
    id: "call-outliers",
    title: "Single calls far above their task's median call",
    detail:
      `Measured: ${plural(far.length, "call")} each recorded at least ${CALL_OUTLIER_TIMES} times the median priced call of the same mode or task and at least ${usd(CALL_OUTLIER_MIN_NANOS)}; ` +
      `together ${usd(excess)} above their tasks' medians. ` +
      "It does not show the cause: a very long article, a long conversation and a runaway output all look the same here, and the ledger holds no prompt.",
    evidence: {
      facts: [
        { label: "Calls far above their task's median", value: count(far.length) },
        { label: "Recorded above the median, together", value: money(excess) },
      ],
      table: table(
        ["Mode or task", "Model", "Article", "Call id", "Recorded", "Times the task's median call"],
        far.map((f) => [
          text(f.call.task),
          text(f.call.model),
          text(f.call.articleLabel),
          text(f.call.row.id),
          money(f.call.nanos),
          times(f.call.nanos / f.median),
        ]),
      ),
    },
    amountNanos: excess,
    confidence: "measured",
  };
}

/**
 * Cache-read share per task **on one wire**. The denominator is the wire's own
 * prompt-token total, which the two wires report differently:
 *
 * - `messages`: `reported_input_tokens` excludes cached tokens, so the total is
 *   input + cache read + cache write;
 * - `chat`: it includes them, so the total is `reported_input_tokens` itself.
 *
 * Any other wire has no figure here.
 */
export function cacheUseOf(detail: readonly SpendDetailRow[]): CacheUse[] {
  const calls = detail.filter((r) => r.wire === "messages" || r.wire === "chat").map(callOf);
  const out: CacheUse[] = [];
  for (const list of groupBy(calls, (c) => `${c.task}\u0000${c.row.wire}`).values()) {
    const first = list[0] as Call;
    let cacheRead = 0;
    let prompt = 0;
    for (const { row } of list) {
      const read = row.cacheReadTokens ?? 0;
      cacheRead += read;
      prompt +=
        row.wire === "messages"
          ? (row.reportedInputTokens ?? 0) + read + (row.cacheWriteTokens ?? 0)
          : (row.reportedInputTokens ?? 0);
    }
    const recordedNanos = sumNanos(list);
    const cacheReadShare = prompt > 0 ? cacheRead / prompt : null;
    /* One job, else one run (request work has no job id), else the call alone.
       The kind is in the key, so a job and a run spelled alike stay apart. */
    const perJob = [
      ...groupBy(list, ({ row }) =>
        row.jobId !== null ? `job:${row.jobId}` : row.runId ? `run:${row.runId}` : `call:${row.id}`,
      ).values(),
    ].map((group) => group.length);
    const medianCallsPerJob = spread(perJob).median;
    out.push({
      task: first.task,
      wire: first.row.wire,
      calls: list.length,
      medianCallsPerJob,
      articles: new Set(list.map((c) => c.articleKey).filter((k) => k !== NO_ARTICLE)).size,
      recordedNanos,
      cacheReadShare,
      flagged:
        list.length >= CACHE_MIN_CALLS &&
        medianCallsPerJob >= CACHE_MIN_CALLS_PER_JOB &&
        recordedNanos >= CACHE_MIN_NANOS &&
        cacheReadShare !== null &&
        cacheReadShare < CACHE_LOW_SHARE,
    });
  }
  return out.sort((a, b) => b.recordedNanos - a.recordedNanos || (a.task < b.task ? -1 : 1));
}

/**
 * **Lead 6: several calls per job, little cache reuse**, inside one wire.
 *
 * The lead flags; its table lists **every** pair of task and wire, so a pair
 * under a threshold is seen to be under it rather than missing.
 */
function leadCacheUse(cacheUse: readonly CacheUse[]): Lead | null {
  const flagged = cacheUse.filter((c) => c.flagged);
  if (flagged.length === 0) return null;
  const amount = flagged.reduce((n, c) => n + c.recordedNanos, 0);
  const listed = [...flagged, ...cacheUse.filter((c) => !c.flagged)];
  return {
    id: "low-cache-reuse",
    title: "Several calls per job, little cache reuse",
    detail:
      `Suggestive: ${plural(flagged.length, "mode or task", "modes or tasks")} made at least ${CACHE_MIN_CALLS} calls on one wire, typically several calls in one job (a median of at least ${CACHE_MIN_CALLS_PER_JOB}), recorded at least ${usd(CACHE_MIN_NANOS)}, and read less than ${Math.round(CACHE_LOW_SHARE * 100)}% of ${flagged.length === 1 ? "its" : "their"} prompt tokens from cache. ` +
      `A job that makes several calls of one task is the clearest place for reuse, and the only one this lead looks for. A pair that is not flagged has not been cleared: a cache can also be reused across requests, and across tasks in one job, and the table below lists every pair's share. ` +
      `The amount is everything the flagged calls recorded (${usd(amount)}), not what caching would save. ` +
      "It does not show that the calls of one job share a prefix that could be cached, or that the model and route support caching; each share is within one wire, because the two wires count input tokens differently.",
    evidence: {
      facts: [
        { label: "Flagged", value: count(flagged.length) },
        { label: "Recorded on them", value: money(amount) },
        { label: "Pairs of mode or task and wire, all listed", value: count(cacheUse.length) },
      ],
      table: table(
        [
          "Mode or task",
          "Wire",
          "Calls",
          "Calls per job (median)",
          "Articles",
          "Recorded",
          "Cache-read share of prompt tokens",
          "Flagged",
        ],
        listed.map((c) => [
          text(c.task),
          text(c.wire),
          count(c.calls),
          count(c.medianCallsPerJob),
          count(c.articles),
          money(c.recordedNanos),
          share(c.cacheReadShare),
          text(c.flagged ? "flagged" : ""),
        ]),
        listed.length,
      ),
    },
    amountNanos: amount,
    confidence: "suggestive",
  };
}

/** **Lead 7: where each model's money goes.** A table, and no judgement. */
function leadModelUse(rows: readonly CostCubeRow[]): Lead | null {
  const pivot = pivotRows(rows, "task", "model");
  if (pivot.rows.length === 0) return null;
  const lines: { cells: Cell[]; nanos: number }[] = [];
  for (const task of pivot.rows) {
    const across = pivot.cells.get(task.key);
    if (!across) continue;
    const models = pivot.columns
      .map((m) => ({ label: m.label, totals: across.get(m.key) }))
      .filter((m): m is { label: string; totals: CubeTotals } => m.totals !== undefined)
      .sort((a, b) => b.totals.recordedNanos - a.totals.recordedNanos);
    const top = models[0];
    for (const m of models) {
      lines.push({
        nanos: m.totals.recordedNanos,
        cells: [
          text(task.label),
          text(m.label),
          count(m.totals.calls),
          money(m.totals.recordedNanos),
          share(task.recordedNanos > 0 ? m.totals.recordedNanos / task.recordedNanos : null),
          text(m === top ? "largest share of this task" : ""),
        ],
      });
    }
  }
  lines.sort((a, b) => b.nanos - a.nanos);
  return {
    id: "model-by-task",
    title: "Where each model is used",
    detail:
      `Measured: recorded amount for each of the ${plural(lines.length, "pair")} of mode or task and answering model, largest first, with the share of its task each model carries. The last column marks, for each task, the model carrying the largest share of that task's recorded amount; it says nothing about which model has the highest price. ` +
      "No amount is at stake by this table alone: it does not show whether a cheaper model would do the job as well, which only an eval of that task can.",
    evidence: {
      facts: [
        { label: "Modes or tasks", value: count(pivot.rows.length) },
        { label: "Answering models", value: count(pivot.columns.length) },
      ],
      table: table(
        ["Mode or task", "Model", "Calls", "Recorded", "Share of the task", "Carries most of the task"],
        lines.map((l) => l.cells),
        40,
      ),
    },
    amountNanos: 0,
    confidence: "measured",
  };
}

/* ----------------------------------------------------------- the analysis -- */

/** `user 001bb7a0` for an owner with no email to show. */
export function userLabelOf(ownerId: string, email: string | null | undefined): string {
  return email ?? `user ${shortId(ownerId)}`;
}

/**
 * The whole analysis. Throws `CostReadsDisagree` before computing anything if
 * the two reads differ.
 */
export function analyseCosts(input: CostAnalysisInput): CostAnalysis {
  assertReadsAgree(input.cube, input.detail);

  const everyRow: CostCubeRow[] = input.cube.map((g) => ({ ...g, category: costCategoryOf(g) }));
  const rows = input.includeNonProduct ? everyRow : partitionByScope(everyRow).product;
  const detail = input.includeNonProduct ? [...input.detail] : partitionByScope(input.detail).product;
  const calls = detail.map(callOf);

  const everything = totalsOf(everyRow);
  const cubeTotals = totalsOf(rows);
  const days = rows.map((r) => r.day).sort();
  const firstDay = days[0] ?? null;
  const lastDay = days[days.length - 1] ?? null;
  const totals: CostTotals = {
    creditsNanos: cubeTotals.creditsNanos,
    byokNanos: cubeTotals.byokNanos,
    computedNanos: cubeTotals.computedNanos,
    recordedNanos: cubeTotals.recordedNanos,
    estimatedCashNanos: estimatedCashNanos(cubeTotals),
    calls: cubeTotals.calls,
    pricedCalls: cubeTotals.pricedCalls,
    unpricedCalls: cubeTotals.unpricedCalls,
    failedCalls: cubeTotals.failedCalls,
    failedRecordedNanos: cubeTotals.failedRecordedNanos,
    firstDay,
    lastDay,
  };

  const owners: OwnerEmails = new Map(
    [...new Set(rows.map((r) => r.ownerId))].map((id) => [id, userLabelOf(id, input.emails.get(id))]),
  );
  const rowsBy = (dim: "user" | "article" | "task" | "model") =>
    groupBy(rows, (r) => dimensionValue(r, dim).key);

  /* Who spends most. */
  const byUser = rowsBy("user");
  const users: UserRank[] = groupRows(rows, "user", owners).map((g) => ({
    key: g.key,
    label: g.label,
    recordedNanos: g.recordedNanos,
    share: totals.recordedNanos > 0 ? g.recordedNanos / totals.recordedNanos : null,
    calls: g.calls,
    unpricedCalls: g.unpricedCalls,
    topTasks: slices(groupRows(byUser.get(g.key) ?? [], "task").slice(0, 3), g.recordedNanos),
  }));

  /* Why an article costs what it does. */
  const articleGroups = groupRows(rows, "article");
  const real = articleGroups.filter((a) => a.key !== NO_ARTICLE);
  const none = articleGroups.find((a) => a.key === NO_ARTICLE);
  const medianNanos = spread(real.map((a) => a.recordedNanos)).median;
  const byArticle = rowsBy("article");
  const callsByArticle = groupBy(calls, (c) => c.articleKey);
  const top: ArticleRank[] = real.slice(0, input.top).map((a) => {
    const mine = byArticle.get(a.key) ?? [];
    const jobIds = (callsByArticle.get(a.key) ?? []).flatMap((c) => (c.row.jobId === null ? [] : [c.row.jobId]));
    return {
      key: a.key,
      label: a.label,
      recordedNanos: a.recordedNanos,
      share: totals.recordedNanos > 0 ? a.recordedNanos / totals.recordedNanos : null,
      calls: a.calls,
      owner: owners.get(mine[0]?.ownerId ?? "") ?? "—",
      jobs: new Set(jobIds).size,
      timesMedian: medianNanos > 0 ? a.recordedNanos / medianNanos : null,
      byTask: slices(groupRows(mine, "task"), a.recordedNanos),
      byModel: slices(groupRows(mine, "model"), a.recordedNanos),
    };
  });

  /* Why a mode or task costs what it does. */
  const byTask = rowsBy("task");
  const callsByTask = groupBy(calls, (c) => c.task);
  const tasks: TaskRank[] = groupRows(rows, "task").map((g) => {
    const mine = byTask.get(g.key) ?? [];
    const priced = (callsByTask.get(g.label) ?? []).filter((c) => !c.unpriced).map((c) => c.nanos);
    const stats = spread(priced);
    return {
      key: g.key,
      label: g.label,
      recordedNanos: g.recordedNanos,
      share: totals.recordedNanos > 0 ? g.recordedNanos / totals.recordedNanos : null,
      calls: g.calls,
      categories: groupRows(mine, "category").map((c) => c.label),
      pricedCalls: g.pricedCalls,
      unpricedCalls: g.unpricedCalls,
      articles: new Set(mine.map((r) => dimensionValue(r, "article").key).filter((k) => k !== NO_ARTICLE)).size,
      perCall:
        priced.length > 0
          ? { medianNanos: stats.median, p95Nanos: stats.p95, maxNanos: stats.max, calls: priced.length }
          : null,
      models: slices(groupRows(mine, "model"), g.recordedNanos),
    };
  });

  /* By answering model. */
  const byModel = rowsBy("model");
  const models: ModelRank[] = groupRows(rows, "model").map((g) => ({
    key: g.key,
    label: g.label,
    recordedNanos: g.recordedNanos,
    share: totals.recordedNanos > 0 ? g.recordedNanos / totals.recordedNanos : null,
    calls: g.calls,
    tasks: slices(groupRows(byModel.get(g.key) ?? [], "task"), g.recordedNanos),
  }));

  /* Over time, by category. */
  const perDay = pivotRows(rows, "day", "category");
  const nanos: Record<string, Record<string, number>> = {};
  for (const [day, across] of perDay.cells) {
    nanos[day] = Object.fromEntries([...across].map(([category, cell]) => [category, cell.recordedNanos]));
  }

  const cacheUse = cacheUseOf(detail);
  const unpriced = leadUnpriced(calls, input.lookups);
  const leads = [
    leadSeveralJobs(calls),
    leadNotFinished(calls),
    unpriced.lead,
    leadArticleOutliers(rows, real, medianNanos),
    leadCallOutliers(calls),
    leadCacheUse(cacheUse),
    leadModelUse(rows),
  ]
    .filter((lead): lead is Lead => lead !== null)
    /* Stable: equal amounts keep the order above. */
    .sort((a, b) => b.amountNanos - a.amountNanos);

  return {
    target: input.target,
    window: input.window,
    generatedAt: input.generatedAt,
    scope: input.includeNonProduct ? "all" : "product",
    excluded: {
      calls: everything.calls - cubeTotals.calls,
      recordedNanos: everything.recordedNanos - cubeTotals.recordedNanos,
    },
    userLabels: input.userLabels,
    totals,
    users,
    articles: {
      count: real.length,
      medianNanos,
      noArticle: { calls: none?.calls ?? 0, recordedNanos: none?.recordedNanos ?? 0 },
      top,
    },
    tasks,
    models,
    overTime: {
      days: firstDay !== null && lastDay !== null ? daysBetween(firstDay, lastDay) : [],
      categories: perDay.columns.map((c) => c.label),
      nanos,
    },
    cacheUse,
    failures: {
      total: failureCountsOf(rows),
      byDay: failureCountsBy(rows, "day").sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
      byTask: failureCountsBy(rows, "task"),
      causes: failureCauses(rows),
      notes: [...FAILURE_NOTES],
    },
    lookup: unpriced.lookup,
    leads,
  };
}
