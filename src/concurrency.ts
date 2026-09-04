/**
 * Running several paid model calls at once, and stopping the rest when one
 * fails.
 *
 * Two stages now do this — `src/labels.ts` labels sections four at a time, and
 * `src/pdf-read.ts` transcribes PDF chunks — and both need the same three
 * things, none of which `Promise.all` gives on its own.
 *
 * **This module exists because the second caller arrived.** `allOrStop` was
 * written inside src/labels.ts and is still exported from there; the copy there
 * should import this one and go away. It was not moved in the same change
 * because that file was being rewritten by somebody else at the time, and
 * editing a file another session is mid-way through is how work gets lost —
 * docs/project/version-control.md.
 */

/**
 * `Promise.all`, but the caller gets to stop the work that has not finished.
 *
 * **The default behaviour is the bug this replaces.** `Promise.all` rejects on
 * the first failure and leaves every other promise running. For four batches of
 * text that is untidy; for a queue of PDF chunks it is a doomed run that keeps
 * buying answers nobody will read, and the bill arrives anyway.
 *
 * `stop` is where the caller aborts in-flight requests and clears the queue.
 * **Both are needed and neither reaches the other's work**: `abort` cancels
 * what is already in the air, `clear` drops what has not started. And with
 * p-queue specifically, `clear` alone is not enough in the other direction —
 * it never settles a cleared task's promise, so the `Promise.all` here would
 * wait forever on tasks that will now never run. That is why every caller must
 * also pass its `signal` to `queue.add`, so a queued task settles as aborted
 * rather than never settling at all. GPT-5.6-sol found that one, 2026-08-26.
 *
 * The original error is rethrown, not wrapped: the caller wants to know which
 * chunk failed and why, and `stop` is cleanup rather than a second opinion.
 */
export async function allOrStop<T>(work: Promise<T>[], stop: () => void): Promise<T[]> {
  try {
    return await Promise.all(work);
  } catch (err) {
    stop();
    throw err;
  }
}

/* ------------------------------------------------------- the width gate -- */

/**
 * The narrowest the gate will make itself.
 *
 * **One, and it was four until GPT Sol constructed the case against it**
 * ⟨2026-09-04, finding 3⟩. The argument for four was that below it the *deadline*
 * starts binding — src/pdf-read.ts § `CHUNK_CONCURRENCY` has the arithmetic — so
 * shrinking further trades a rate limit we can wait out for a step failure we
 * cannot. That reasoning has the trade backwards.
 *
 * Sol's provider: accepts two concurrent calls, refuses every further one
 * immediately, and takes 45 s over the ones it accepts. Floored at four, the
 * gate keeps two accepted calls and two refused ones permanently in circulation;
 * the refused pair burns `TRANSPORT_ATTEMPTS` in about six seconds, long before
 * either accepted call returns, and the first exhausted chunk cancels the
 * document. **At width two it would simply finish.** A floor does not make a
 * deadline reachable — it only guarantees we keep sending above what the
 * provider will take, and "finishes slowly, or across two attempts with the
 * checkpoints banked" beats "refused every time" at any deadline.
 *
 * The deadline is a real constraint and it is handled where it belongs: the
 * claimant's signal cuts every wait short (src/jobs.ts), and a step that runs out
 * of time hands back with its chunks banked.
 *
 * **The ceiling is the caller's**, and deliberately not a constant here: the
 * number belongs to the stage that knows what it is fanning out over, and
 * `CHUNK_CONCURRENCY` is where it is argued for. This module owns the mechanism.
 */
const MIN_WIDTH = 1;

/**
 * How far apart admissions are spread **when the gate is full**, and much less
 * than that when it is not.
 *
 * **A hundred requests that leave together arrive together.** Measured, they
 * genuinely do: the width-100 probe dispatched all hundred inside 304 ms. That
 * is precisely the shape a rate limiter is built to notice, so an admission
 * waits a moment before it goes and a burst ramps rather than slams.
 *
 * **What it does not buy is a head start for the first refusal**, and the first
 * draft of this comment claimed it did. Requests sleeping here have already
 * taken their slots, and there is no re-check of the width or the pause after
 * the sleep, so narrowing mid-burst does not hold any of them back. What stops
 * one burst halving repeatedly is the epoch stamped at admission, not this
 * ⟨GPT Sol, 2026-09-04, findings 2 and 8⟩. The spread is worth having for the
 * upstream's sake; it is not a control.
 *
 * **Scaled by how busy the gate already is, and the first draft was not** — it
 * drew from the whole range every time, so a two-chunk PDF paid up to a second
 * for a stampede of two. `tests/a-429-is-asked-again.test.ts` caught that. The
 * draw is over `inFlight / width` — the *current* width, not `max`, which was
 * the second version's bug: a gate narrowed to 4 under a max of 100 spread its
 * full complement over 30 ms and called itself busy. So the first request of a
 * wave waits nothing, a full gate waits the whole range whatever width it is
 * at, and a document with one chunk never waits at all. What is being spread is
 * a crowd, and one request is not one.
 */
const DISPATCH_JITTER_MS = 1_000;

/**
 * The longest the gate holds *everybody* after a refusal.
 *
 * Distinct from the per-request backoff in src/pdf-read.ts, which is about the
 * one chunk that was refused. This is about the other ninety-nine, which have
 * learnt nothing yet and would otherwise walk into the same wall.
 *
 * **Sixty seconds, matching src/pdf-read.ts § `MAX_RETRY_AFTER_MS`, and it was
 * ten until the two clocks were shown to disagree** ⟨GPT Sol, 2026-09-04,
 * finding 4⟩. With a ten-second cap, a `Retry-After: 60` was honoured in full by
 * the chunk that received it and truncated to a sixth for everybody else: the
 * gate reopened at ten seconds, fresh chunks walked into the same window the
 * provider had just said was closed, were refused, and — being new admissions in
 * a new epoch — halved the width *again*. The gate walked itself to the floor on
 * repeated observations of one fact. Honouring the provider's own number for the
 * whole route is the fix, and it makes each new epoch what the design says it
 * is: a genuine probe *after* the window, not another request inside it.
 *
 * Nothing runs away with this. A wait longer than sixty seconds is refused
 * outright rather than truncated (`MAX_RETRY_AFTER_MS`), and every wait here is
 * cut short by the claimant's deadline signal.
 */
const MAX_COOLOFF_MS = 60_000;

/** A slot in the gate, given back exactly once by `run`. */
interface Ticket {
  readonly epoch: number;
}

/** Somebody parked until a slot frees up, and whether they still want it. */
interface Waiter {
  alive: boolean;
  wake: () => void;
}

/**
 * **Additive increase, multiplicative decrease, over the requests in flight to
 * one upstream.** TCP's congestion control, and for the same reason: nobody
 * publishes the number, it moves, and the only way to find it is to walk into it
 * gently and back off hard.
 *
 * Three things make this more than a semaphore, and each exists because of
 * something measured:
 *
 * - **One halving per epoch, not one per refusal.** A hundred chunks that meet
 *   the same overload report a hundred 429s within a second or two, and halving
 *   for each would take the width from 100 to 1 on what is *one* piece of news.
 *   A ticket remembers the epoch it was admitted under; a refusal from a
 *   superseded epoch is counted and ignored. This is the bug that makes naive
 *   AIMD collapse under exactly the burst it is meant to survive.
 * - **The pause is global, the backoff is per-request.** Shrinking the width
 *   does nothing for requests already admitted, so a refusal also parks new
 *   admissions briefly (`MAX_COOLOFF_MS`) — long enough for the narrower width
 *   to be the thing that governs.
 * - **A refused chunk gives its slot back while it waits.** `run` wraps one
 *   *attempt*, so the backoff in src/pdf-read.ts § `withTransportRetries`
 *   happens outside the gate. This was only half true until 2026-09-04, when the
 *   chunk went on holding its **p-queue** slot through the wait and the freed
 *   gate slot reached nobody ⟨GPT Sol, finding 5⟩; `runPdfExtract`'s queue is now
 *   as wide as the chunk list and this is the only limiter.
 * - **Growth is paid for.** One extra slot per `width` successes, so recovering
 *   from 50 to 100 takes ~50 × 50 answered calls rather than happening the
 *   instant one call works. Cheap to fall, expensive to climb, which is the
 *   asymmetry that keeps it stable.
 *
 * **Not fair, and it does not need to be.** A woken waiter races any fresh
 * arrival for the slot it was woken for, and can lose and go to the back of the
 * queue. That is unbounded starvation on paper; in practice `runPdfExtract`
 * creates every chunk task before any of them runs, so after the first moment
 * there are no fresh arrivals to lose to — and at width 100 against 69 chunks no
 * queue forms at all. Written down rather than fixed, because the fix is a
 * hand-off protocol and the problem is hypothetical for the only caller.
 *
 * **Deliberately not a token bucket in src/ai-call.ts**, which is what
 * src/pdf-read.ts § `RATE_LIMIT_SPREAD_MS` proposed and still would be tidier:
 * every job on the wire would share one view of how busy the upstream is. It is
 * not built that way because only one stage runs wide enough to need it, and a
 * gate every stage must be threaded through is a change to every stage. If a
 * second wide caller arrives, move this rather than copying it.
 */
export class WidthGate {
  private width: number;
  private inFlight = 0;
  private credits = 0;
  private epoch = 0;
  private pausedUntil = 0;
  private waiting: Waiter[] = [];
  /** Counted for the log line, so an operator can see the gate working. */
  private refusals = 0;
  private narrowest: number;

  constructor(private readonly max: number) {
    this.width = max;
    this.narrowest = max;
  }

  /** What the gate has learnt, for the one log line at the end of a step. */
  report(): { width: number; narrowest: number; refusals: number } {
    return { width: this.width, narrowest: this.narrowest, refusals: this.refusals };
  }

  /**
   * Run one **attempt** — not one chunk.
   *
   * The distinction is the whole point. A chunk that is refused waits out its
   * backoff *outside* the gate, so its slot goes to somebody else rather than
   * being held idle through a wait; and the gate sees each refusal rather than
   * only the verdict after the retries have finished. src/pdf-read.ts §
   * `withTransportRetries` is the loop this sits inside.
   *
   * `rateLimited` classifies the error rather than the gate knowing about
   * `ProviderRefused`, which lives in src/ai-call.ts and would be a dependency
   * this module does not otherwise need.
   */
  async run<T>(
    work: () => Promise<T>,
    rateLimited: (error: unknown) => number | null | false,
    signal?: AbortSignal,
  ): Promise<T> {
    const ticket = await this.enter(signal);
    try {
      const answer = await work();
      this.admitted();
      return answer;
    } catch (error) {
      const asked = rateLimited(error);
      if (asked !== false) this.refused(ticket, asked);
      throw error;
    } finally {
      this.leave();
    }
  }

  private async enter(signal?: AbortSignal): Promise<Ticket> {
    for (;;) {
      if (signal?.aborted) throw abortedWaiting();
      const wait = this.pausedUntil - performance.now();
      if (wait > 0) {
        /* **Jittered on the way out, or the pause becomes the herd.** Everybody
           held here is waiting on one instant, so an unjittered wait releases
           them in lockstep — which is precisely the burst
           src/pdf-read.ts § `RATE_LIMIT_SPREAD_MS` spreads the per-request
           backoff to avoid, undone by the thing meant to help. Caught by
           `tests/a-429-is-asked-again.test.ts`, which asserts on the spread
           rather than on any one delay and went red the moment this pause
           existed without the draw. */
        await sleep(wait + Math.random() * DISPATCH_JITTER_MS, signal);
        continue;
      }
      if (this.inFlight < this.width) {
        this.inFlight += 1;
        /**
         * **Stamped here, before the jitter, because the epoch belongs to the
         * admission and not to the dispatch.**
         *
         * It used to be read after the sleep below, which quietly destroyed the
         * one property this class exists for: a call admitted under epoch 0 and
         * still sleeping when the first refusal landed woke stamped epoch 1, so
         * its refusal — news about the *old* width — halved the new one too. One
         * burst of 64 walked to the floor instead of halving once.
         * ⟨GPT Sol, 2026-09-04, finding 2⟩, reproduced by
         * `tests/width-gate.test.ts` § "stamps the epoch when the slot is
         * taken".
         */
        const ticket: Ticket = { epoch: this.epoch };
        /* Spread *after* taking the slot rather than before. Jittering the
           queue instead of the dispatch would let a hundred tasks decide they
           may go and then all go, which is the burst this is for.

           `inFlight - 1` is how many were already out when this one was let
           through, so the first of a wave waits nothing and a full gate waits
           the whole range. The slot is held across the wait on purpose: it is
           this request's slot, and releasing it would admit somebody else into
           the space the spreading just made. */
        const crowd = (this.inFlight - 1) / this.width;
        try {
          await sleep(Math.random() * DISPATCH_JITTER_MS * crowd, signal);
        } catch (err) {
          /**
           * **The slot is already taken at this point, and `run` cannot give it
           * back.** It awaits `enter` *outside* its own `try`, so an abort here
           * unwound past every release and the count leaked — permanently, on a
           * gate that is a process singleton. A hundred chunks aborted at a step
           * deadline leaked a hundred slots and left every later ingest in that
           * process at width zero, which would have looked like a dev server
           * that simply stopped transcribing.
           *
           * `leave` rather than a bare decrement, because a waiter may be parked
           * on the slot this is handing back.
           */
          this.leave();
          throw err;
        }
        return ticket;
      }
      await this.queued(signal);
    }
  }

  private queued(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const waiter: Waiter = { alive: true, wake: () => {} };
      waiter.wake = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      /**
       * **Marked dead rather than merely settled, and the first draft got this
       * wrong.** It left the aborted waker in the queue on the argument that
       * waking an already-settled promise is a harmless no-op. It is harmless
       * only if somebody wakes again afterwards. With one task in flight and a
       * dead waker at the head, that task's `leave` spends the only wake-up
       * there will ever be on nobody, and a live waiter behind it parks for
       * good — nothing is left running to release another slot. A rare deadlock
       * is still a deadlock.
       */
      const onAbort = () => {
        waiter.alive = false;
        reject(abortedWaiting());
      };
      if (signal?.aborted) {
        reject(abortedWaiting());
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  private leave(): void {
    this.inFlight -= 1;
    /* Past the dead ones, so a slot always reaches somebody who can use it. */
    for (;;) {
      const next = this.waiting.shift();
      if (!next) return;
      if (next.alive) {
        next.wake();
        return;
      }
    }
  }

  private admitted(): void {
    this.credits += 1;
    if (this.credits >= this.width) {
      this.credits = 0;
      this.width = Math.min(this.max, this.width + 1);
    }
  }

  /**
   * **Only the first refusal of an epoch moves anything**, and the rest are
   * news we already have. See the class docblock.
   */
  private refused(ticket: Ticket, retryAfterMs: number | null): void {
    this.refusals += 1;
    if (ticket.epoch !== this.epoch) return;
    this.epoch += 1;
    this.credits = 0;
    /* **Clamped to the caller's ceiling as well as to the floor**, because those
       two can disagree: `new WidthGate(1)` refused once became width *4*, above
       the maximum it was given. Only a test builds a gate narrower than
       `MIN_WIDTH`, but a bound that can be exceeded is not a bound.
       ⟨GPT Sol, 2026-09-04, finding 3⟩ */
    this.width = Math.min(this.max, Math.max(MIN_WIDTH, Math.floor(this.width / 2)));
    this.narrowest = Math.min(this.narrowest, this.width);
    const hold = Math.min(retryAfterMs ?? 2_000, MAX_COOLOFF_MS);
    /* **`performance.now`, not `Date.now`.** The wall clock can step backwards —
       an NTP correction is enough — and a `pausedUntil` computed from one that
       then jumps back is a gate that holds every request for as long as the
       correction was. Nothing here needs a date; it needs a duration. */
    this.pausedUntil = Math.max(this.pausedUntil, performance.now() + hold);
  }
}

/**
 * `name: "AbortError"`, because every layer above tells an abort from a failure
 * by that string — src/pdf-read.ts § `abortError` says the same thing about the
 * same protocol.
 */
function abortedWaiting(): Error {
  const err = new Error("The step gave up while waiting for a slot.");
  err.name = "AbortError";
  return err;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortedWaiting());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(abortedWaiting());
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
