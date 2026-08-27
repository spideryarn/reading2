/**
 * **What the model calls in one piece of work cost** — collected without any
 * stage having to carry a total up to whoever wants it.
 *
 * The same shape as [`src/owner.ts`](owner.ts), and for the same reason. A
 * pipeline step is not one model call: `summarise` batches per parent, `labels`
 * fans out, `glossary` and `ideas` each make one but sit four frames below
 * `src/jobs.ts`. Threading a running total back up means a return-type change on
 * every stage and a place to forget it in each. `AsyncLocalStorage` is Node's
 * own answer, survives every `await`, and costs the stages nothing — they call
 * nothing at all. [`src/messages-stream.ts`](messages-stream.ts) records for
 * them, which is the point: the one seam every paid Messages call already goes
 * through is the one place this cannot be forgotten.
 *
 * ## Outside a scope this is a no-op, deliberately — and it counts them
 *
 * `currentOwnerId()` throws when nobody opened a box, because a store read
 * outside a request is a bug. This is the opposite case: a stage run from the
 * CLI, or from a test, is a perfectly ordinary thing and must not fail because
 * nobody was keeping accounts.
 *
 * But "silently does nothing" is how a cost table ends up empty while every
 * call succeeds, so it is not silent: `unscopedCalls()` counts what fell on the
 * floor, and anything that reports spend should say so rather than present a
 * total that is quietly missing rows. See
 * [silent-success.md](../docs/reusable/silent-success.md).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { log } from "./log.js";
import type { Nanos } from "./pricing.js";
import type { AiJob } from "./models.js";

/**
 * One paid model call, as it actually happened.
 *
 * Everything the provider did not tell us is `null` rather than `0` — a zero
 * here is indistinguishable from a free call and would understate a bill for as
 * long as nobody looked.
 */
export interface SpendRecord {
  /**
   * Which job made the call.
   *
   * `AiJob`, not `Task`: transcribing a PDF, embedding a paragraph and
   * transcribing a reader's voice are deliberately not on a reasoning tier and
   * so are deliberately not `Task`s — see [`src/models.ts`](models.ts). **The
   * bill does not care about tiers**, and keying this on `Task` would have left
   * three real calls with nowhere to be recorded.
   */
  job: AiJob;
  /** The model id as sent, in OpenRouter's spelling. */
  model: string;
  /**
   * Which model actually answered, when the response said — **not always the one
   * asked for.** OpenRouter may serve a variant, and a report that shows only
   * the requested id will attribute the money to a model that never ran.
   * `null` when the response did not say.
   */
  answeredBy: string | null;
  /** OpenRouter's own figure, in nano-dollars. `null` when it did not arrive. */
  costNanos: Nanos | null;
  /**
   * `cost_details.upstream_inference_cost`, in nano-dollars — **a different
   * definition of money from `costNanos`, kept because under BYOK they diverge.**
   *
   * `usage.cost` is what OpenRouter charged our credits. The upstream figure is
   * what the inference itself was worth. On an ordinary call they agree; on a
   * BYOK call `cost` is 0 and this is not, and a spend limit that read only the
   * first would let BYOK traffic through for free. Raised by a GPT Sol review —
   * see also `isByok`, which says which case a zero is.
   */
  upstreamCostNanos: Nanos | null;
  /** `x-generation-id` — the key to `GET /api/v1/generation?id=…` later. */
  generationId: string | null;
  /** Which upstream answered: `"Anthropic"`, `"Claude Platform on AWS"`, … */
  upstream: string | null;
  /**
   * Whether OpenRouter billed this to somebody else's key.
   *
   * **A `costNanos` of 0 means two different things and this is what separates
   * them.** Under BYOK OpenRouter's own cost is legitimately zero while the
   * upstream bills elsewhere — so without this field a BYOK call is a free call,
   * `unpriced` stays 0, and a total reads as correct while missing real money.
   * Raised by a GPT Sol review before this shape became a database column.
   */
  isByok: boolean | null;
  /** Tokens, straight off the response. Absent fields stay absent. */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  /** Wall-clock milliseconds for the call. */
  ms: number;
  /** How it ended — `"ok"`, or the failure that stopped it. */
  outcome: "ok" | "error" | "aborted";
}

/**
 * **A call that has been started and not yet recorded.**
 *
 * The whole reason this exists: a caller can open a request and then drop it —
 * throw on a non-200 before reading the body, return early, forget a `finally` —
 * and the result is a working feature and a short bill, with nothing anywhere
 * saying so. A pending call is the only trace of that, and it is only worth
 * anything if something looks at it when the scope closes.
 *
 * Raised by a GPT Sol review, which also pointed out what it does **not** catch:
 * if the process dies, this dies with it. Catching that needs a row written to
 * disk before the network call, which is a later phase and is written down in
 * docs/plans/ai-cost-tracking.md rather than half-built here.
 */
export interface PendingCall {
  job: AiJob;
  /** The model as requested — the answer is not known yet, that being the point. */
  model: string;
  startedAt: number;
}

/**
 * One collector's box: what was recorded, what is still in flight, and whether
 * anybody is still listening.
 *
 * An object rather than the bare array this used to be, because "pending" is a
 * question you can only ask of a scope. A **process-global** pending gauge was
 * the first design and is useless: concurrent calls are legitimately pending all
 * the time, so the number is never zero and never means anything. Scoped, it has
 * exactly one honest reading — *this piece of work finished with a call still
 * open* — which is a bug every time.
 */
interface SpendScope {
  calls: SpendRecord[];
  active: Map<number, PendingCall>;
  /** Set when `collectSpend` returns. A record arriving after this is a late finish. */
  closed: boolean;
}

const store = new AsyncLocalStorage<SpendScope>();

let dropped = 0;
let late = 0;
let nextCallId = 1;

/**
 * How many calls were recorded with no collector open since the process
 * started. Anything printing a total should print this too when it is not zero:
 * a total that silently omits rows is worse than no total.
 */
export function unscopedCalls(): number {
  return dropped;
}

/**
 * How many calls finished **after their collector had already reported**.
 *
 * The other half of `unscopedCalls()`, and process-wide for the same unavoidable
 * reason: a late finish is by definition after the report, so it can never
 * appear in the report it belongs to. A first draft put it on `SpendReport` and
 * it was a field that could only ever read zero — a counter nobody could read,
 * which is the failure this module is otherwise organised against. Found by
 * writing the test for it and watching the assertion be unwritable.
 *
 * What it means when it is not zero: some piece of work launched a model call
 * and returned before the call finished. The money is real and is in no total.
 * Today the one shape that could do that is a route returning before its stream
 * is drained — see the note at `handleApi` in [`src/routes.ts`](routes.ts).
 */
export function lateCalls(): number {
  return late;
}

/** Reset both counters. For tests; nothing in the app should call them. */
export function resetUnscopedCalls(): void {
  dropped = 0;
  late = 0;
}

/**
 * **Say a call has started**, before a byte goes over the wire.
 *
 * Returns the id to hand back to `recordSpend`, or `null` if nobody is
 * collecting. Called by the two gateways, not by callers.
 */
export function beginSpend(job: AiJob, model: string): number | null {
  const scope = store.getStore();
  if (!scope) return null;
  const id = nextCallId++;
  scope.active.set(id, { job, model, startedAt: Date.now() });
  return id;
}

/**
 * What a finished piece of work spent — and everything about it that is not
 * simply a total.
 */
export interface SpendReport {
  calls: SpendRecord[];
  /**
   * Calls opened and never recorded. **Nonzero is a bug**, and the entries say
   * which job and how old, so it can be chased rather than merely noticed.
   */
  pending: PendingCall[];
}

/**
 * Run `fn` with a fresh collector, and hand back both its answer and every call
 * made inside it — including inside anything it awaited.
 *
 * `run()` with a new scope each time, never `enterWith`, for the reason
 * [`src/owner.ts`](owner.ts) gives at length: `enterWith` mutates the *calling*
 * context, and two overlapping pieces of work on one process would then share a
 * box and bill each other.
 *
 * **Nested collectors do not merge.** An inner `collectSpend` shadows an outer
 * one for everything inside it, so the outer sees none of those calls. That is
 * the right answer for the one place it happens today — `runStep` in
 * [`src/jobs.ts`](jobs.ts) accounts for a pipeline step, which is not part of any
 * request — and it is written down because it is not what a reader would guess.
 */
export async function collectSpend<T>(
  fn: () => Promise<T>,
  onDone?: (report: SpendReport) => void,
): Promise<{ result: T; report: SpendReport }> {
  const scope: SpendScope = { calls: [], active: new Map(), closed: false };
  const report = (): SpendReport => ({
    calls: scope.calls,
    pending: [...scope.active.values()],
  });
  try {
    const result = await store.run(scope, fn);
    return { result, report: report() };
  } finally {
    /* **`onDone` exists because of the failure case, not the happy one.** When
       `fn` throws, this function rejects and its return never happens — so a
       caller that only reads the resolved value loses every record of what the
       failed run spent. And a run that failed is precisely the one worth knowing
       the cost of: the model call that blew up had usually already been paid
       for, and a retry pays again. Called in a `finally` so it fires on both
       paths. */
    onDone?.(report());
    /* Closed *after* the report, so the report is of the scope as it was, and
       anything arriving from here on counts as late rather than vanishing. */
    scope.closed = true;
  }
}

/**
 * Add a call to whatever collector is open. No-op — and counted — if none is.
 *
 * Called by [`src/ai-call.ts`](ai-call.ts) and
 * [`src/messages-stream.ts`](messages-stream.ts), not by their callers.
 *
 * `callId` is what `beginSpend` returned. Passing it is what clears the call out
 * of `pending`; omitting it leaves a phantom in-flight call behind, which is why
 * both gateways thread it through rather than treating it as optional detail.
 */
export function recordSpend(record: SpendRecord, callId?: number | null): void {
  const scope = store.getStore();
  if (!scope) {
    dropped += 1;
    return;
  }
  if (callId != null) scope.active.delete(callId);
  if (scope.closed) {
    /* **Counted and said out loud, not just counted.** A bare counter loses the
       job, the model and the money, and lives in one process's memory where no
       later `npm run cost` can read it — so on its own it is an anomaly nobody
       will ever see. The line is the part that reaches a person. Raised by a GPT
       Sol review, which pointed out that the counter alone was a thing nobody
       reads. */
    late += 1;
    log("model").warn(
      {
        job: record.job,
        model: record.model,
        outcome: record.outcome,
        costNanos: record.costNanos,
        ms: record.ms,
      },
      "a model call finished after its collector had already reported",
    );
    return;
  }
  scope.calls.push(record);
}

/** True while a collector is open. Lets a caller decide whether to bother. */
export function collectingSpend(): boolean {
  return store.getStore() !== undefined;
}

/**
 * What the open collector has recorded **so far**, or `null` outside one.
 *
 * For a caller that has to report *while still inside* its own scope — which is
 * every HTTP request, because the line about a request is written in
 * `serveApi`'s `finally`, and by then the scope `handleApi` opened has not
 * closed yet. Reading the snapshot from in here is the only way that line can
 * carry a cost at all.
 *
 * A copy of the arrays, not the live ones: a caller holding the collector's own
 * array would see it keep growing after it had reported, which is a report that
 * is wrong later rather than wrong now.
 */
export function currentSpend(): SpendReport | null {
  const scope = store.getStore();
  if (!scope) return null;
  return { calls: [...scope.calls], pending: [...scope.active.values()] };
}

/**
 * **What a finished piece of work spent, as log fields** — the one formatting of
 * this, shared by the pipeline's per-step line and the server's per-request one.
 *
 * `aiUnpriced`, `aiPending` and `aiLateFinishes` appear only when they are not
 * zero, so an ordinary line stays short and an unusual one says why. Each of the
 * three means something different and all three are bugs:
 *
 * - **`aiUnpriced`** — the call happened and reported no cost. The total below it
 *   is short by an unknown amount.
 * - **`aiPending`** — a call was started and never recorded. The jobs are named,
 *   because a bare count says something leaked without saying where to look.
 * A third anomaly, a call that finished after its scope reported, cannot appear
 * here at all — by definition it arrives after this function has run. It is
 * counted process-wide by `lateCalls()` instead, which is the honest place for
 * it; see the comment there.
 *
 * **An empty run gets no fields, but a run with a pending call does.** The early
 * return used to be `calls.length === 0`, which is the exact state a piece of
 * work that lost a request ends in — so the one symptom of the bug was
 * suppressed by the check for the ordinary case. Raised by a GPT Sol review.
 */
export function spendFields(spend: SpendReport): Record<string, unknown> {
  if (spend.calls.length === 0 && spend.pending.length === 0) return {};
  const { nanos, unpriced } = totalSpend(spend.calls);
  return {
    aiCalls: spend.calls.length,
    aiCostNanos: nanos,
    aiCost: formatNanos(nanos),
    ...(unpriced > 0 ? { aiUnpriced: unpriced } : {}),
    ...(spend.pending.length > 0
      ? {
          aiPending: spend.pending.length,
          aiPendingJobs: spend.pending.map((p) => p.job).join(","),
        }
      : {}),
  };
}

/**
 * The total of a set of calls, in nano-dollars, **and how many of them could
 * not be priced**.
 *
 * Two numbers rather than one on purpose. A caller that gets only a total has no
 * way to tell "$0.30 across nine calls" from "$0.30 across nine calls, three of
 * which reported nothing" — and the second is a bug report.
 *
 * ## BYOK: the zero that is not free
 *
 * `usage.cost` is what **OpenRouter** charged. Under BYOK it is legitimately
 * `0`, because the inference was billed to somebody else's key upstream — so a
 * BYOK call summed naively contributes nothing, `unpriced` stays `0` because a
 * cost *did* arrive, and the total reads as correct while missing real money.
 * `isByok` was recorded specifically to tell that zero from a free call, and
 * then the first version of this function ignored it, which is the whole failure
 * in miniature: the field that makes a number honest is only worth having if
 * something reads it. Found by a GPT Sol review of the code, after an earlier
 * review had asked for the field.
 *
 * So a BYOK call is priced from `upstreamCostNanos` — the inference's own worth
 * — and counted as unpriced if even that is missing.
 */
export function totalSpend(calls: readonly SpendRecord[]): {
  nanos: Nanos;
  unpriced: number;
} {
  let nanos = 0;
  let unpriced = 0;
  for (const c of calls) {
    if (c.isByok === true) {
      /* Two different pockets, so they add rather than one standing in for the
         other: `upstreamCostNanos` is what the inference was worth to whoever's
         key paid for it, and `costNanos` is whatever OpenRouter charged us on
         top — usually nothing, sometimes a fee. Falling back from one to the
         other, as the first version did, made a BYOK call with no upstream
         figure read as **zero** rather than as unknown, which is the same
         understatement one level down. */
      if (c.upstreamCostNanos === null) unpriced += 1;
      else nanos += c.upstreamCostNanos + (c.costNanos ?? 0);
      continue;
    }
    /* Not BYOK: `cost` and `cost_details.upstream_inference_cost` are the same
       money — a live probe on 2026-08-27 had them equal to seven decimal places
       — so adding both would double it. */
    if (c.costNanos === null) unpriced += 1;
    else nanos += c.costNanos;
  }
  return { nanos, unpriced };
}

/** Nano-dollars as a short human string: `$0.0142`. For logs and the CLI. */
export function formatNanos(nanos: Nanos): string {
  return `$${(nanos / 1e9).toFixed(4)}`;
}
