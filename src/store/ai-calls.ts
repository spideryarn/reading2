/**
 * Which ledger is live — the one place that decides, and a **leaf**.
 *
 * Its own file rather than a line in [index.ts](index.ts), for the reason
 * [live.ts](live.ts) gives about itself: `index.ts` imports [fs.ts](fs.ts),
 * which imports `src/chat.ts` and `src/searches.ts`, so anything the *pipeline*
 * needs cannot come from there without closing an import cycle — and
 * `src/jobs.ts` needs this, because a pipeline step is where most of the money
 * goes. `npm run cycles` is a gate rather than advice, so that would be a red
 * build.
 *
 * `index.ts` re-exports it, so a route does not have to know it moved house.
 *
 * **Not a fallback.** One adapter answers and the other is never consulted —
 * see [ai-calls-fs.ts](ai-calls-fs.ts) for why there is a filesystem one at
 * all, given that `files` is the default and a cost tracker that records
 * nothing by default is worse than none.
 *
 * **The test harness gets no special case**, and `selected()` below records the
 * one that used to be here and why it went.
 */

import type { AiCallRow } from "../ai-spend.js";
import { pgCostStore } from "./ai-calls-pg.js";
import type { CostStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";

/**
 * Guarded on the Postgres side only, like `guarded()` in `index.ts` and for the
 * same reason: a failed Drizzle query puts every bound parameter into
 * `Error.message`, and the filesystem one binds nothing.
 *
 * Deliberately **not** named `pgSomething`: tests/store-guarded.test.ts greps
 * every statement that consults `STORE` for an identifier of that shape and
 * demands it be guarded in that statement, and this one is guarded here
 * instead — which is the stronger place, not a way round the check.
 */
const guardedLedger: CostStore = guardDbStore("ai-calls", pgCostStore);

/**
 * **Which adapter answers this call** — the store flag, and nothing else.
 *
 * ## There was a third case here for three days, and this is why
 *
 * `ai-calls-fs.ts` had solved test pollution for `files` mode: it writes to
 * `data/_ai-calls.test.jsonl` when `NODE_ENV` is `test`, because several suites
 * drive real requests through `handleApi` and every one of those opens a
 * collector with this store behind it. `ai-calls-pg.ts` never had the other
 * half of that contract, so with `SPIDERYARN_STORE=postgres` the same fixture
 * calls went into the **real dev ledger**: on 2026-09-02, 4,714 of 4,750 rows
 * were `test-chat-route-fixture`, `test-remember-route-fixture` and
 * `test-candidates-route-fixture`. Every `By owner` and `By article` line was
 * meaningless, and the standing "3,872 calls reported no cost" warning masked
 * the one signal that would show a real unpriced problem.
 *
 * The fix that day was a line at the top of this function —
 * `if (process.env.NODE_ENV === "test") return fsCostStore;` — **redirecting
 * rather than refusing**, on GPT Sol's call: a store that threw under test would
 * stop the route suites exercising the metering lifecycle at all, which is the
 * half of the ledger those tests are the only cover for. An `is_test` column and
 * a synthetic `scope_kind` were both rejected then and stay rejected — neither
 * keeps fixture rows out of a `GROUP BY` somebody writes next month without
 * knowing to exclude them.
 *
 * ## What replaced it, on 2026-09-05
 *
 * **A database, not a branch.** The `private-postgres` vitest project mints a
 * database for the run, points `DATABASE_URL` at it and drops it afterwards
 * (tests/setup/private-db.ts), so a fixture row written through `pgCostStore` is
 * a real row that no report and no other run can see. That is the isolation the
 * redirect was standing in for, and it is stronger in the direction that
 * mattered: with the redirect in place **no route suite in the tree had ever put
 * a row through the Postgres adapter**, which is the only one that deploys.
 *
 * So this function is the flag again, and
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md
 * § C is where it was argued. tests/cost-store-under-test.test.ts is what says
 * the rows land in the private database and not in the developer's own.
 *
 * **Asked per call, not once at module load, and that is still the trap.** The
 * comment on `ledger()` in ai-calls-fs.ts records what happened the first time:
 * ESM hoists static imports, so a module-level constant here would be decided
 * before any test body ran, and a suite that sets `SPIDERYARN_STORE` in its own
 * `beforeAll` would already have been given the other adapter — writing
 * somewhere it did not intend while looking exactly like a suite that had been
 * configured.
 */
export const costStore: CostStore = guardedLedger;

/**
 * **What a set of ledger rows cost**, and the four ways the answer can be
 * short. One implementation, so the two stores cannot disagree.
 *
 * **The obvious SQL sum now agrees with this function.** Since
 * drizzle/20260902141103_byok_upstream_nanos.sql,
 * `COALESCE(credits_used_nanos,0) + COALESCE(byok_upstream_nanos,0) +
 * COALESCE(computed_cost_nanos,0)` is the right expression on every row,
 * because the BYOK column is null wherever it would have been a duplicate.
 * That was not true before: `upstream_inference_nanos` was set on every
 * chat-wire call, and the conditional that made a total correct lived only
 * here. tests/store-ai-calls.test.ts holds the two sums against each other.
 *
 * `credits` and `upstream` are two different pockets and are kept apart: under
 * BYOK OpenRouter's charge is legitimately zero while the inference was billed
 * to somebody else's key, so a report that adds them into one number cannot say
 * what it is a number *of*. `unpriced` is the count of calls that reported no
 * money at all — the total is short by an unknown amount, which is a different
 * statement from "it cost nothing".
 *
 * **`computed` is a third pocket**, and it is not the same kind of fact as the
 * other two. `credits` is what OpenRouter deducted and can be checked against
 * their own running total; `computed` is our arithmetic over
 * [`ANTHROPIC_PRICES`](../pricing.ts) for a call that went straight to Anthropic
 * and has nobody to ask. Adding them would produce a number no reconciliation
 * can ever match, and the day it failed to match nobody would know which half
 * was wrong. Callers that want one figure add them deliberately and say they
 * did.
 */
export function totalRows(rows: readonly AiCallRow[]): {
  credits: number;
  upstream: number;
  computed: number;
  unpriced: number;
} {
  let credits = 0;
  let upstream = 0;
  let computed = 0;
  let unpriced = 0;
  for (const r of rows) {
    /* First, because a computed row has no `credits_used_nanos` at all and
       would otherwise be counted as unpriced — which is the one thing it is
       not. The database `CHECK` in 0023 makes these three cases exclusive. */
    if (r.costSource === "computed") {
      computed += r.computedCostNanos ?? 0;
      continue;
    }
    if (r.isByok === true) {
      if (r.byokUpstreamNanos === null) unpriced += 1;
      else upstream += r.byokUpstreamNanos;
      credits += r.creditsUsedNanos ?? 0;
      continue;
    }
    /* **The non-BYOK branch deliberately never reads `byokUpstreamNanos`**, and
       since 2026-09-02 there is nothing there to read: the column is null off a
       BYOK row, enforced by the `ai_calls_byok_upstream_only` CHECK in
       drizzle/20260902141103_byok_upstream_nanos.sql and by the same three
       conditions in `normaliseByokUpstream` and the filesystem reader. This
       branch is what still made the total right on the rows written before
       that, where OpenRouter's `upstream_inference_cost` equalled `cost` and
       adding it doubled the bill. */
    if (r.creditsUsedNanos === null) unpriced += 1;
    else credits += r.creditsUsedNanos;
  }
  return { credits, upstream, computed, unpriced };
}
