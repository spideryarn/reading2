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
 * **Not a fallback, and no longer a choice.** `costStore` is `pgCostStore`
 * unconditionally: there is no flag, no branch, and **no `selected()`** — the
 * hinge of 2026-09-05 took the last of them out, and
 * [ai-calls-fs.ts](ai-calls-fs.ts) now has no importer outside its own tests
 * and is deleted by stage G of
 * docs/plans/260903f-delete-the-spideryarn-store-flag-and-the-filesystem-store.md.
 *
 * ⟨Until 2026-09-05 this paragraph said there was a filesystem adapter "given
 * that `files` is the default", and pointed at a `selected()` "below" for the
 * reasoning. Neither had been true since the hinge landed, and the second named
 * a function that is not in this file — which is how a reader ends up looking
 * for a decision nobody is making any more.⟩
 *
 * **The test harness gets no special case.**
 */

import type { AiCallRow } from "../ai-spend.js";
import { pgCostStore } from "./ai-calls-pg.js";
import type { CostStore, LedgerRead } from "./contracts.js";
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
export function totalRows(rows: readonly AiCallRow[]): LedgerMoney {
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


/* --------------------------------------------- a total that admits its gaps -- */

/**
 * **What a set of rows cost, in the pockets that must not be added blindly.**
 *
 * The return of `totalRows`, named so that `LedgerTotal` below can talk about it
 * twice without the reader having to check that the two spellings agree.
 */
export interface LedgerMoney {
  /** What OpenRouter deducted from our credits, in nano-dollars. */
  credits: number;
  /** What the inference was worth upstream on a BYOK call. A different pocket. */
  upstream: number;
  /** Our own arithmetic, for the calls that went straight to Anthropic. */
  computed: number;
  /** Calls that reported no money at all. The figures above are short by them. */
  unpriced: number;
}

/**
 * **The rows the ledger does not have** — the two ways a read is short, kept
 * apart on purpose. `LedgerRead` in [contracts.ts](contracts.ts) says at length
 * why merging them loses the thing a reader would go and do about it.
 */
export interface LedgerShortfall {
  /** Lines that exist and would not parse. The money happened; the record is damaged. */
  unreadable: number;
  /**
   * Calls that finished after their collector had reported, so no row was ever
   * written. Process-wide and unattributable — "this may be short", not "short
   * by n". See `LedgerRead`.
   */
  lateCalls: number;
}

/**
 * **A ledger total, or a lower bound that says it is one.**
 *
 * A discriminated union rather than a figure with a `mayBeShort` flag beside it,
 * and that is the whole design. The numbers live on different arms with
 * different names, so `total.money` simply does not compile until the caller has
 * established `complete === true`, and the incomplete arm offers `atLeast`
 * instead — a name that cannot be printed as a bill without somebody noticing.
 * A boolean field beside a total is a field a caller forgets; this is not.
 */
export type LedgerTotal =
  | { complete: true; money: LedgerMoney }
  | { complete: false; atLeast: LedgerMoney; shortfall: LedgerShortfall };

/**
 * **The only sanctioned way to turn a `LedgerRead` into money.**
 *
 * The failure it exists for, precisely. `costStore.forJob` reads
 * `spideryarn.ai_calls`; a model call that was *started* and whose row was never
 * inserted is invisible to it, because the row is written when the call
 * finishes and a call still in flight when its collector closed never gets one
 * (src/ai-spend.ts § `collectSpend`, which sets `closed` before draining the
 * writes, deliberately). The query then comes back short with `unreadable: 0`,
 * which reads exactly like a cheaper job — and on 2026-09-04 a run printed
 * `$2.7331` as the bill when the real figure was higher.
 *
 * So a total off this ledger is only a total when nothing is known to be
 * missing, and the type says so. `totalRows` is still there and still exported —
 * the arithmetic is one implementation and stays one — but it takes bare rows
 * and knows nothing about the read they came out of. **`totalRows(read.rows)` is
 * therefore the way round this**, and it is left reachable rather than closed
 * off for one reason worth writing down: evals/deepen/run.ts and
 * evals/cost/report.ts already sum `ledger.rows` for their per-step and per-job
 * breakdowns, where the caveat is reported separately, and narrowing the input
 * type would break them for no gain in honesty. What this closes is the shape
 * that actually caused the bug — a caller reading one figure and calling it the
 * bill.
 *
 * **This does not recover the money**, and nothing at the reading end can. The
 * fix that would is a row written when the call opens, so that a started call is
 * on disk before it can be lost: docs/plans/260827q-ai-cost-tracking.md.
 */
export function totalLedger(read: LedgerRead): LedgerTotal {
  const money = totalRows(read.rows);
  /* Deliberately not `rows.length === 0 && ...`: a job whose every call was late
     has no rows *and* is the worst case, because "spent nothing" and "we cannot
     see what it spent" then look identical. */
  if (read.unreadable === 0 && read.lateCalls === 0) return { complete: true, money };
  return {
    complete: false,
    atLeast: money,
    shortfall: { unreadable: read.unreadable, lateCalls: read.lateCalls },
  };
}
