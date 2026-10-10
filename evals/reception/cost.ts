/**
 * **What one Reception run cost, and the four ways it is allowed to answer
 * "I don't know".**
 *
 * GPT Sol's F43 on
 * docs/plans/260906b-an-evaluation-for-debate-mode-and-what-it-finds.md, and it
 * is specific because the obvious sources are all wrong:
 *
 * - `generateReception` returns **searches and elapsed time, not money**.
 * - `withLedger` prints an aggregate and **returns nothing**.
 * - Token `Usage` prices nothing here: a web search is billed **per search** and
 *   is invisible to token arithmetic (`SpendRecord.webSearches` says so in as
 *   many words). A run priced off tokens could be ten cents light and look
 *   exactly right.
 *
 * So the figure comes from the spend collector's own `SpendRecord`s through
 * [`totalSpend`](../../src/ai-spend.ts), which is the one function that knows
 * about BYOK zeros and about a `computed` cost with no `costNanos`.
 *
 * ## A zero must be impossible to mistake for a measurement
 *
 * `formatRunCost` returns the string `not measured` — never `$0.0000` — whenever
 * anything is unknown, and the unpriced count goes beside it. A free call and a
 * call that reported nothing are different facts and only one of them is a
 * number.
 *
 * ## Why the call-shape check is a refusal and not a `throw`
 *
 * A completed current run has exactly one search call and, when enough rows
 * survived, one search-free synthesis call. Anything else means the run was
 * not what it says on the tin — a retry we did not know about, the retired
 * claims search returning, a stage that called something else, or a collector
 * that lost a row.
 *
 * It is checked and reported rather than thrown, and the order matters: the
 * money has already been spent by the time this runs, so throwing here would
 * lose the run file that is the only record of what it bought. The runner writes
 * the file, prints the problems, and exits non-zero.
 */
import { formatNanos, type SpendRecord, totalSpend } from "../../src/ai-spend.js";

/** The current run's direct search, plus an optional synthesis. */
export const EXPECTED_RECEPTION_CALLS = [1, 2] as const;

export interface RunCost {
  /**
   * `measured` only when every contributing call was priced **and** the run's
   * call inventory is what a Reception run is.
   */
  kind: "measured" | "not-measured";
  nanos: number;
  unpriced: number;
  calls: number;
  /**
   * **Which calls this figure is made of**, so it can be joined to `ai_calls`
   * afterwards. `generationId` is the identifier the ledger row carries out to
   * OpenRouter's own `GET /api/v1/generation`; `SpendRecord` has no row id on it
   * — that is minted inside `ai-spend.ts` and only reaches `AiCallRow` — so the
   * `runId` beside these is what names the group in the ledger.
   */
  callIds: string[];
  /** Total server-side searches across the contributing calls, or `null` if none said. */
  webSearches: number | null;
  /**
   * **Non-empty means this run is not what it claims to be.** Printed, and the
   * runner exits non-zero. See the header for why this is not a throw.
   */
  problems: string[];
}

/**
 * Price one run from the calls made inside its slice of the collector.
 *
 * @param calls the `SpendRecord`s made between the run starting and finishing —
 *   `currentSpend()!.calls.slice(before)`, the way `evals/cost/interactions.ts`
 *   does it. A nested `collectSpend` would shadow the outer `withLedger("eval")`
 *   and take every row out of the ledger, which is the wrong trade for a number
 *   we can get by slicing.
 * @param opts.completed whether the run reached the end. A failed run is priced
 *   too — the call that blew up had usually already been paid for — but the
 *   call-shape rule is only asserted about a run that finished.
 */
export function costOf(
  calls: readonly SpendRecord[],
  opts: { completed: boolean },
): RunCost {
  const problems: string[] = [];
  const { nanos, unpriced } = totalSpend(calls);

  const foreign = calls.filter((c) => c.job !== "reception");
  if (foreign.length > 0) {
    problems.push(
      `${foreign.length} call(s) inside this run were not the Reception job (${[...new Set(foreign.map((c) => c.job))].join(", ")}) — ` +
        "this figure is not the price of a Reception run",
    );
  }
  if (opts.completed && !EXPECTED_RECEPTION_CALLS.some((count) => count === calls.length)) {
    problems.push(
      `a completed Reception run is one search call plus at most one search-free synthesis call, and this run made ${String(calls.length)} calls`,
    );
  }
  const searchful = calls.filter((c) => c.job === "reception" && c.webSearches !== null && c.webSearches > 0);
  if (opts.completed && searchful.length !== 1) {
    problems.push(
      `a completed Reception run has exactly one call with server-side searches, and this run had ${String(searchful.length)}`,
    );
  }

  const counted = calls.filter((c) => c.webSearches !== null);
  return {
    kind: unpriced === 0 && problems.length === 0 ? "measured" : "not-measured",
    nanos,
    unpriced,
    calls: calls.length,
    callIds: calls.map((c) => c.generationId ?? "(the provider returned no generation id)"),
    webSearches: counted.length === 0 ? null : counted.reduce((n, c) => n + (c.webSearches ?? 0), 0),
    problems,
  };
}

/**
 * The figure as a person should read it.
 *
 * **Never `$0.0000` for something unknown.** `formatNanos` prints a true zero as
 * `$0.0000`, which is right for a free call and catastrophic for one that
 * reported nothing — so an unmeasured run does not get a dollar sign at all.
 */
export function formatRunCost(cost: RunCost): string {
  /* **Zero calls is said in words.** `$0.0000 over 0 call(s)` is arithmetically
     true and reads, at a glance, exactly like a run that was measured and came
     to nothing. This is the state a run that failed before it reached the wire
     ends in, and it must not be quotable as a price. */
  if (cost.calls === 0 && cost.problems.length === 0) {
    return "nothing was spent — no model call was made";
  }
  if (cost.kind === "measured") {
    return `${formatNanos(cost.nanos)} over ${String(cost.calls)} call(s)`;
  }
  const why = [
    cost.unpriced > 0 ? `${String(cost.unpriced)} call(s) reported no cost` : null,
    ...cost.problems,
  ].filter((x): x is string => x !== null);
  return (
    `not measured — ${why.join("; ")}` +
    /* The partial total is still printed, in brackets and never on its own, so
       an order of magnitude is available without any line reading as a price. */
    ` (the priced part of it came to ${formatNanos(cost.nanos)}, which is not the run's cost)`
  );
}
