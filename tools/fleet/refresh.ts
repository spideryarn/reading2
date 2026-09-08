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
 *  3. **Retain**, before publishing, so the file and the stream cannot disagree
 *     about a turn. Sub-millisecond (measured), synchronous, and wrapped: a
 *     retention layer that takes the dashboard down is worse than no retention
 *     layer. See health-history.ts.
 *  4. **Publish.** The page and the stream get the fresh snapshot BEFORE
 *     anything is delivered. Delivery blocks this process — see drain.ts — and
 *     nothing a person is looking at should wait behind a keystroke.
 *  5. **Drain, last, and only after a collection that worked**, in its own
 *     try/catch. A drain that throws must not set `lastError`, must not make a
 *     good collection report as failed, and must not stop the loop: those are
 *     three different ways of turning a delivery problem into a dead dashboard.
 */
import type { FleetSnapshot } from "./collect.js";
import { summariseDrain, type DrainResult } from "./drain.js";
import type { HealthTurn, SampleStamp } from "./health-history.js";

/**
 * How long the loop waits before the next turn — **the one copy of the rule.**
 *
 * It is here, exported, rather than inline in `refreshLoop`, because two things
 * need it and they must not disagree: the loop that does the waiting, and the
 * sample that records what the next reading was expected at. A history whose
 * `nextDueMs` said 60s while the loop actually waited 300s would draw every
 * backed-off turn as an outage — an alarm that is usually wrong, which is the
 * same picture as a quiet page over a dead box.
 *
 * A failure waits five times as long, capped at five minutes, so a broken box is
 * not also hammered. That number is `server.ts`'s, from the day this box hit
 * load average 391.
 */
export function nextWaitMs(refreshMs: number, collectionFailed: boolean): number {
  return collectionFailed ? Math.min(refreshMs * 5, 300_000) : refreshMs;
}

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
  /**
   * Take the box's vitals, and **say which of the two things happened.**
   *
   * It used to return `void`, and that was enough while nothing was written
   * down. It is not enough now: `server.ts` catches a throw from
   * `collectHealth` and leaves its `health` variable holding the PREVIOUS
   * report, so a retention layer that read that variable would append a reading
   * nobody took, wearing a fresh timestamp — a lie with a clock on it, which is
   * the thing `fleetState` already refuses to write for `collectedAt`.
   *
   * Guarded by its own implementation; never throws here.
   */
  refreshHealth(): HealthTurn;
  /**
   * Write the turn down, before it is published.
   *
   * A required field rather than an optional one, so a caller cannot forget it
   * and still compile — **the bug this whole file was re-shaped around was a
   * missing line in exactly this function.**
   */
  retainHealth(turn: HealthTurn, stamp: SampleStamp): void;
  /** How often the loop intends to collect, for `nextWaitMs`. */
  refreshMs: number;
  /** The clock, injectable so a test can assert on the stamp it wrote. */
  now(): Date;
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

  const turn = deps.refreshHealth();

  // BEFORE THE DRAIN, ALWAYS. A subscriber sees the failure as well as the
  // success — silence is what a healthy quiet box looks like, and the Overseer
  // consumes this stream to record fleet history.
  deps.publish();

  /**
   * AFTER `publish`, BEFORE `drain`, and both halves of that are deliberate.
   *
   * **After publish** because publishing is what a person is waiting on, and
   * writing the history down is not — an earlier draft had this before, on a
   * "the file and the stream cannot disagree about a turn" argument that does
   * not survive contact: the append is caught rather than fatal, so it was
   * never atomic with the publish, and the page fetches the history on a
   * separate request anyway. GPT Sol's finding 11. It is measurably cheap
   * (0.017 ms median, 0.5 ms worst at load 17.5) but the box this watches is
   * one where dirty-page writeback can stall, and nothing that can stall
   * belongs in front of the live update.
   *
   * **Before drain** because the drain is up to six `execFileSync` calls at ten
   * seconds each, and anything behind it can be starved for a minute.
   *
   * **In its own try/catch** because a full disk must not stop the loop that is
   * keeping the page alive. The failure is not swallowed: the store records it
   * on itself and the history route carries it, so the page can say *nothing is
   * being written* rather than growing a hole that looks like the box going
   * down.
   *
   * `nextDueMs` is what the writer EXPECTS the interval to the next sample to
   * be, built from the three things this turn actually measured rather than
   * from an assumed cadence: the wait the loop is about to take, how long this
   * collection took, and how long the health reading took. A reader compares
   * the real interval against it to tell a break from a legitimate backoff —
   * health-history.ts § `nextDueMs`.
   */
  try {
    const collectionTookMs = collected?.tookMs ?? 0;
    const healthTookMs = turn.kind === "reading" ? turn.report.tookMs : 0;
    deps.retainHealth(turn, {
      at: deps.now().toISOString(),
      nextDueMs: nextWaitMs(deps.refreshMs, collected === null) + collectionTookMs + healthTookMs,
    });
  } catch (err) {
    deps.logError(`health history append failed: ${err instanceof Error ? err.message : String(err)}`);
  }

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
