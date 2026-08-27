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
import type { Nanos } from "./pricing.js";
import type { Task } from "./models.js";

/**
 * One paid model call, as it actually happened.
 *
 * Everything the provider did not tell us is `null` rather than `0` — a zero
 * here is indistinguishable from a free call and would understate a bill for as
 * long as nobody looked.
 */
export interface SpendRecord {
  /** Which job made the call. */
  task: Task;
  /** The model id as sent, in OpenRouter's spelling. */
  model: string;
  /** OpenRouter's own figure, in nano-dollars. `null` when it did not arrive. */
  costNanos: Nanos | null;
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

const store = new AsyncLocalStorage<SpendRecord[]>();

let dropped = 0;

/**
 * How many calls were recorded with no collector open since the process
 * started. Anything printing a total should print this too when it is not zero:
 * a total that silently omits rows is worse than no total.
 */
export function unscopedCalls(): number {
  return dropped;
}

/** Reset the dropped counter. For tests; nothing in the app should call it. */
export function resetUnscopedCalls(): void {
  dropped = 0;
}

/**
 * Run `fn` with a fresh collector, and hand back both its answer and every call
 * made inside it — including inside anything it awaited.
 *
 * `run()` with a new array each time, never `enterWith`, for the reason
 * [`src/owner.ts`](owner.ts) gives at length: `enterWith` mutates the *calling*
 * context, and two overlapping pieces of work on one process would then share a
 * box and bill each other.
 */
export async function collectSpend<T>(
  fn: () => Promise<T>,
  onDone?: (calls: readonly SpendRecord[]) => void,
): Promise<{ result: T; calls: SpendRecord[] }> {
  const calls: SpendRecord[] = [];
  try {
    const result = await store.run(calls, fn);
    return { result, calls };
  } finally {
    /* **`onDone` exists because of the failure case, not the happy one.** When
       `fn` throws, this function rejects and its `{ calls }` return never
       happens — so a caller that only reads the resolved value loses every
       record of what the failed run spent. And a run that failed is precisely
       the one worth knowing the cost of: the model call that blew up had
       usually already been paid for, and a retry pays again. Called in a
       `finally` so it fires on both paths. */
    onDone?.(calls);
  }
}

/**
 * Add a call to whatever collector is open. No-op — and counted — if none is.
 *
 * Called by [`src/messages-stream.ts`](messages-stream.ts), not by stages.
 */
export function recordSpend(record: SpendRecord): void {
  const calls = store.getStore();
  if (!calls) {
    dropped += 1;
    return;
  }
  calls.push(record);
}

/** True while a collector is open. Lets a caller decide whether to bother. */
export function collectingSpend(): boolean {
  return store.getStore() !== undefined;
}

/**
 * The total of a set of calls, in nano-dollars, **and how many of them could
 * not be priced**.
 *
 * Two numbers rather than one on purpose. A caller that gets only a total has no
 * way to tell "$0.30 across nine calls" from "$0.30 across nine calls, three of
 * which reported nothing" — and the second is a bug report.
 */
export function totalSpend(calls: readonly SpendRecord[]): {
  nanos: Nanos;
  unpriced: number;
} {
  let nanos = 0;
  let unpriced = 0;
  for (const c of calls) {
    if (c.costNanos === null) unpriced += 1;
    else nanos += c.costNanos;
  }
  return { nanos, unpriced };
}

/** Nano-dollars as a short human string: `$0.0142`. For logs and the CLI. */
export function formatNanos(nanos: Nanos): string {
  return `$${(nanos / 1e9).toFixed(4)}`;
}
