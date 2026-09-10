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
 *  3. **Publish.** The page and the stream get the fresh snapshot before a
 *     filesystem write or delivery can delay them.
 *  4. **Retain**, after publishing and before draining. The append is wrapped,
 *     because a retention layer that takes the dashboard down is worse than no
 *     retention layer, and delivery can block this process for a minute. See
 *     health-history.ts and the detailed ordering note below.
 *  5. **Drain, last, and only after a collection that worked**, in its own
 *     try/catch. A drain that throws must not set `lastError`, must not make a
 *     good collection report as failed, and must not stop the loop: those are
 *     three different ways of turning a delivery problem into a dead dashboard.
 */
import { collectWithDeadline, type FleetSnapshot } from "./collect.js";
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
   * `collectHealthAsync` and leaves its `health` variable holding the PREVIOUS
   * report, so a retention layer that read that variable would append a reading
   * nobody took, wearing a fresh timestamp — a lie with a clock on it, which is
   * the thing `fleetState` already refuses to write for `collectedAt`.
   *
   * Guarded by its own implementation; never throws here.
   */
  refreshHealth(): Promise<HealthTurn>;
  /**
   * Write the turn down after it is published and before delivery starts.
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

  const turn = await deps.refreshHealth();

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

/* ==================================================================== *
 * THE LATCH: one owned collection attempt at a time.
 * ==================================================================== */

/**
 * The sentence a person reads when the collector is still wedged.
 *
 * Deliberately NOT `collectionAbandoned`'s sentence, which says the attempt
 * *has been* abandoned and invites the reader to expect a fresh one next
 * minute. This one says the opposite: the child from last time is still there,
 * and nothing new can be read until it exits. Exported so a test can hold it.
 */
export function collectionStillRunning(forMs: number): string {
  return (
    `the previous collection has been running for ${Math.round(forMs / 1000)}s and has not finished — ` +
    `no second one has been started, because a wedged tmux or bash child does not get better by being ` +
    `given a sibling; any rows shown are from the last collection that completed`
  );
}

type Attempt = {
  seq: number;
  startedAtMs: number;
  /** The child itself, which outlives the caller's deadline. */
  child: Promise<FleetSnapshot>;
  /** Set by the child's own handler, whichever way it went. */
  settled: boolean;
  /** Set when the caller's deadline expired and the child had NOT settled. */
  abandoned: boolean;
};

export type SingleFlightDeps = {
  /** The real collection. **Uncancellable** — see the header note below. */
  run(): Promise<FleetSnapshot>;
  /** How long a CALLER waits. The child is not bound by it. */
  deadlineMs: number;
  now(): number;
  /**
   * **Called when a child ACTUALLY STARTS**, and not when a caller merely asks.
   *
   * It exists so `attemptedAt` can keep meaning what it has always meant. A
   * turn that the latch refuses does not start a collection, and a field that
   * advanced anyway would tell the page *a collection was started 0s ago*
   * while the previous one had been wedged for seven minutes — GPT Sol's P1,
   * 2026-09-08. Changing the field's meaning instead would mean migrating
   * every consumer of it (`Header.tsx`, `daemon.ts`, `attempt-clock.ts`,
   * `observation.ts`, `notes.ts`), which is a bigger change than this whole
   * stage and belongs to their owners.
   */
  onStart?(): void;
  /** A line about a child that came back after its caller had given up. Optional; logged, not thrown. */
  onLate?(line: string): void;
};

export type SingleFlightCollector = {
  /** Drop-in for `RefreshDeps["collect"]`. */
  collect(): Promise<FleetSnapshot>;
};

/**
 * One collection attempt at a time, and a deadline that belongs to the CALLER
 * rather than to the child.
 *
 * **The bug this closes.** `collectWithDeadline` races the collection against a
 * timer and rejects when the timer wins — but nothing cancels the child, and
 * nothing remembers it. So the loop reported a failure, waited its backoff, and
 * called `collect()` again while the first `bash -c` was still grepping
 * thirty-five transcripts. On a box that has hit load average 391 with the OOM
 * killer firing, the *response* to a wedged collector was a second one, then a
 * third. E-blocking in docs/plans/260908f-….
 *
 * **What this does and does not do.** It does not cancel anything: full
 * cancellation is a later stage, and a `SIGTERM` to a child in uninterruptible
 * IO proves nothing anyway (source.ts's header, 2026-09-08). It bounds the
 * *number* of children at one, which is the cheap half and the half that stops
 * the accumulation.
 *
 * **A late child's ANSWER IS DROPPED, whichever way it went** — logged, so the
 * difference between *the child finally finished* and *it is gone for ever* is
 * on the record, but never fed to anybody.
 *
 * That is a deliberate choice against the tempting one. A late SUCCESS is a
 * real snapshot that cost twelve seconds, and handing it to the next caller
 * looks like thrift. But `refreshOnce` gives whatever `collect()` resolves with
 * to `drain()`, which sends tmux keystrokes at panes named by the snapshot's
 * rows and decides *whether to send now* from each row's `status` — and this
 * file already has the rule for that, six lines from the bottom: **stale rows
 * are how the right text reaches the wrong session.** A snapshot that arrived
 * eight minutes after it was asked for is stale rows by construction. Using it
 * for the page but not for the drain would mean teaching `refreshOnce` a third
 * kind of outcome, which is a mechanism, and this stage is the smallest bound
 * rather than a rewrite. Twelve seconds is cheaper than that.
 *
 * So *a late result cannot overwrite a newer observation* holds in its
 * strongest form: a late result never reaches an observation at all.
 *
 * A late FAILURE is dropped for a second reason as well: it is an answer to a
 * question asked minutes ago, and turning it into `lastError` would mark the
 * page stale twice for one child.
 */
export function singleFlightCollect(deps: SingleFlightDeps): SingleFlightCollector {
  let inFlight: Attempt | null = null;
  let seq = 0;

  function invoke(): Promise<FleetSnapshot> {
    // A synchronous throw from `run` must look like a rejection, so the one
    // place that clears `inFlight` is the settle handler below.
    try {
      return deps.run();
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  function start(): Attempt {
    const child = invoke();
    const attempt: Attempt = { seq: ++seq, startedAtMs: deps.now(), child, settled: false, abandoned: false };
    inFlight = attempt;
    // Here and nowhere else: a turn that never reaches `start` never started a
    // collection, and nothing downstream may be told that it did.
    deps.onStart?.();
    // REGISTERED HERE, BEFORE THE RACE, for two reasons. It is the only handler
    // that runs whether or not a caller is still waiting — so `inFlight` is
    // released by the child settling rather than by anyone's patience — and a
    // child that rejects after its caller gave up would otherwise be an
    // unhandled rejection that takes the dashboard down.
    // `.catch` ON THE DERIVED PROMISE, not just on the child. The child's own
    // rejection is handled by the second argument below — but if `onLate` or
    // `deps.now` throws, the promise `then` RETURNS rejects with nobody
    // listening, and an unhandled rejection takes this process down. Probed by
    // GPT Sol with an `onLate` that throws, 2026-09-08.
    void child
      .then(
        (snapshot) => {
          attempt.settled = true;
          inFlight = null;
          if (!attempt.abandoned) return;
          // `started`, not `abandoned`: the deadline is when we STOPPED
          // WAITING, and this clock is measured from when the child began.
          deps.onLate?.(
            `the collection started ${Math.round((deps.now() - attempt.startedAtMs) / 1000)}s ago, and since abandoned, ` +
              `has come back with ${snapshot.rows.length} rows, collected at ${snapshot.collectedAt} — not used, ` +
              `because the drain would aim keystrokes with statuses that old; the next turn collects afresh`,
          );
        },
        (cause) => {
          attempt.settled = true;
          inFlight = null;
          if (!attempt.abandoned) return;
          // Dropped on purpose: see the header. The loop has already reported
          // this attempt as abandoned, and the page must not go stale twice for it.
          deps.onLate?.(
            `the collection started ${Math.round((deps.now() - attempt.startedAtMs) / 1000)}s ago, and since abandoned, ` +
              `has failed: ${cause instanceof Error ? cause.message : String(cause)} — not reported, the attempt was ` +
              `already given up on`,
          );
        },
      )
      .catch(() => undefined);
    return attempt;
  }

  return {
    async collect(): Promise<FleetSnapshot> {
      if (inFlight !== null) {
        // NO SECOND CHILD. The caller gets a sentence naming the condition,
        // which `refreshOnce` puts in `lastError` beside the previous
        // snapshot — the existing error-and-age UI, not a new channel.
        throw new Error(collectionStillRunning(deps.now() - inFlight.startedAtMs));
      }
      const attempt = start();
      try {
        // `collectWithDeadline` over the SAME promise rather than a second
        // call: the race, the timer hygiene and the sentence are already
        // written and tested there, and the child is ours to keep.
        return await collectWithDeadline(() => attempt.child, deps.deadlineMs);
      } catch (cause) {
        // Asked of the ATTEMPT rather than of `inFlight`, because there are two
        // ways to arrive here and only one of them is an abandonment: the
        // deadline won the race (the child is still out there), or the child
        // itself rejected (it is not). `settled` is the question that
        // distinguishes them, and it is the child's own handler that answers it.
        if (!attempt.settled) attempt.abandoned = true;
        throw cause;
      }
    },
  };
}
