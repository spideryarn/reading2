/**
 * The adaptive width gate, which is the safety belt for a hundred concurrent
 * PDF chunks.
 *
 * **These tests exist because the thing they cover could not be provoked.**
 * `scripts/spike-pdf-width.ts overload` fired 150, 250 and **400** concurrent requests at
 * `PDF_READER_MODEL` on 2026-09-04 and every single one came back 200: the
 * upstream would not rate-limit us at any width reachable from this box. So the
 * throttle ships as insurance against a status nobody has seen it meet, and a
 * throttle validated only by "it never fired" is validated by nothing. Every
 * refusal below is injected.
 *
 * The one that matters most is *halves once for a burst, not once per refusal*.
 * A hundred chunks meeting one overload report a hundred 429s within a second,
 * and the naive loop takes the width from 100 to 1 on a single piece of news —
 * turning a brief rate limit into a step that then misses its deadline at width
 * 4. That is the failure this design is shaped around.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { WidthGate } from "../src/concurrency.js";

/** A 429 as the gate's classifier reports one: the `Retry-After`, or `null`. */
const RATE_LIMITED = () => null;
/**
 * A rate limit that asks for no cool-off at all.
 *
 * `0` rather than `null`, so `retryAfterMs ?? 2_000` leaves it at zero and the
 * gate does not park new admissions. Used where the claim under test is about
 * the *width* and a pause would serialise the waves into separate epochs — which
 * is real behaviour, and has its own test below.
 */
const RATE_LIMITED_NOW = () => 0;
/** Anything the width must not move for. */
const NOT_LOAD = () => false as const;

class Refused extends Error {}

/**
 * Runs `count` tasks through the gate at once and reports the most that were
 * ever inside together.
 *
 * `settle` decides each task's fate, so a test can refuse the first wave and
 * answer the rest.
 */
async function peakInside(
  gate: WidthGate,
  count: number,
  settle: (at: number) => Promise<unknown>,
  classify: (error: unknown) => number | null | false = NOT_LOAD,
): Promise<number> {
  let inside = 0;
  let peak = 0;
  const runs = Array.from({ length: count }, (_, at) =>
    gate
      .run(
        async () => {
          inside += 1;
          peak = Math.max(peak, inside);
          try {
            return await settle(at);
          } finally {
            inside -= 1;
          }
        },
        classify,
      )
      .catch(() => null),
  );
  await Promise.all(runs);
  return peak;
}

describe("the width gate", () => {
  /* **Vitest does not restore a spy between tests on its own**, and this file
     installs one in almost every case. Without this, `noJitter`'s
     `Math.random = 0` leaked forward into the tests that need a *positive*
     draw — so the mid-dispatch abort case below documented "jitter is left on
     here" while running with no jitter at all. ⟨GPT Sol, finding 7⟩ */
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* Jitter is a spread, and a spread is the one thing an exact assertion cannot
     hold. It has its own test in `a-429-is-asked-again.test.ts`, which asserts
     on the spread rather than on any one delay. Pinned to zero here so the
     arithmetic below is about the width and nothing else. */
  const noJitter = () => vi.spyOn(Math, "random").mockReturnValue(0);

  it("never lets more than the width run at once", async () => {
    noJitter();
    const gate = new WidthGate(8);
    const peak = await peakInside(gate, 40, async () => {
      await new Promise((r) => setTimeout(r, 1));
    });
    expect(peak).toBe(8);
  });

  it("halves the width when the upstream refuses", async () => {
    noJitter();
    const gate = new WidthGate(64);
    await peakInside(
      gate,
      1,
      () => Promise.reject(new Refused()),
      RATE_LIMITED,
    );
    expect(gate.report().width).toBe(32);
  });

  /**
   * **The one that the epoch rule is for.**
   *
   * Sixty-four chunks admitted together, every one refused. A gate that halved
   * per refusal would run 64 → 32 → 16 → 8 → 4 and stay at the floor; this one
   * halves once, because all sixty-four are reporting the same overload and the
   * width they were admitted under has already been superseded.
   *
   * The refusals are all *counted* — `refusals` is 64 — so the halving being
   * one is a decision rather than a dropped signal.
   */
  it("halves once for a burst of refusals, not once per refusal", async () => {
    noJitter();
    const gate = new WidthGate(64);
    await peakInside(gate, 64, () => Promise.reject(new Refused()), RATE_LIMITED);
    const report = gate.report();
    expect(report.refusals).toBe(64);
    expect(report.width).toBe(32);
  });

  /**
   * **The epoch must belong to the admission, not to the dispatch.**
   *
   * ⟨GPT Sol, reviewing the built stage, 2026-09-04, finding 2⟩ and the one that
   * matters most, because it defeats the property the whole design is for.
   *
   * `enter` took the slot, then slept out the dispatch jitter, and only *then*
   * read `this.epoch` into the ticket. So a call admitted under epoch 0 that was
   * still sleeping when the first refusal landed woke up stamped epoch 1 — and
   * its own refusal, which is news about the *old* width, was counted as news
   * about the new one and halved again. Sixty-four calls in one burst therefore
   * walked 64 → 32 → 16 → 8 → 4 instead of 64 → 32.
   *
   * **My own epoch test could not have caught it**, and that is the lesson: it
   * pinned `Math.random` to zero, so there was no jitter to be stamped after.
   * The test agreed with the code by construction —
   * docs/reusable/silent-success.md. This one forces the maximum draw instead.
   */
  it("stamps the epoch when the slot is taken, not after the jitter", async () => {
    /* The largest possible delay, so every admission after the first is still
       sleeping when the first refusal comes back. */
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const gate = new WidthGate(64);
    await peakInside(gate, 64, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    const report = gate.report();
    expect(report.refusals).toBe(64);
    expect(report.width, "one burst halved the width more than once").toBe(32);
  });

  it("halves again for a refusal from the next epoch", async () => {
    noJitter();
    const gate = new WidthGate(64);
    await peakInside(gate, 4, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    expect(gate.report().width).toBe(32);
    /* A second wave, admitted after the first shrank it, is new news. */
    await peakInside(gate, 4, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    expect(gate.report().width).toBe(16);
  });

  /**
   * **A refusal that keeps coming back keeps shrinking the width**, and the
   * cool-off is what makes that so: chunks held at the pause and released into a
   * still-refusing upstream arrive in fresh epochs, so each wave's first refusal
   * halves again. Written down because it looks like the epoch rule failing and
   * is the opposite — the rule suppresses duplicate news, not new news.
   *
   * Sustained refusal therefore walks 64 → 4 rather than sitting at 32, which is
   * the behaviour worth having: the provider is still saying no.
   */
  it("keeps shrinking while the upstream keeps refusing", async () => {
    noJitter();
    const gate = new WidthGate(64);
    for (let wave = 0; wave < 4; wave++) {
      await peakInside(gate, 2, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    }
    expect(gate.report().width).toBe(4);
  });

  /**
   * **One, not four**, and the reasoning is on src/concurrency.ts § `MIN_WIDTH`:
   * a floor above what the provider will actually take does not rescue the
   * deadline, it only guarantees a permanent supply of refused requests.
   */
  it("will not shrink below the floor however often it is refused", async () => {
    noJitter();
    const gate = new WidthGate(64);
    for (let wave = 0; wave < 12; wave++) {
      await peakInside(gate, 2, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    }
    expect(gate.report().width).toBe(1);
    expect(gate.report().narrowest).toBe(1);
  });

  /**
   * **A gate can never be made wider than the ceiling it was given**, including
   * by the floor. `new WidthGate(1)` refused once became width *four* — the floor
   * winning against the maximum. Only a test builds a gate this narrow, but a
   * bound that can be exceeded is not a bound.
   */
  it("never lets the floor push the width above the caller's ceiling", async () => {
    noJitter();
    const gate = new WidthGate(1);
    await peakInside(gate, 1, () => Promise.reject(new Refused()), RATE_LIMITED_NOW);
    expect(gate.report().width).toBe(1);
  });

  /**
   * **An error that says nothing about load must not move the width.** A dropped
   * connection and a 400 are both retried or refused elsewhere; treating either
   * as congestion would let one malformed request throttle the whole document.
   */
  it("leaves the width alone for a failure that is not a rate limit", async () => {
    noJitter();
    const gate = new WidthGate(64);
    await peakInside(gate, 20, () => Promise.reject(new Refused()), NOT_LOAD);
    expect(gate.report().width).toBe(64);
    expect(gate.report().refusals).toBe(0);
  });

  /**
   * **Cheap to fall, expensive to climb.** One slot per `width` answered calls,
   * so a gate knocked down to 32 needs 32 successes to reach 33 — not one
   * success to spring back to where it was refused.
   */
  it("earns the width back a slot at a time", async () => {
    noJitter();
    const gate = new WidthGate(64);
    await peakInside(gate, 1, () => Promise.reject(new Refused()), RATE_LIMITED);
    expect(gate.report().width).toBe(32);

    await peakInside(gate, 31, () => Promise.resolve("ok"));
    expect(gate.report().width, "grew before it had paid for it").toBe(32);

    await peakInside(gate, 1, () => Promise.resolve("ok"));
    expect(gate.report().width).toBe(33);
  });

  it("never grows past the ceiling it was given", async () => {
    noJitter();
    const gate = new WidthGate(4);
    await peakInside(gate, 200, () => Promise.resolve("ok"));
    expect(gate.report().width).toBe(4);
  });

  /**
   * **A slot is given back even when the work throws**, which is the leak that
   * would turn one failing chunk into a gate that admits nobody. Asserted by
   * running far more tasks than the width after a wave of failures: if the
   * failures had kept their slots, this would never settle.
   */
  it("gives a slot back when the work throws", async () => {
    noJitter();
    const gate = new WidthGate(4);
    await peakInside(gate, 4, () => Promise.reject(new Refused()), NOT_LOAD);
    const peak = await peakInside(gate, 12, () => Promise.resolve("ok"));
    expect(peak).toBeGreaterThan(0);
  });

  /**
   * The signal here is the claimant's self-abort at `LEASE_MS -
   * DEADLINE_MARGIN_MS` (src/jobs.ts). Waiting through it would hold the whole
   * run past the moment the claimant meant to hand the job back, so the deadline
   * outranks the gate rather than being added to it — and it must reject with
   * `name: "AbortError"`, because every layer above tells an abort from a
   * failure by that string.
   */
  it("stops waiting for a slot when the step gives up", async () => {
    noJitter();
    const gate = new WidthGate(1);
    const abort = new AbortController();
    /* Fills the one slot and never returns, so the second is left waiting. */
    const held = gate
      .run(() => new Promise(() => {}), NOT_LOAD, abort.signal)
      .catch((err: unknown) => err);
    await Promise.resolve();
    const queued = gate
      .run(() => Promise.resolve("never runs"), NOT_LOAD, abort.signal)
      .catch((err: unknown) => err);

    abort.abort();
    const err = (await queued) as Error;
    expect(err.name).toBe("AbortError");
    /* `held` is deliberately not awaited. The gate does not cancel work that is
       already running — the caller's signal goes into the request itself, which
       is where a cancel belongs — so this promise never settles, and awaiting it
       would hang the test rather than assert anything. */
    void held;
  });

  /**
   * **The deadlock an aborted waiter used to cause.**
   *
   * The first draft left an aborted waker in the queue, reasoning that waking an
   * already-settled promise is a harmless no-op. It is harmless only if there is
   * another wake-up behind it. Here there is not: one slot, one task in flight,
   * a dead waiter at the head of the queue and a live one behind it. When the
   * running task finishes it spends the only `leave` there will ever be on the
   * dead waiter, and the live one parks for ever with nothing left running to
   * release a slot.
   *
   * Fails by timing out rather than by asserting, which is what a liveness bug
   * looks like from the outside.
   */
  it("gives a freed slot to a waiter that is still waiting", async () => {
    noJitter();
    const gate = new WidthGate(1);
    let release: (() => void) | undefined;
    const holding = gate.run(
      () => new Promise<string>((r) => (release = () => r("done"))),
      NOT_LOAD,
    );
    await Promise.resolve();

    /* Queued first, so it sits at the head — and then goes away. */
    const abandon = new AbortController();
    const abandoned = gate
      .run(() => Promise.resolve("never"), NOT_LOAD, abandon.signal)
      .catch((err: unknown) => err);
    await Promise.resolve();
    /* Queued behind the one that is about to abort. */
    let arrived = false;
    const waiting = gate
      .run(
        () => {
          arrived = true;
          return Promise.resolve("at last");
        },
        NOT_LOAD,
      )
      .catch(() => null);

    abandon.abort();
    expect(((await abandoned) as Error).name).toBe("AbortError");

    release?.();
    await holding;
    await waiting;
    expect(arrived, "the freed slot went to a waiter that had given up").toBe(true);
  });

  /**
   * **A slot taken and then abandoned mid-dispatch must be given back.**
   *
   * `enter` increments `inFlight` and *then* waits out the dispatch jitter, so a
   * step whose deadline fires during that wait aborts a task that is already
   * holding a slot. `run` awaits `enter` outside its own `try`, so nothing
   * released it: the count leaked, permanently, on a gate that is a process
   * singleton. A hundred chunks aborted at a deadline leaked a hundred slots and
   * left every later ingest in that process running at width zero — the failure
   * would have shown up as a dev server that stopped transcribing anything, one
   * job after the deadline that caused it.
   *
   * Jitter is left *on* here, because the wait is what opens the window.
   */
  it("gives the slot back when the step gives up mid-dispatch", async () => {
    /* **Positive on purpose**, so the second admission is genuinely asleep in
       the dispatch jitter when the abort arrives — that sleep is the window the
       bug lived in. This read zero until 2026-09-04 because `noJitter`'s spy
       leaked in from an earlier test, so the case documented a window it was not
       actually opening ⟨GPT Sol, finding 7⟩. */
    const draw = vi.spyOn(Math, "random").mockReturnValue(0.9);
    const gate = new WidthGate(4);
    const abort = new AbortController();
    const runs = [0, 1].map(() =>
      gate
        .run(() => Promise.resolve("ok"), NOT_LOAD, abort.signal)
        .catch((err: unknown) => err),
    );
    abort.abort();
    await Promise.all(runs);

    /* **Now with the jitter off**, because the question here is how many slots
       the gate still has, and jitter's whole job is to stop admissions
       overlapping — which would read as a lost slot and is not one. */
    draw.mockReturnValue(0);
    const peak = await peakInside(gate, 4, async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(peak, "a slot was lost when a dispatch was aborted").toBe(4);
  });

  it("refuses to admit anyone during the cool-off after a refusal", async () => {
    vi.useFakeTimers();
    try {
      const gate = new WidthGate(8);
      await peakInside(
        gate,
        1,
        () => Promise.reject(new Refused()),
        () => 5_000,
      );

      let ran = false;
      const next = gate
        .run(
          () => {
            ran = true;
            return Promise.resolve("ok");
          },
          NOT_LOAD,
        )
        .catch(() => null);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(ran, "went while the gate was still cooling off").toBe(false);

      /* The 5s the refusal asked for, plus the draw that stops everybody
         resuming on the same instant. */
      await vi.advanceTimersByTimeAsync(7_000);
      await next;
      expect(ran).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * **The cap matches what a request will obey**, so the gate cannot reopen
   * inside a window the provider has just declared closed — the cause of the
   * width walking to the floor on one repeated fact. A ten-minute ask is still
   * refused rather than obeyed.
   */
  it("caps the cool-off however long the provider asked for", async () => {
    vi.useFakeTimers();
    try {
      const gate = new WidthGate(8);
      await peakInside(
        gate,
        1,
        () => Promise.reject(new Refused()),
        () => 600_000,
      );

      let ran = false;
      const next = gate
        .run(
          () => {
            ran = true;
            return Promise.resolve("ok");
          },
          NOT_LOAD,
        )
        .catch(() => null);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(ran, "reopened inside the window the provider named").toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      await next;
      expect(ran, "held for the whole ten minutes the provider named").toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
