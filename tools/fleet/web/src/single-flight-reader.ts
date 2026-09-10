/**
 * **ONE READ IN FLIGHT, ONE PENDING, A DEADLINE THAT DOES NOT TRUST THE READ.**
 *
 * The core that `useActions.ts` (`actionsReader`, the queues) and
 * `FeedPanel.tsx` (`feedReader`, the recent-messages feed) both delegate to.
 * They had grown the same machine almost line for line, and differed only in
 * what starts a read; two copies of a concurrency mechanism is where one gets a
 * fix and the other does not (plan 260910c § Stage 4a, "One reader, not two").
 *
 * **What it knows:** how to run one read at a time and settle it exactly once.
 * **What it does not:** polls, evidence, floors, visibility. What *starts* a
 * read, and whether a hidden tab may, stays with each caller — the two are
 * deliberately different (the feed holds every read while hidden, F52; the
 * queues let a person's refresh read from a hidden tab). The caller's gate
 * plugs in through `admit`.
 *
 * Its promises, each with a test in tests/fleet-single-flight-reader.test.ts:
 *
 *  - **One live read slot.** A request during a read becomes exactly one more,
 *    after it — neither overlapping nor vanishing, however many times it is
 *    asked for. A timed-out read's promise may stay unresolved if the read
 *    ignores abort, but it no longer owns the slot and its answer is unwelcome.
 *  - **Its own deadline.** Each read is raced against `deadlineMs` on this
 *    core's timer; on expiry the signal is aborted, `noAnswer` is settled and
 *    the slot released. Nothing waits on the read honouring the abort.
 *  - **Every answer is generation-checked**, so one that arrives after its
 *    deadline, a discard or stop is dropped rather than drawn over a newer one.
 *  - **`stop` is final**: it aborts and discards whatever is in flight or
 *    pending, clears the deadline, and refuses every later request.
 */
import { describeError } from "./transport";

export type SingleFlightOptions<T> = {
  /** The read itself. Must pass the signal on to whatever it fetches; it is aborted at the deadline, on discard and on stop. */
  read: (signal: AbortSignal) => Promise<T>;
  /** How long one read may take before this core stops waiting for it. */
  deadlineMs: number;
  /** A read that produced no answer — the deadline passed, or its promise rejected — as the caller's outcome, from this core's words. */
  noAnswer: (why: string) => T;
  /** The current read's outcome. Called once per read, and never for one timed out, discarded or stopped. */
  onSettle: (outcome: T) => void;
  /**
   * Asked each time a read would start with the slot free — a request, or the
   * pending read coming due. Return false and nothing starts and nothing is
   * pending: the caller has taken the read over (the feed holds it until the
   * tab is visible). Not asked for a request made during a read — that one is
   * only marked pending. Absent: always start.
   */
  admit?: () => boolean;
  /** A read is starting, just before `read` is called. */
  onStart?: () => void;
  /** A read settled and nothing was pending. Not called when a pending read starts, or `admit` refuses one. */
  onIdle?: () => void;
};

export type SingleFlightReader = {
  /** Read now; during a read, read exactly once more after it. */
  request: () => void;
  /** Whether a read owns the slot. */
  reading: () => boolean;
  /** Abort the read in flight, drop the pending one, and make both answers unwelcome. The core stays usable. */
  discard: () => void;
  /** `discard`, and refuse every later request. Idempotent. */
  stop: () => void;
};

export function singleFlightReader<T>(options: SingleFlightOptions<T>): SingleFlightReader {
  const { read, deadlineMs, noAnswer, onSettle, admit, onStart, onIdle } = options;
  let stopped = false;
  let generation = 0;
  let inFlight: { controller: AbortController; deadline: ReturnType<typeof setTimeout> } | null = null;
  let pending = false;

  const settle = (mine: number, outcome: T): void => {
    if (stopped || mine !== generation || inFlight === null) return;
    clearTimeout(inFlight.deadline);
    inFlight = null;
    onSettle(outcome);
    if (pending) {
      pending = false;
      request();
    } else {
      onIdle?.();
    }
  };

  const request = (): void => {
    if (stopped) return;
    if (inFlight !== null) {
      pending = true;
      return;
    }
    if (admit !== undefined && !admit()) return;
    generation += 1;
    const mine = generation;
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      settle(
        mine,
        noAnswer(
          `the dashboard did not answer within ${Math.round(deadlineMs / 1000)}s, so this page stopped waiting — the box may be loaded, or the read stuck`,
        ),
      );
    }, deadlineMs);
    inFlight = { controller, deadline };
    onStart?.();
    read(controller.signal).then(
      (outcome) => settle(mine, outcome),
      (cause: unknown) => settle(mine, noAnswer(`the read failed before it answered: ${describeError(cause)}`)),
    );
  };

  const discard = (): void => {
    generation += 1;
    pending = false;
    if (inFlight === null) return;
    clearTimeout(inFlight.deadline);
    inFlight.controller.abort();
    inFlight = null;
  };

  return {
    request,
    reading: () => inFlight !== null,
    discard,
    stop: () => {
      if (stopped) return;
      discard();
      stopped = true;
    },
  };
}
