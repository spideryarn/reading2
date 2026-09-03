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
 * - `/admin/users` reads it through the `/api/admin` gate in `src/routes.ts`,
 *   which is the whole of the enforcement (docs/project/admin.md).
 * - `npm run cost -- --owners` reads it from a CLI on Greg's own machine.
 * - **It returns money and an owner id and nothing else** — no title, no URL, no
 *   slug, no sentence of anybody's reading. That is the rule admin.md states for
 *   the page, and it is the reason a second entry on that list is a widening
 *   rather than a hole.
 *
 * A third would be a decision about who may see across owners, which is why the
 * list is in the test rather than a per-file opt-out somewhere quieter.
 *
 * ## What may be logged from this file
 *
 * Nothing. It returns numbers and owner ids to one CLI and one admin route, and
 * the insert path's `guardDbStore` reasoning applies to the callers rather than
 * here — these statements bind two timestamps.
 */

import { and, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/client.js";
import { aiCalls } from "../db/schema.js";

/**
 * One `(owner, scope, job, step)` bucket. The four keys are what the ledger
 * knows about provenance; `src/cost-categories.ts` turns them into a name.
 */
export interface SpendGroup {
  ownerId: string;
  scopeKind: string;
  /** `ai_calls.purpose` — `hierarchy`, `chat`, `live_conversation`, … */
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
