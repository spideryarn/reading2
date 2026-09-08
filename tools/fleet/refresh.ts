/**
 * What one turn of the fleet dashboard's background loop does, and in which
 * order — separated from `server.ts` so it can be driven by a test.
 *
 * **IT IS HERE BECAUSE OF THE BUG THIS STAGE IS ABOUT.** The queue had a route
 * that filled it, a queue that could hand items out, and a delivery module that
 * could send them; every part was tested and no line of the product joined
 * them, so items were accepted and never delivered. A test that proves the
 * route and the drain share a queue does not catch that — the missing line was
 * in `refresh()`, in a file no test can import, because importing `server.ts`
 * binds port 8787. GPT Sol's D8, 2026-09-08. So the ORDER lives here, where a
 * test can enqueue through the real route, run one turn, and watch the message
 * reach a fake transport; and `server.ts` is left holding nothing but the
 * dependencies.
 *
 * THE ORDER IS THE DESIGN, and each step is where it is for a reason that has
 * already cost something:
 *
 *  1. **Collect**, and keep the result — or keep the error and the previous
 *     snapshot, because a blank page is a lie that looks like an empty box.
 *  2. **Health, whatever happened.** It used to be inside the success branch,
 *     which had it backwards: a collection fails when the box is in trouble, so
 *     the reading that would explain the failure was the one the failure
 *     prevented (GPT Astra's A17).
 *  3. **Publish.** The page and the stream get the fresh snapshot BEFORE
 *     anything is delivered. Delivery blocks this process — see drain.ts — and
 *     nothing a person is looking at should wait behind a keystroke.
 *  4. **Drain, last, and only after a collection that worked**, in its own
 *     try/catch. A drain that throws must not set `lastError`, must not make a
 *     good collection report as failed, and must not stop the loop: those are
 *     three different ways of turning a delivery problem into a dead dashboard.
 */
import type { FleetSnapshot } from "./collect.js";
import { summariseDrain, type DrainResult } from "./drain.js";

/**
 * Everything one turn needs from the outside world.
 *
 * `keep` rather than a return value, because the snapshot has to be visible to
 * the routes *before* `publish` renders it, and a function that returned it
 * would leave that ordering to the caller — which is the kind of ordering this
 * file exists to hold.
 */
export type RefreshDeps = {
  /** The fleet collection. Rejects when the box could not be read. */
  collect(): Promise<FleetSnapshot>;
  /** Store the snapshot, or the error beside the previous snapshot. Called before `publish`. */
  keep(result: { snapshot: FleetSnapshot } | { error: string }): void;
  /** Take the box's vitals. Guarded by its own implementation; never throws here. */
  refreshHealth(): void;
  /** Broadcast the current state to the stream, and make it available to pollers. */
  publish(): void;
  /** One delivery pass. The whole snapshot, because `tmuxServerPid` is load-bearing. */
  drain(snapshot: FleetSnapshot): DrainResult;
  log(line: string): void;
  logError(line: string): void;
  /** How many live subscribers, for the collection's log line. */
  subscribers(): number;
};

export type RefreshOutcome = {
  /** The snapshot this turn produced, or null when the collection failed. */
  collected: FleetSnapshot | null;
  /** The collection's error, or null. */
  error: string | null;
  /** What the drain did, or null when it did not run or threw. */
  drained: DrainResult | null;
  /** The drain's own failure, which is deliberately NOT `error`. */
  drainError: string | null;
};

export async function refreshOnce(deps: RefreshDeps): Promise<RefreshOutcome> {
  let collected: FleetSnapshot | null = null;
  let error: string | null = null;

  try {
    const snapshot = await deps.collect();
    deps.keep({ snapshot });
    collected = snapshot;
    const live = deps.subscribers();
    deps.log(`collected ${snapshot.rows.length} sessions in ${snapshot.tookMs}ms${live > 0 ? ` → ${live} live` : ""}`);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    deps.keep({ error });
    deps.logError(`collection failed: ${error}`);
  }

  deps.refreshHealth();
  // BEFORE THE DRAIN, ALWAYS. A subscriber sees the failure as well as the
  // success — silence is what a healthy quiet box looks like, and the Overseer
  // consumes this stream to record fleet history.
  deps.publish();

  if (collected === null) {
    // NOTHING IS DELIVERED OFF A FAILED COLLECTION. The rows we would aim at
    // are the previous ones, and their statuses are the reason a message is
    // sent now rather than in a minute. Stale rows are how the right text
    // reaches the wrong session.
    return { collected: null, error, drained: null, drainError: null };
  }

  try {
    const drained = deps.drain(collected);
    deps.log(summariseDrain(drained));
    return { collected, error: null, drained, drainError: null };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    deps.logError(`drain failed: ${why}`);
    // `error` stays null: the collection worked, and the loop must not slow
    // itself down (or report STALE on the page) because a delivery failed.
    return { collected, error: null, drained: null, drainError: why };
  }
}
