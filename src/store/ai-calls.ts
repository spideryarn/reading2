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
 * **Not a fallback.** The flag picks one adapter at boot and the other is never
 * consulted — see [ai-calls-fs.ts](ai-calls-fs.ts) for why there is a
 * filesystem one at all, given that `files` is the default and a cost tracker
 * that records nothing by default is worse than none.
 */

import type { AiCallRow } from "../ai-spend.js";
import { fsCostStore } from "./ai-calls-fs.js";
import { pgCostStore } from "./ai-calls-pg.js";
import type { CostStore } from "./contracts.js";
import { guardDbStore } from "./db-errors.js";
import { STORE } from "./live.js";

/**
 * Guarded on the Postgres side only, like `guarded()` in `index.ts` and for the
 * same reason: a failed Drizzle query puts every bound parameter into
 * `Error.message`, and the filesystem one binds nothing.
 */
export const costStore: CostStore =
  STORE === "postgres" ? guardDbStore("ai-calls", pgCostStore) : fsCostStore;

/**
 * **What a set of ledger rows cost**, and the three ways the answer can be
 * short. One implementation, so the two stores cannot disagree.
 *
 * `credits` and `upstream` are two different pockets and are kept apart: under
 * BYOK OpenRouter's charge is legitimately zero while the inference was billed
 * to somebody else's key, so a report that adds them into one number cannot say
 * what it is a number *of*. `unpriced` is the count of calls that reported no
 * money at all — the total is short by an unknown amount, which is a different
 * statement from "it cost nothing".
 */
export function totalRows(rows: readonly AiCallRow[]): {
  credits: number;
  upstream: number;
  unpriced: number;
} {
  let credits = 0;
  let upstream = 0;
  let unpriced = 0;
  for (const r of rows) {
    if (r.isByok === true) {
      if (r.upstreamInferenceNanos === null) unpriced += 1;
      else upstream += r.upstreamInferenceNanos;
      credits += r.creditsUsedNanos ?? 0;
      continue;
    }
    if (r.creditsUsedNanos === null) unpriced += 1;
    else credits += r.creditsUsedNanos;
  }
  return { credits, upstream, unpriced };
}
