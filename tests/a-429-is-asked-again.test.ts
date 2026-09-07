/**
 * **A rate limit means *ask again later*, and this stage used to treat it as a
 * verdict.**
 *
 * `withTransportRetries` in src/pdf-read.ts excluded every `ProviderRefused`,
 * and the comment said why: *"a 400, a 429, a 402 — asking twice more changes
 * none of those."* That is right for a malformed request and for an empty
 * account, and wrong for the one status whose entire meaning is that the same
 * request will work in a moment. A single 429 was immediately fatal, and because
 * `allOrStop` cancels its siblings on the first rejection it took every chunk in
 * flight with it — on a path where `PDF_READER_MODEL` is routed with
 * `allow_fallbacks: false`, so every concurrent chunk competes for one upstream.
 * Widening `CHUNK_CONCURRENCY` to 100 raises the request rate into it, which is
 * why this is fixed in the same stage rather than noted
 * (docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md § Stage 5).
 *
 * **Driven through `openRouterReader().read()` with the wire stubbed**, not
 * through the retry helper, because the two things most likely to be wrong are
 * at the seams: that a 429 off a real `Response` becomes a `ProviderRefused`
 * carrying a parsed `Retry-After` at all, and that the chunk reader passes its
 * step deadline down far enough to interrupt a wait. A unit test of the loop
 * would assert neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WidthGate } from "../src/concurrency.js";
import { CHUNK_CONCURRENCY, openRouterReader } from "../src/pdf-read.js";

/**
 * **A gate per test, not the process-wide one.**
 *
 * `openRouterReader` defaults to a module singleton, which is right in
 * production — what is being rationed is requests to one upstream, and that
 * belongs to the account rather than to a job — and wrong here twice over. Its
 * `pausedUntil` survives from one test to the next, and these tests reset the
 * fake clock underneath it, so a 429 in one case held the *first* request of the
 * next one and three tests went red at once. State that outlives a test is state
 * a test cannot reason about.
 *
 * At `CHUNK_CONCURRENCY` so the width these exercise is the real one.
 */
let gate: WidthGate;

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key");
  vi.useFakeTimers();
  gate = new WidthGate(CHUNK_CONCURRENCY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** One page of transcription, in the shape `parseRecords` accepts. */
const TRANSCRIPTION = JSON.stringify({
  records: [
    {
      page: 1,
      type: "paragraph",
      text: "A page of prose.",
      continues: false,
      uncertain: false,
    },
  ],
});

function anAnswer(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: TRANSCRIPTION }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * **A rate limit that arrives as HTTP 200**, which OpenRouter documents and does:
 * a non-streaming generation failure can keep the 200 and put the provider's
 * error in the body, `code: 429` and all.
 *
 * Found by GPT Sol reviewing the built stage, 2026-09-04, finding 1 — the
 * highest-severity one, because this shape defeated *both* safety nets at once.
 * `openRouterReader` checked `json.error` after `pdfCall` had already returned,
 * so the refusal never reached `withTransportRetries` (no retry) and never
 * reached the gate (no halving, and a growth credit awarded for a call that
 * failed). One of these cancelled the whole document on the first occurrence.
 */
function aBodyRefusal(code: number, errorType?: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message: "rate limited",
        ...(errorType ? { metadata: { error_type: errorType } } : {}),
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function aRefusal(status: number, retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: { message: "no" } }), {
    status,
    ...(retryAfter ? { headers: { "retry-after": retryAfter } } : {}),
  });
}

/**
 * Answers the wire from a script, one entry per call, and counts.
 *
 * Returns the counter rather than relying on `fetch.mock.calls`, because the
 * claim in most of these tests is *how many times it asked*, and that is the
 * assertion a broken retry loop turns red.
 */
function wire(script: (() => Response)[]): { calls: () => number } {
  let calls = 0;
  vi.stubGlobal("fetch", async () => {
    const next = script[Math.min(calls, script.length - 1)];
    calls += 1;
    if (!next) throw new Error("no answer scripted");
    return next();
  });
  return { calls: () => calls };
}

const A_PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("a rate limit on a PDF chunk", () => {
  it("is asked again, and the second answer is the one used", async () => {
    const w = wire([() => aRefusal(429), anAnswer]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    await vi.advanceTimersByTimeAsync(60_000);

    const result = await reading;
    expect(w.calls()).toBe(2);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.text).toBe("A page of prose.");
  });

  /**
   * **`Retry-After` is the provider telling us when, and it is obeyed.**
   *
   * Asserted as *not yet, then yes* rather than by reading a delay off a mock:
   * a loop that ignored the header and used its own shorter backoff would pass
   * a "did it eventually retry" test and fail this one, which is the whole
   * difference between honouring the header and happening to retry.
   */
  it("waits as long as the provider asked before asking again", async () => {
    const w = wire([() => aRefusal(429, "5"), anAnswer]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.calls(), "asked again before the provider said to").toBe(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await reading;
    expect(w.calls()).toBe(2);
  });

  /**
   * **A wait longer than our own old ceiling is still waited in full**, and
   * this is the assertion that separates *honouring the header* from *happening
   * to retry at about the right time*.
   *
   * The first version of this stage clamped the header twice — to 30 s where it
   * is parsed (`retryAfterMs`, src/ai-call.ts) and to 30 s again by
   * `MAX_BACKOFF_MS` — so a provider asking for 45 s was asked again at 30 s,
   * inside its own window, by every one of sixteen chunks. Forty-five seconds is
   * a wait the step can afford, and the only party that knows when the queue
   * drains said so. ⟨GPT Sol, reviewing this stage, 2026-09-04⟩
   */
  it("waits the whole of a Retry-After it can afford, past its own backoff ceiling", async () => {
    const w = wire([() => aRefusal(429, "45"), anAnswer]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    /* Past both old clamps, and well inside the window the provider named. */
    await vi.advanceTimersByTimeAsync(35_000);
    expect(w.calls(), "asked again inside the window the provider named").toBe(1);

    await vi.advanceTimersByTimeAsync(15_000);
    await reading;
    expect(w.calls()).toBe(2);
  });

  /**
   * **A wait the step cannot afford fails now rather than pretending.**
   *
   * Ten minutes does not fit in a 740 s deadline shared with fifteen other
   * chunks, and the two dishonest answers are truncating it — asking again at
   * 30 s, sixteen times over, inside a window the provider has just told us it
   * is still closed — and sleeping through the deadline doing nothing. The third
   * is this: give up this attempt at once. Nothing is lost, because every
   * answered chunk is already banked in the checkpoints and a Retry resumes from
   * them (src/pdf-read.ts § `CHUNK_CONCURRENCY`).
   */
  it("gives up rather than truncating a Retry-After it cannot afford", async () => {
    const w = wire([() => aRefusal(429, "600"), anAnswer]);

    const settled = openRouterReader("test/model", gate)
      .read(A_PDF, "read page 1")
      .then(
        () => null,
        (err: unknown) => err,
      );
    await vi.advanceTimersByTimeAsync(700_000);

    expect(w.calls(), "asked again inside a window the provider said was closed").toBe(1);
    expect(((await settled) as Error).message).toContain("429");
  });

  /**
   * **Sixteen chunks meeting one rate limit must not come back as one.**
   *
   * `CHUNK_CONCURRENCY` is 16 and `PDF_READER_MODEL` is routed with
   * `allow_fallbacks: false`, so every chunk competes for a single upstream.
   * A fixed sleep means all sixteen retry in the same millisecond: Sol's probe
   * put the initial requests inside 59 ms and all sixteen retries inside a
   * **15 ms window**, which is a synchronised herd aimed at the one thing that
   * has just said *slow down*.
   *
   * The assertion is on the **spread**, not on any one delay: a fixed sleep
   * produces exactly one wake-up moment however long it is, and jitter produces
   * many. Four is far below what sixteen draws over eighty buckets give and far
   * above what a lockstep loop can produce.
   */
  it("spreads sixteen chunks that all meet the same rate limit", async () => {
    const wakeups: number[] = [];
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      if (calls <= 16) return aRefusal(429);
      wakeups.push(Date.now());
      return anAnswer();
    });

    const reader = openRouterReader("test/model", gate);
    const chunks = Array.from({ length: 16 }, () => reader.read(A_PDF, "read page 1"));
    /* In steps, so the clock the retries wake on is real rather than one jump. */
    for (let ms = 0; ms < 40_000; ms += 25) await vi.advanceTimersByTimeAsync(25);
    await Promise.all(chunks);

    expect(wakeups).toHaveLength(16);
    expect(new Set(wakeups).size, "sixteen chunks retried in lockstep").toBeGreaterThanOrEqual(4);
  });

  it("is asked again when the 429 arrives inside a 200", async () => {
    const w = wire([() => aBodyRefusal(429), anAnswer]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    await vi.advanceTimersByTimeAsync(60_000);
    const records = (await reading).records;

    expect(w.calls(), "a body-level 429 was treated as a verdict").toBe(2);
    expect(records).toHaveLength(1);
  });

  it("tells the gate about a 429 that arrived inside a 200", async () => {
    const w = wire([() => aBodyRefusal(429, "rate_limit_exceeded"), anAnswer]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    await vi.advanceTimersByTimeAsync(60_000);
    await reading;

    expect(w.calls()).toBe(2);
    /* The point of routing it through `ProviderRefused`: the width halves, and a
       failed call does not earn a growth credit. */
    expect(gate.report().refusals).toBe(1);
    expect(gate.report().narrowest).toBe(CHUNK_CONCURRENCY / 2);
  });

  /**
   * **A body error that is not a rate limit stays a verdict.** A 400 in a 200 is
   * still a request this code got wrong, and asking again a hundred times over
   * turns one bad request into three hundred.
   */
  it("does not retry a body-level error that is not a rate limit", async () => {
    const w = wire([() => aBodyRefusal(400), anAnswer]);

    const settled = openRouterReader("test/model", gate)
      .read(A_PDF, "read page 1")
      .then(
        () => null,
        (err: unknown) => err,
      );
    await vi.advanceTimersByTimeAsync(60_000);

    expect(w.calls()).toBe(1);
    expect((await settled) as Error).toBeInstanceOf(Error);
    expect(gate.report().refusals).toBe(0);
  });

  it("gives up after a fixed number of goes rather than for ever", async () => {
    const w = wire([() => aRefusal(429)]);

    const reading = openRouterReader("test/model", gate).read(A_PDF, "read page 1");
    const settled = reading.then(
      () => null,
      (err: unknown) => err,
    );
    await vi.advanceTimersByTimeAsync(600_000);

    /* `TRANSPORT_ATTEMPTS` in src/pdf-read.ts. Pinned deliberately: a loop that
       grew a fourth go would be paying a rate-limited provider to say no. */
    expect(w.calls()).toBe(3);
    expect((await settled) as Error).toBeInstanceOf(Error);
    expect(((await settled) as Error).message).toContain("429");
  });

  /**
   * **The two that are verdicts, and stay verdicts.** A 400 is a request this
   * code got wrong and a 402 is an empty account; asking twice more changes
   * neither, and doing it on 16 concurrent chunks turns one bad request into
   * 48.
   */
  it.each([400, 402, 404])("does not ask again after a %i", async (status) => {
    const w = wire([() => aRefusal(status)]);

    const settled = openRouterReader("test/model", gate)
      .read(A_PDF, "read page 1")
      .then(
        () => null,
        (err: unknown) => err,
      );
    await vi.advanceTimersByTimeAsync(600_000);

    expect(w.calls()).toBe(1);
    expect(((await settled) as Error).message).toContain(String(status));
  });

  /**
   * **The step's deadline outranks the backoff.**
   *
   * `runPdfExtract` passes `ctx.signal` down to each chunk, and it is what
   * aborts the step at `LEASE_MS - DEADLINE_MARGIN_MS`. A wait that ignored it
   * would hold a chunk — and, through `allOrStop`, the run — past the moment
   * the claimant meant to hand back, which is the mid-step kill the whole
   * budget table exists to prevent.
   */
  it("stops waiting when the step's deadline fires", async () => {
    const w = wire([() => aRefusal(429, "20")]);
    const abort = new AbortController();

    const settled = openRouterReader("test/model", gate)
      .read(A_PDF, "read page 1", abort.signal)
      .then(
        () => null,
        (err: unknown) => err,
      );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(w.calls()).toBe(1);

    abort.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(w.calls(), "asked again after the step had given up").toBe(1);
    expect((await settled) as Error).toBeInstanceOf(Error);
  });
});
