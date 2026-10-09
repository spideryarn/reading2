/**
 * **Per-owner spend, aggregated by Postgres** — the query Stripe and the price
 * are going to be argued from.
 *
 * ## Why this is not on `CostStore`
 *
 * Every other ledger question has two implementations, because
 * [ai-calls-fs.ts](ai-calls-fs.ts) has to work on a laptop with no database.
 * This one deliberately has one. GPT Sol, reviewing the plan on 2026-09-02:
 *
 * > Do not widen `CostStore` merely to preserve filesystem parity for a pricing
 * > query whose source of truth is Postgres.
 *
 * The filesystem ledger is development evidence — `docs/plans/260902g-…` § the
 * cutoff records the decision that **Postgres is authoritative from the Stage 1
 * deployment timestamp**, with no import of the JSONL history. A second
 * implementation of this over a file would be a second answer to a pricing
 * question, and the wrong one would look exactly like the right one.
 *
 * ## Why it is a `GROUP BY` and not a fold over `read()`
 *
 * `CostStore.read(since, until)` fetches **every row in the window** and sums in
 * JavaScript. That is fine at four thousand rows and not at four hundred
 * thousand, and a monthly per-owner total is the thing that will be asked for
 * every billing period for ever.
 *
 * The grouping keys are `(owner, scope_kind, purpose, step_name)` rather than
 * `(owner, category)`, and that split is on purpose: **Postgres does the
 * arithmetic, TypeScript does the naming.** Categorisation is a judgement about
 * what the schema can honestly claim (see
 * [../cost-categories.ts](../cost-categories.ts)), it changes as jobs are added,
 * and it is worth having under test without a database. Encoding it as a SQL
 * `CASE` would put it somewhere no unit test can reach and somewhere a peer
 * writing their own query would not find it. The grouped result is bounded by
 * owners × jobs × steps — tens of rows, not hundreds of thousands.
 *
 * ## The money expression, and why it is finally safe in SQL
 *
 *     coalesce(credits_used_nanos, 0)
 *   + coalesce(byok_upstream_nanos, 0)
 *   + coalesce(computed_cost_nanos, 0)
 *
 * That was **wrong** until 2026-09-02. `upstream_inference_nanos` was written on
 * every chat-wire call, BYOK or not, holding the same money as
 * `credits_used_nanos`, so the obvious sum doubled the bill — an auditor got
 * $23.54 where the truth was $11.77. The rule that made a total correct lived
 * only in `totalRows()` in JavaScript. drizzle/20260902141103 renamed the column
 * `byok_upstream_nanos` and nulls it off a BYOK row, under a CHECK, precisely so
 * that this expression is the whole of a row's money and nothing has to be
 * conditional. `tests/store-ai-calls.test.ts` holds this sum against
 * `totalRows()`; do not reinvent the old conditional here.
 *
 * ## The second file in this directory allowed to group by owner
 *
 * Every other module under `src/store/` answers *"what does this reader have"*,
 * and `tests/owner-isolation.test.ts` greps for `groupBy(….ownerId)` — the shape
 * of a question asked *across* owners — and fails on any file but the two named
 * there. [pg-admin.ts](pg-admin.ts) was the first; this is the second, added
 * 2026-09-02 with the same justification and under the same rule:
 *
 * - `/admin/users` and `/admin/costs` read it through the `/api/admin` gate in
 *   `src/routes.ts`, which is the whole of the enforcement
 *   (docs/project/admin.md).
 * - `npm run cost -- --owners` reads it from a CLI on Greg's own machine, and
 *   so does `npm run cost:analyse` (`spendCube` and `spendDetail`), which
 *   writes its report to a file only its owner can read.
 * - **What it returns across owners**: money, an owner id, an opaque article
 *   id, and the names of jobs, steps and models — and a slug only for the
 *   administrator's own articles. For a failed attempt, where it failed, a
 *   label from a closed list and an HTTP status (src/call-failure.ts: never
 *   text from an error). No title, no URL, no other owner's slug, no
 *   sentence of anybody's reading.
 *
 * Until 2026-10-05 that list was "money and an owner id and nothing else".
 * `spendCube` widened it because Greg asked for it on 2026-10-04 (report
 * spya-mykvhz): a page that *"breaks down by user (and then within user, by
 * article) or mode or model"*. Which articles an account has spent on, and on
 * what, is now visible to the administrator; what any of them is called is not.
 *
 * A third would be a decision about who may see across owners, which is why the
 * list is in the test rather than a per-file opt-out somewhere quieter.
 *
 * ## What may be logged from this file
 *
 * Nothing. It returns what the section above lists to one CLI and the admin
 * routes, and the insert path's `guardDbStore` reasoning applies to the callers
 * rather than here — these statements bind two timestamps and, in `spendCube`,
 * the asker's own id.
 */

import { createHmac } from "node:crypto";

import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { CostCubeGroup } from "../cost-cube.js";
import { type Db, getDb } from "../db/client.js";
import { aiCalls } from "../db/schema.js";
import { TRANSPORT_ATTEMPTS } from "../transport-retry.js";

/**
 * One `(owner, scope, job, step)` bucket. The four keys are what the ledger
 * knows about provenance; `src/cost-categories.ts` turns them into a name.
 */
export interface SpendGroup {
  ownerId: string;
  scopeKind: string;
  /** `ai_calls.purpose` — `structure`, `chat`, `live_conversation`, … */
  job: string;
  stepName: string | null;
  calls: number;
  /**
   * The three pockets, kept apart all the way out of the database for the
   * reason `totalRows()` gives: `credits` is what OpenRouter deducted and can be
   * reconciled against their own running total, `byok` was billed to somebody
   * else's key, and `computed` is our arithmetic over a price table nobody
   * checks. Adding them is a caller's deliberate act, and the cash uplift below
   * applies to exactly one of them.
   */
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
  /** `cost_source = 'provider'` — OpenRouter answered, including a BYOK zero. */
  settledCalls: number;
  /** `cost_source = 'computed'` — priced here, never reconciled. */
  computedCalls: number;
  /**
   * Calls that happened and reported no money — **the same condition
   * `totalRows()` uses**, restated in SQL, because a per-owner figure that
   * cannot say it is short is false precision.
   *
   * It is not disjoint from `settledCalls`: a BYOK row where OpenRouter answered
   * (`cost: 0`, so `provider`) but reported no upstream figure is both settled
   * and unpriced. That is the truth about the row rather than a bug in the
   * count, and the report says so rather than pretending the four numbers
   * partition.
   */
  unpricedCalls: number;
}

/** What one owner cost over a window, with the honesty marker beside it. */
export interface OwnerSpend {
  nanos: number;
  calls: number;
  unpricedCalls: number;
}

/**
 * **The current UTC month**, as a half-open range and a label — the one
 * definition, used by the admin column and by `npm run cost`.
 *
 * A defined period is GPT Sol's condition on putting spend on `/admin/users`:
 * *"A bare currency number would overclaim."* So the period has to be stated
 * wherever the number is, and stated the same way in both places — a column
 * headed "this month" that quietly means something else from the CLI is a
 * discrepancy nobody would chase.
 *
 * UTC, like everything else in this ledger, and for a reason beyond consistency:
 * OpenRouter's key limits reset at midnight UTC, so it is the only boundary the
 * reconciliation can share. A call at 00:30 BST on 1 September is an August call
 * here.
 *
 * This is **not** the period a Stripe invoice covers, and must never become one
 * — billing periods start on the day somebody subscribed. It is a reporting
 * window; `spendGroupedByOwner` takes arbitrary bounds precisely so that the
 * billing question can be asked properly when there is a subscription to ask it
 * of.
 */
export function currentUtcMonth(): { since: string; until: string; label: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  return {
    since: new Date(Date.UTC(year, month, 1)).toISOString(),
    until: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    label: `${year}-${String(month + 1).padStart(2, "0")}`,
  };
}

/** `[since, until)` — the end is the first instant *not* counted. */
function window(since?: string, until?: string) {
  const bounds = [
    ...(since ? [gte(aiCalls.startedAt, new Date(since))] : []),
    ...(until ? [lt(aiCalls.startedAt, new Date(until))] : []),
  ];
  return bounds.length > 0 ? and(...bounds) : undefined;
}

/*
 * `.mapWith(Number)` on every figure, and it is load-bearing rather than
 * decorative — the same trap `pg-admin.ts` documents. A `sql` fragment carries a
 * TypeScript type and no runtime conversion, and node-postgres hands `count()`
 * back as a **string** (it is `bigint`) and `sum()` as a **string** (it is
 * `numeric`), so that precision cannot be lost in transit. Without the mapper
 * every number here would be a string that sorts "10" below "9" and concatenates
 * under `+`, which is a per-owner bill that is wrong in a way no type would
 * catch.
 */
const CALLS = sql<number>`count(*)`.mapWith(Number);

const CREDITS = sql<number>`coalesce(sum(${aiCalls.creditsUsedNanos}), 0)`.mapWith(Number);
const BYOK = sql<number>`coalesce(sum(${aiCalls.byokUpstreamNanos}), 0)`.mapWith(Number);
const COMPUTED = sql<number>`coalesce(sum(${aiCalls.computedCostNanos}), 0)`.mapWith(Number);

const SETTLED_CALLS = sql<number>`count(*) filter (where ${aiCalls.costSource} = 'provider')`.mapWith(
  Number,
);
const COMPUTED_CALLS =
  sql<number>`count(*) filter (where ${aiCalls.costSource} = 'computed')`.mapWith(Number);

/**
 * **`totalRows()`'s definition of unpriced, in SQL.** The two must not drift:
 * `tests/ai-calls-spend-pg.test.ts` runs both over the same fixtures and
 * compares.
 *
 * A `computed` row is never unpriced — it has no `credits_used_nanos` at all and
 * counting it would be the one thing it is not. Off a computed row, which figure
 * is supposed to be there depends on `is_byok`, and `is true` rather than a bare
 * truthiness test because the column is `boolean | null` and "we were not told"
 * is not "no".
 */
const UNPRICED_CALLS = sql<number>`count(*) filter (
  where ${aiCalls.costSource} <> 'computed'
    and case when ${aiCalls.isByok} is true
             then ${aiCalls.byokUpstreamNanos} is null
             else ${aiCalls.creditsUsedNanos} is null
        end
)`.mapWith(Number);

/**
 * **Attempts, retries and give-ups**, as measures rather than a grouping by
 * `attempt` — GPT Sol's F4 on plan 261006b: the ordinal would multiply the
 * cube's groups for nothing a table needs.
 *
 * `counted` is the attempts a retry loop of ours numbered; a retry is any go
 * after the first; a give-up is the last go allowed failing before its answer
 * began. The limit is written into the statement as a literal, from the one
 * constant the two wires share, so the cube still binds nothing but its window
 * and the asker's id. `tests/admin-costs-store.test.ts` holds all three against
 * the rows.
 */
const COUNTED_ATTEMPTS = sql<number>`count(*) filter (where ${aiCalls.attempt} is not null)`.mapWith(
  Number,
);
const RETRIES = sql<number>`count(*) filter (where ${aiCalls.attempt} > 1)`.mapWith(Number);
const GAVE_UP = sql<number>`count(*) filter (
  where ${aiCalls.outcome} = 'error'
    and ${aiCalls.failurePhase} = 'before_answer'
    and ${aiCalls.attempt} = ${sql.raw(String(TRANSPORT_ATTEMPTS))}
)`.mapWith(Number);

/**
 * **Every owner's spend over `[since, until)`, split by what the work was.**
 *
 * Arbitrary bounds rather than a calendar month, because **Stripe billing
 * periods are not months** — somebody who subscribes on the 14th has a period
 * that starts on the 14th, and a query that could only answer for a month would
 * have to be rewritten the day the first invoice is raised. This is the note the
 * plan hands to the Stripe agent verbatim.
 *
 * Owners with no calls in the window are **not** in this result, and cannot be:
 * a `GROUP BY` over the ledger has nothing to group for them. That is a real
 * bias — it makes every average over "owners" an average over *spending* owners
 * — and closing it needs a denominator from outside this table. The report gets
 * one from the Auth service (`src/store/admin-accounts.ts`) and labels it.
 */
export async function spendGroupedByOwner(
  since?: string,
  until?: string,
): Promise<SpendGroup[]> {
  const rows = await getDb()
    .select({
      ownerId: aiCalls.ownerId,
      scopeKind: aiCalls.scopeKind,
      job: aiCalls.purpose,
      stepName: aiCalls.stepName,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      settledCalls: SETTLED_CALLS,
      computedCalls: COMPUTED_CALLS,
      unpricedCalls: UNPRICED_CALLS,
    })
    .from(aiCalls)
    .where(window(since, until))
    .groupBy(aiCalls.ownerId, aiCalls.scopeKind, aiCalls.purpose, aiCalls.stepName);
  return rows;
}

/**
 * **What each owner's own reading cost this period** — the number the admin page
 * puts in a column.
 *
 * `scope_kind in ('request', 'job_step')` and nothing else, so an eval run or a
 * dev CLI invocation does not appear on the row of whoever's owner id the
 * environment happened to be carrying. That is *our* spend measuring something,
 * and on a per-account page it would read as a reader who costs forty times what
 * anybody else does. The filter is a scope test rather than the category
 * classifier on purpose: this file must stay importable from the store layer,
 * and `src/cost-categories.ts` reaches `src/pipeline.ts`, which reaches back
 * into the stores. `npm run cycles` is a gate.
 *
 * One statement, one group, one index (`ai_calls_owner_started`) — it stands
 * beside the five aggregates `pg-admin.ts` already runs in parallel rather than
 * adding a query per account.
 */
export async function productSpendByOwner(
  since?: string,
  until?: string,
): Promise<Map<string, OwnerSpend>> {
  const scope = sql`${aiCalls.scopeKind} in ('request', 'job_step')`;
  const bounds = window(since, until);
  const rows = await getDb()
    .select({
      ownerId: aiCalls.ownerId,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      unpricedCalls: UNPRICED_CALLS,
    })
    .from(aiCalls)
    .where(bounds ? and(bounds, scope) : scope)
    .groupBy(aiCalls.ownerId);

  return new Map(
    rows.map((r) => [
      r.ownerId,
      {
        nanos: r.creditsNanos + r.byokNanos + r.computedNanos,
        calls: r.calls,
        unpricedCalls: r.unpricedCalls,
      },
    ]),
  );
}

/** What one collector's calls cost: `spendByRun`'s answer for one `run_id`. */
export interface RunSpend {
  nanos: number;
  calls: number;
  unpricedCalls: number;
}

/**
 * **What each of these collectors spent**, by `run_id` — for a feature that
 * stores its own run's id and wants its cost back from the one home cost has
 * (an author gift's lookups, plan 261009u D5). The same three pockets and the
 * same unpriced rule as every other read here, so it cannot drift from
 * `/admin/costs`. A run with no rows is absent from the map, not zero.
 *
 * Not owner-scoped: its only caller is an admin route.
 */
export async function spendByRun(runIds: readonly string[]): Promise<Map<string, RunSpend>> {
  if (runIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      runId: aiCalls.runId,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      unpricedCalls: UNPRICED_CALLS,
    })
    .from(aiCalls)
    .where(inArray(aiCalls.runId, [...runIds]))
    .groupBy(aiCalls.runId);
  return new Map(
    rows.map((r) => [
      r.runId,
      { nanos: r.creditsNanos + r.byokNanos + r.computedNanos, calls: r.calls, unpricedCalls: r.unpricedCalls },
    ]),
  );
}

/** The most groups `spendCube` will return. Measured 2026-10-05: production groups to 660. */
export const SPEND_CUBE_MAX_GROUPS = 20_000;

/** The window groups to more than the cap. Thrown rather than truncating. */
export class SpendCubeTooLarge extends Error {
  constructor(readonly maxGroups: number) {
    super(`the cost cube for this window has more than ${maxGroups} groups`);
    this.name = "SpendCubeTooLarge";
  }
}

/* `at time zone 'UTC'`, never the session's zone: the ledger's day is UTC. No
   bound parameter, so the select and the `group by` render the same text. */
const UTC_DAY = sql<string>`to_char(${aiCalls.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`;

/**
 * **The cost cube**: the ledger over `[since, until)`, grouped by everything
 * `/admin/costs` and `npm run cost:analyse` break spend down by. One query;
 * every table, pivot and chart is a fold of its rows (src/cost-cube.ts).
 * docs/plans/261005a-admin-costs-page-cost-analysis-report-and-a-cost-tracking-audit.md.
 *
 * ## No other owner's slug leaves the database
 *
 * A slug is usually made from the title, so it says what somebody reads.
 * `adminOwnerId` is whoever is asking, and only that owner's rows carry
 * `articleSlug`. Anybody else's article is its opaque `articleId`; a row of
 * theirs with a slug and no id gets `recordedSlugHash`, which keeps two
 * recorded slugs apart and names neither.
 *
 * **Grouped by the underlying columns**, not by the two `case` expressions, so
 * two slugs can never merge into one group — and because the bound owner id is
 * a different parameter each time it is written, which `group by` would not
 * recognise as the selected expression.
 *
 * A row with an `articleId` is that article. One with only a recorded slug is
 * not claimed to be: a deleted article's slug can be minted again (`belongsTo`
 * below). No token or duration measure — the wires disagree about what an
 * input token is, and summed duration is not elapsed time.
 */
export async function spendCube(
  since: string | undefined,
  until: string | undefined,
  adminOwnerId: string,
  privacyKey: string,
  maxGroups: number = SPEND_CUBE_MAX_GROUPS,
  /* The database to ask. `npm run cost:analyse -- --prod` passes production's,
     over its own read-only connection (src/db/client.ts § `drizzleOver`). */
  db: Db = getDb(),
): Promise<CostCubeGroup[]> {
  if (privacyKey.length === 0) throw new Error("the cost cube needs a privacy key");
  const ownSlug = ownSlugOf(adminOwnerId);
  const recordedSlugDigest = RECORDED_SLUG_DIGEST;
  const rows = await db
    .select({
      day: UTC_DAY,
      ownerId: aiCalls.ownerId,
      articleId: aiCalls.articleId,
      articleSlug: ownSlug,
      recordedSlugDigest,
      scopeKind: aiCalls.scopeKind,
      job: aiCalls.purpose,
      stepName: aiCalls.stepName,
      wire: aiCalls.wire,
      requestedModel: aiCalls.requestedModel,
      answeredModel: aiCalls.answeredModel,
      upstream: aiCalls.upstream,
      providerAccount: aiCalls.providerAccount,
      costSource: aiCalls.costSource,
      isByok: aiCalls.isByok,
      outcome: aiCalls.outcome,
      failurePhase: aiCalls.failurePhase,
      failureClass: aiCalls.failureClass,
      failureStatus: aiCalls.failureStatus,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      unpricedCalls: UNPRICED_CALLS,
      computedCalls: COMPUTED_CALLS,
      settledCalls: SETTLED_CALLS,
      counted: COUNTED_ATTEMPTS,
      retries: RETRIES,
      gaveUp: GAVE_UP,
    })
    .from(aiCalls)
    .where(window(since, until))
    .groupBy(
      UTC_DAY,
      aiCalls.ownerId,
      aiCalls.articleId,
      aiCalls.articleSlug,
      aiCalls.scopeKind,
      aiCalls.purpose,
      aiCalls.stepName,
      aiCalls.wire,
      aiCalls.requestedModel,
      aiCalls.answeredModel,
      aiCalls.upstream,
      aiCalls.providerAccount,
      aiCalls.costSource,
      aiCalls.isByok,
      aiCalls.outcome,
      /* Null on nearly every row, so these three barely add groups. */
      aiCalls.failurePhase,
      aiCalls.failureClass,
      aiCalls.failureStatus,
    )
    /* One past the cap, so "exactly the cap" and "more than it" can be told apart. */
    .limit(maxGroups + 1);
  if (rows.length > maxGroups) throw new SpendCubeTooLarge(maxGroups);
  return rows.map(({ recordedSlugDigest: digest, ...row }) => ({
    ...row,
    recordedSlugHash: recordedSlugHashOf(digest, privacyKey),
  }));
}

/* ---- the slug masking, shared by the cube and the detail rows ------------ */

/** The asker's own slug; null on anybody else's row. */
function ownSlugOf(adminOwnerId: string) {
  return sql<string | null>`case when ${aiCalls.ownerId} = ${adminOwnerId}
    then ${aiCalls.articleSlug} end`;
}

/* The database works on the real slug but lets only a one-way digest cross
   the boundary. Node keys that digest with a secret (`recordedSlugHashOf`):
   unlike the old bare MD5, the value that leaves cannot be checked against a
   dictionary of likely title-derived slugs. */
const RECORDED_SLUG_DIGEST = sql<string | null>`case
    when ${aiCalls.articleId} is null
     and ${aiCalls.articleSlug} is not null
    then encode(sha256(convert_to(${aiCalls.ownerId}::text || ':' || ${aiCalls.articleSlug}, 'UTF8')), 'hex') end`;

function recordedSlugHashOf(digest: string | null, privacyKey: string): string | null {
  return digest === null
    ? null
    : createHmac("sha256", privacyKey)
        .update(`spideryarn/admin-costs/recorded-slug\0${digest}`)
        .digest("hex");
}

/* ---- one row per call, for the analysis script --------------------------- */

/** The most rows `spendDetail` will return. Production held 2,245 on 2026-10-05. */
export const SPEND_DETAIL_MAX_ROWS = 200_000;

/** The window holds more calls than the cap. Thrown rather than truncating. */
export class SpendDetailTooLarge extends Error {
  constructor(readonly maxRows: number) {
    super(`this window has more than ${maxRows} calls; ask for a shorter period`);
    this.name = "SpendDetailTooLarge";
  }
}

/**
 * One ledger row, as `npm run cost:analyse` reads it. The article is masked
 * exactly as a `CostCubeGroup`'s is, so `articleKeyOf` reads both.
 */
export interface SpendDetailRow {
  id: string;
  /** One collector: one execution of a step, or one request. */
  runId: string;
  jobId: string | null;
  /** OpenRouter's id for the call, when the response carried one. */
  generationId: string | null;
  /** ISO, UTC. */
  startedAt: string;
  ownerId: string;
  articleId: string | null;
  /** **The asker's own articles only.** */
  articleSlug: string | null;
  recordedSlugHash: string | null;
  scopeKind: string;
  /** `ai_calls.purpose`. */
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
  /**
   * Which go this row was, 1-based; null when no retry loop of ours numbered
   * it. The cube turns it into three counts and the analysis checks them
   * against this (src/cost-analysis.ts § `assertReadsAgree`).
   */
  attempt: number | null;
  failurePhase: string | null;
  failureClass: string | null;
  failureStatus: number | null;
  eventKind: string | null;
  /* The three pockets as the row holds them. **Null is "reported nothing"**,
     which is not zero — `UNPRICED_CALLS` above is the rule that reads them. */
  creditsUsedNanos: number | null;
  byokUpstreamNanos: number | null;
  computedCostNanos: number | null;
  /**
   * **Means two things.** On the Messages wire it excludes cached tokens; on
   * the chat wire it includes them (docs/investigations/261005a-…, check 1).
   * Never add it across wires.
   */
  reportedInputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  reasoningTokens: number | null;
  webSearches: number | null;
  /** One call's own duration. Summed, it is not elapsed time. */
  durationMs: number | null;
}

/**
 * **Every call in `[since, until)`, one row each** — what the cube cannot
 * hold: a call's own cost, its `run_id` and `job_id`, its tokens. The cost
 * analysis builds its leads from these (GPT Sol's plan review, F1) and checks
 * them against the cube before it reports anything.
 *
 * The same privacy rule as `spendCube`, through the same three helpers: no
 * other owner's slug leaves the database. **This table and no other** — it
 * holds no prompt and no response, and nothing here joins to one that does.
 *
 * Not grouped, so it is not a question asked across owners in the sense
 * tests/owner-isolation.test.ts greps for; it is still one, and it is reached
 * only by a CLI on the administrator's own machine.
 */
export async function spendDetail(
  since: string | undefined,
  until: string | undefined,
  adminOwnerId: string,
  privacyKey: string,
  opts: { maxRows?: number; db?: Db } = {},
): Promise<SpendDetailRow[]> {
  if (privacyKey.length === 0) throw new Error("the cost detail needs a privacy key");
  const maxRows = opts.maxRows ?? SPEND_DETAIL_MAX_ROWS;
  const rows = await (opts.db ?? getDb())
    .select({
      id: aiCalls.id,
      runId: aiCalls.runId,
      jobId: aiCalls.jobId,
      generationId: aiCalls.generationId,
      startedAt: aiCalls.startedAt,
      ownerId: aiCalls.ownerId,
      articleId: aiCalls.articleId,
      articleSlug: ownSlugOf(adminOwnerId),
      recordedSlugDigest: RECORDED_SLUG_DIGEST,
      scopeKind: aiCalls.scopeKind,
      job: aiCalls.purpose,
      stepName: aiCalls.stepName,
      wire: aiCalls.wire,
      requestedModel: aiCalls.requestedModel,
      answeredModel: aiCalls.answeredModel,
      upstream: aiCalls.upstream,
      providerAccount: aiCalls.providerAccount,
      costSource: aiCalls.costSource,
      isByok: aiCalls.isByok,
      outcome: aiCalls.outcome,
      attempt: aiCalls.attempt,
      failurePhase: aiCalls.failurePhase,
      failureClass: aiCalls.failureClass,
      failureStatus: aiCalls.failureStatus,
      eventKind: aiCalls.eventKind,
      creditsUsedNanos: aiCalls.creditsUsedNanos,
      byokUpstreamNanos: aiCalls.byokUpstreamNanos,
      computedCostNanos: aiCalls.computedCostNanos,
      reportedInputTokens: aiCalls.reportedInputTokens,
      outputTokens: aiCalls.outputTokens,
      cacheReadTokens: aiCalls.cacheReadTokens,
      cacheWriteTokens: aiCalls.cacheWriteTokens,
      reasoningTokens: aiCalls.reasoningTokens,
      webSearches: aiCalls.webSearches,
      durationMs: aiCalls.durationMs,
    })
    .from(aiCalls)
    .where(window(since, until))
    .orderBy(aiCalls.startedAt, aiCalls.id)
    /* One past the cap, so "exactly the cap" and "more than it" can be told apart. */
    .limit(maxRows + 1);
  if (rows.length > maxRows) throw new SpendDetailTooLarge(maxRows);
  return rows.map(({ recordedSlugDigest: digest, startedAt, ...row }) => ({
    ...row,
    startedAt: startedAt.toISOString(),
    recordedSlugHash: recordedSlugHashOf(digest, privacyKey),
  }));
}

/** Which credentials paid for the window's rows, and how many each. */
export interface CredentialTally {
  /** `null` for rows written before fingerprints, or by a path that had no key. */
  fingerprint: string | null;
  calls: number;
  /**
   * The credits pocket only, because that is the only one OpenRouter's
   * `/api/v1/key` has an opinion about. A BYOK row's money was billed to
   * somebody else and a `computed` row never reached OpenRouter, so including
   * either would guarantee a gap that is nobody's fault — and a difference that
   * is always non-zero for a reason nobody names is a check everybody learns to
   * ignore.
   */
  creditsNanos: number;
}

/**
 * **Whose key paid** — the header's answer to "what is this report a report of".
 *
 * `--reconcile` compares one key's month against OpenRouter's own figure, and
 * that comparison is meaningless if half the rows were bought on a different
 * account. Printing the tally is cheaper than explaining a gap afterwards.
 */
export async function credentialsInWindow(
  since?: string,
  until?: string,
): Promise<CredentialTally[]> {
  const rows = await getDb()
    .select({
      fingerprint: aiCalls.credentialFingerprint,
      calls: CALLS,
      creditsNanos: CREDITS,
    })
    .from(aiCalls)
    .where(window(since, until))
    .groupBy(aiCalls.credentialFingerprint);
  return [...rows].sort((a, b) => b.calls - a.calls);
}

/**
 * Issued live sessions against the ones that actually produced a priced row.
 *
 * `silent` is the number that matters and it is the one nothing else can show: a
 * session that was issued a token, connected, and reported no usage is either a
 * conversation whose meter was lost or a reader who never spoke, and the ledger
 * alone cannot tell those apart. Either way the voice figure below it is biased
 * low by that many sessions, which is a sentence the report has to be able to
 * write.
 */
export interface RealtimeCoverage {
  issued: number;
  connected: number;
  /** Connected sessions with no `ai_calls` row pointing at them. */
  silent: number;
}

/**
 * `null` when `spideryarn.realtime_sessions` is not in this database.
 *
 * **Probed rather than assumed**, because the table arrived in
 * drizzle/20260902150952 and a box whose migrations are behind — which on
 * 2026-09-02 was every box, a peer's ledger row having blocked `db:migrate` —
 * would otherwise fail the whole report with a bare `42P01`. A missing table
 * here is a *coverage* fact: the report says voice cannot be seen from this
 * database, which is exactly the kind of thing the coverage header exists for,
 * and is a far better outcome than a stack trace or a confident zero.
 */
export async function realtimeSessionCoverage(
  since?: string,
  until?: string,
): Promise<RealtimeCoverage | null> {
  const db = getDb();
  const probe = await db.execute<{ ready: boolean }>(
    sql`select to_regclass('spideryarn.realtime_sessions') is not null as ready`,
  );
  const ready = (probe as unknown as { rows?: { ready: boolean }[] }).rows ?? [];
  if (ready[0]?.ready !== true) return null;

  const from = since ? sql`and s.issued_at >= ${new Date(since)}` : sql``;
  const to = until ? sql`and s.issued_at < ${new Date(until)}` : sql``;
  const result = await db.execute<{ issued: string; connected: string; silent: string }>(
    sql`select
          count(*) as issued,
          count(*) filter (where s.connected_at is not null) as connected,
          count(*) filter (
            where s.connected_at is not null
              and not exists (
                select 1 from spideryarn.ai_calls c where c.realtime_session_id = s.id
              )
          ) as silent
        from spideryarn.realtime_sessions s
        where true ${from} ${to}`,
  );
  const rows = (result as unknown as { rows?: Record<string, string>[] }).rows ?? [];
  const row = rows[0];
  if (!row) return { issued: 0, connected: 0, silent: 0 };
  /* `count()` is `bigint` and arrives as a string from a raw `execute`, where
     there is no column mapper to go through. Converted here rather than left to
     surprise a caller who adds two of them together. */
  return {
    issued: Number(row.issued),
    connected: Number(row.connected),
    silent: Number(row.silent),
  };
}

/**
 * **Which bill each row lands on**, and the three money pockets under it.
 *
 * ## Why `credential_fingerprint` was not enough
 *
 * The coverage header already tallies by fingerprint, which answers *"is this
 * report all one key"*. It cannot answer the question that matters since
 * 2026-09-06, when Greg declined a per-reader spend cap on the ground that
 * **the OpenRouter account already has a global monthly one**
 * (docs/project/ai-gateway.md § What stops a reader spending our money). With
 * that decision, the single global ceiling is the only control there is — and
 * the report that says what things cost never once mentioned which of the three
 * accounts a figure was on, or that the ceiling does not reach two of them.
 * `grep providerAccount scripts/ai-cost.ts` returned nothing until 2026-09-07.
 *
 * ## `provider_account` is the bill. It is **not** cap coverage — GPT Sol, F3
 *
 * The tempting move is to call `openrouter` "capped" and the rest "uncapped".
 * That is wrong on its own rows: a **BYOK** row says `provider_account =
 * 'openrouter'` while `byok_upstream_nanos` was charged to somebody else's key
 * entirely. So the account and the pocket together decide, and the caller needs
 * both — which is why this returns the three pockets split rather than one
 * summed figure per account.
 *
 * The report is also in no position to say how close anything is to the ceiling.
 * The cap is a **monthly account total**; this query answers an arbitrary
 * half-open `[since, until)`, over rows we happen to have recorded. It cannot
 * see the cap's amount, the headroom left, or a penny of the spend that writes
 * no row at all (`UNMETERED_SPEND` in src/spend-declarations.ts). Whatever the
 * report prints from this has to say all three of those out loud, or it invents
 * a reassurance out of a subtotal.
 */
export interface AccountTally {
  /** `openrouter`, `anthropic` or `openai` — src/ai-spend.ts § `ProviderAccount`. */
  account: string;
  calls: number;
  /** Bought from OpenRouter's balance. The only pocket `--reconcile` can check. */
  creditsNanos: number;
  /** Billed to somebody else's key. On an `openrouter` row, and *not* under the cap. */
  byokNanos: number;
  /** Our own arithmetic, for a call with nobody to ask. Never reconciled. */
  computedNanos: number;
  /** Reported no money at all, so every figure beside it is short. */
  unpricedCalls: number;
}

export async function accountsInWindow(
  since?: string,
  until?: string,
): Promise<AccountTally[]> {
  const rows = await getDb()
    .select({
      account: aiCalls.providerAccount,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      unpricedCalls: UNPRICED_CALLS,
    })
    .from(aiCalls)
    .where(window(since, until))
    .groupBy(aiCalls.providerAccount);
  return [...rows].sort((a, b) => b.calls - a.calls);
}

/**
 * One `(scope, job, step)` bucket of **one article's** spend — `SpendGroup`
 * without the owner, plus when the bucket's calls happened and how many of
 * them did not finish cleanly.
 */
export interface ArticleSpendGroup {
  scopeKind: string;
  job: string;
  stepName: string | null;
  calls: number;
  creditsNanos: number;
  byokNanos: number;
  computedNanos: number;
  computedCalls: number;
  unpricedCalls: number;
  /** `outcome <> 'ok'` — errored or aborted calls, which usually still cost. */
  nonOkCalls: number;
  firstAt: Date;
  lastAt: Date;
}

/** Which article, established by an owner-scoped lookup before this is asked. */
export interface ArticleIdentity {
  id: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
}

/**
 * The rows that belong to one article: **its id**, or — for a row whose id
 * could not be resolved when it was written — **its owner's slug, since it was
 * created**.
 *
 * The id is the key because a slug is only unique among *current* articles: a
 * deleted article's slug can be minted again, and the schema anticipates
 * renaming. `article_id` is `on delete set null` and is filled at write time
 * only when the spender owns the article (`articleIdFor` in ai-calls-pg.ts), so
 * a row can still lack one when that lookup failed. Those are matched on
 * `(owner_id, article_slug)` and bounded below by the article's creation, so a
 * previous article under the same slug cannot leak in. A call genuinely made
 * before the current article existed is deliberately excluded: it cannot be
 * distinguished safely from that predecessor. GPT Sol, plan review of
 * docs/plans/260930f-article-cost-on-the-metadata-page.md, P1.
 *
 * The owner-scoped lookup that produced `article` is what keeps this to the
 * administrator's own articles; this predicate does not check ownership itself.
 */
function belongsTo(article: ArticleIdentity) {
  return or(
    eq(aiCalls.articleId, article.id),
    and(
      isNull(aiCalls.articleId),
      eq(aiCalls.ownerId, article.ownerId),
      eq(aiCalls.articleSlug, article.slug),
      gte(aiCalls.startedAt, article.createdAt),
    ),
  );
}

/**
 * **Everything the ledger says one article has cost**, grouped by scope, job
 * and step — the metadata page's administrator section.
 * docs/project/cost-tracking.md.
 *
 * No time window: an article's cost is its whole life. And no scope filter —
 * the caller categorises every group (src/cost-categories.ts, which this file
 * may not import: it reaches src/pipeline.ts, which reaches back into the
 * stores), so eval and CLI spend is shown as what it is rather than dropped.
 *
 * **What it cannot see** is any call that wrote no row (a failed ledger write,
 * a call outside every collector) and any call no route attributed to the
 * article — before 2026-09-30, link previews and dictation. The page says so.
 */
export async function spendForArticle(article: ArticleIdentity): Promise<ArticleSpendGroup[]> {
  const rows = await getDb()
    .select({
      scopeKind: aiCalls.scopeKind,
      job: aiCalls.purpose,
      stepName: aiCalls.stepName,
      calls: CALLS,
      creditsNanos: CREDITS,
      byokNanos: BYOK,
      computedNanos: COMPUTED,
      computedCalls: COMPUTED_CALLS,
      unpricedCalls: UNPRICED_CALLS,
      nonOkCalls: sql<number>`count(*) filter (where ${aiCalls.outcome} <> 'ok')`.mapWith(Number),
      firstAt: sql<Date>`min(${aiCalls.startedAt})`.mapWith(aiCalls.startedAt),
      lastAt: sql<Date>`max(${aiCalls.startedAt})`.mapWith(aiCalls.startedAt),
    })
    .from(aiCalls)
    .where(belongsTo(article))
    .groupBy(aiCalls.scopeKind, aiCalls.purpose, aiCalls.stepName);
  return [...rows];
}

/**
 * Live conversations on one article that **connected and reported nothing** —
 * `realtimeSessionCoverage`'s `silent`, narrowed to the article by the same
 * rule as `belongsTo`. `null` when the table is not in this database, for the
 * reason that function gives.
 */
export async function silentLiveSessionsForArticle(
  article: ArticleIdentity,
): Promise<number | null> {
  const db = getDb();
  const probe = await db.execute<{ ready: boolean }>(
    sql`select to_regclass('spideryarn.realtime_sessions') is not null as ready`,
  );
  const ready = (probe as unknown as { rows?: { ready: boolean }[] }).rows ?? [];
  if (ready[0]?.ready !== true) return null;
  const result = await db.execute<{ silent: string }>(
    sql`select count(*) as silent
          from spideryarn.realtime_sessions s
         where (s.article_id = ${article.id}
                or (s.article_id is null
                    and s.owner_id = ${article.ownerId}
                    and s.article_slug = ${article.slug}
                    and s.issued_at >= ${article.createdAt}))
           and s.connected_at is not null
           and not exists (
             select 1 from spideryarn.ai_calls c where c.realtime_session_id = s.id
           )`,
  );
  const rows = (result as unknown as { rows?: Record<string, string>[] }).rows ?? [];
  return Number(rows[0]?.silent ?? 0);
}
