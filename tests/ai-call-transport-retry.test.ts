/**
 * **One dropped connection must not fail a whole call** — the transport retry on
 * the five OpenRouter seams of [`src/ai-call.ts`](../src/ai-call.ts), plan
 * docs/plans/261005j-the-other-ai-wires-fail-a-whole-call-on-one-dropped-connection-a-countable-retry-on-the-openrouter-seams.md.
 *
 * What is asserted is always the same three things: **how many requests went
 * out, what rows the ledger got, and which error came back.** A retry that
 * answered but wrote one row, or wrote two rows but re-bought a billed call,
 * passes any one of them alone.
 *
 * docs/plans/261005j-red-first.txt lists the tests that were red before the
 * retry existed. The plan's Gates section lists seven guards that were each
 * removed in turn, and how many tests here went red for each.
 *
 * The backoff is real code on a fake clock: `setTimeout` is faked and `drive`
 * advances it, so three attempts cost no wall time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AiRequestBody,
  ProviderRefused,
  openRouterDecisions,
  openRouterImage,
  openRouterJson,
  openRouterStream,
  openRouterTranscription,
  worthAskingAgain,
} from "../src/ai-call.js";
import { type SpendReport, collectSpend } from "../src/ai-spend.js";
import { CallDeadlineReached, StallReached } from "../src/call-failure.js";
import { EmbeddingFailure, embedBatch } from "../src/embeddings.js";
import type { StreamEnd } from "../src/openrouter-stream.js";
import { openRouterFigureLocator } from "../src/pdf-figure-locate.js";
import { openRouterReader } from "../src/pdf-read.js";
import { nameTopics } from "../src/shelf-terms/model-topics.js";
import { TRANSPORT_ATTEMPTS } from "../src/transport-retry.js";

beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------- the doubles -- */

/** One thing `fetch` does: reject with this, or answer with that. */
type Step = Error | (() => Response);

/**
 * Replace `fetch` with a script, one step per request. **Running past the end
 * throws a plain `Error`**, which nothing retries, so an unexpected extra
 * request fails the test rather than hanging it.
 */
function script(...steps: Step[]): { sent: () => number; bodies: Record<string, unknown>[] } {
  let n = 0;
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const step = steps[n++];
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (step === undefined) throw new Error(`the script had ${steps.length} steps and request ${n} was sent`);
    if (step instanceof Error) throw step;
    return step();
  });
  return { sent: () => n, bodies };
}

const dropped = () => new TypeError("fetch failed");

/** A whole (non-streamed) response. */
function whole(status: number, body: unknown, headers: Record<string, string> = {}): () => Response {
  return () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(headers),
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    }) as unknown as Response;
}

/** A refusal with nothing in it about money. */
const refused = (status: number) => whole(status, { error: { code: status } });

/** A 200 that streams `parts` and closes. */
function streamed(...parts: string[]): () => Response {
  return () => {
    const encoder = new TextEncoder();
    let i = 0;
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: new ReadableStream<Uint8Array>({
        pull(c) {
          if (i < parts.length) c.enqueue(encoder.encode(parts[i++] as string));
          else c.close();
        },
      }),
    } as unknown as Response;
  };
}

const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const WORD = frame({ choices: [{ delta: { content: "hello" } }] });
const DONE = "data: [DONE]\n\n";

/** The smallest valid PNG `readPlate` accepts — tests/ai-call-images.test.ts § `PLATE`. */
const PLATE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAC0lEQVR4nGNgwAIAABUAAapll8QAAAAASUVORK5CYII=";

interface Asked {
  signal?: AbortSignal;
  retryTransport?: false;
}

/**
 * The five seams, each with a call and the answer that makes it resolve.
 * `zeroCostIsUnpriced` marks the two whose `cost: 0` is dropped by
 * `unpriceZero` and is therefore not a price.
 */
const SEAMS: {
  name: string;
  ask: (opts: Asked) => Promise<unknown>;
  good: () => Response;
  zeroCostIsUnpriced: boolean;
}[] = [
  {
    name: "openRouterJson",
    ask: (opts) => openRouterJson("pdf", { model: "m", messages: [] }, opts),
    good: whole(200, { choices: [{ message: { content: "ok" } }] }),
    zeroCostIsUnpriced: false,
  },
  {
    name: "openRouterImage",
    ask: (opts) =>
      openRouterImage("illustrate", { model: "m", prompt: "a map", aspectRatio: "2:3", resolution: "1K" }, opts),
    good: whole(200, { data: [{ b64_json: PLATE_B64, media_type: "image/png" }] }),
    zeroCostIsUnpriced: false,
  },
  {
    name: "openRouterTranscription",
    ask: (opts) => openRouterTranscription("dictation", { model: "m", audio: "AAAA", format: "webm" }, opts),
    good: whole(200, { text: "hello" }),
    zeroCostIsUnpriced: true,
  },
  {
    name: "openRouterDecisions",
    ask: (opts) =>
      openRouterDecisions(
        "search-quick",
        { model: "m", state: { query: "q" }, questions: { a: { type: "noul", instructions: "Is it?" } } },
        opts,
      ),
    good: whole(200, { answers: { a: { noul: 0.9 } } }),
    zeroCostIsUnpriced: true,
  },
  {
    name: "openRouterStream",
    ask: async (opts) => {
      const chunks: unknown[] = [];
      for await (const c of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        {
          signal: opts.signal ?? new AbortController().signal,
          onActivity: () => {},
          end: { terminated: false },
          ...(opts.retryTransport === false ? { retryTransport: false as const } : {}),
        },
      )) {
        chunks.push(c);
      }
      return chunks;
    },
    good: streamed(WORD, DONE),
    zeroCostIsUnpriced: false,
  },
];

type Outcome = { ok: true; value: unknown } | { ok: false; err: unknown };

/**
 * Run one call inside a collector, turning the fake clock until it settles.
 * Hands back how it ended and what the ledger was told. **`pending` is checked
 * on every run**: an attempt that began and never recorded is the bug this
 * file's rule (*one record, one network attempt*) exists to rule out.
 */
async function drive(ask: () => Promise<unknown>): Promise<{ outcome: Outcome; outcomes: string[]; report: SpendReport }> {
  let outcome: Outcome | undefined;
  let done = false;
  const collecting = collectSpend(async () => {
    try {
      outcome = { ok: true, value: await ask() };
    } catch (err) {
      outcome = { ok: false, err };
    }
  }).finally(() => {
    done = true;
  });
  /* Ten fake minutes is far past any backoff here; reaching it is a hang. */
  for (let i = 0; !done; i++) {
    if (i > 6000) throw new Error("the call never settled");
    await vi.advanceTimersByTimeAsync(100);
  }
  const { report } = await collecting;
  expect(report.pending, "an attempt began and never recorded").toEqual([]);
  if (!outcome) throw new Error("no outcome");
  return { outcome, outcomes: report.calls.map((c) => c.outcome), report };
}

const errorOf = (o: Outcome): unknown => (o.ok ? undefined : o.err);

/* ---------------------------------------------------------- all five seams -- */

describe.each(SEAMS)("$name — a transport blip is retried, and every attempt is a row", (seam) => {
  it("answers when the connection drops once and then works — the reproduction", async () => {
    const t = script(dropped(), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(t.sent()).toBe(2);
    expect(run.outcomes).toEqual(["error", "ok"]);
    /* The same request, not a rebuilt one. */
    expect(t.bodies[1]).toEqual(t.bodies[0]);
  });

  it("answers when a 503 is followed by a good response", async () => {
    const t = script(refused(503), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(t.sent()).toBe(2);
    expect(run.outcomes).toEqual(["error", "ok"]);
  });

  it.each([400, 402, 429])("does not send a %i again", async (status) => {
    const t = script(refused(status), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(errorOf(run.outcome)).toBeInstanceOf(ProviderRefused);
    expect((errorOf(run.outcome) as ProviderRefused).status).toBe(status);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("gives up after three goes, with three rows and the last attempt's own error", async () => {
    const t = script(dropped(), dropped(), refused(503), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(TRANSPORT_ATTEMPTS).toBe(3);
    expect(t.sent()).toBe(3);
    expect(run.outcomes).toEqual(["error", "error", "error"]);
    const err = errorOf(run.outcome);
    expect(err).toBeInstanceOf(ProviderRefused);
    expect((err as ProviderRefused).status).toBe(503);
  });

  it("does not buy again a 503 whose body carries a cost", async () => {
    const t = script(whole(503, { usage: { cost: 0.07 } }), seam.good);
    const run = await drive(() => seam.ask({}));
    const err = errorOf(run.outcome);
    expect(err).toBeInstanceOf(ProviderRefused);
    expect((err as ProviderRefused).priced).toBe(true);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
    expect(run.report.calls[0]?.cost).toEqual({ source: "provider", costNanos: 70_000_000 });
  });

  it("says an unpriced refusal was unpriced", async () => {
    script(refused(400));
    const run = await drive(() => seam.ask({}));
    expect((errorOf(run.outcome) as ProviderRefused).priced).toBe(false);
  });

  if (seam.zeroCostIsUnpriced) {
    it("asks again after a 503 whose cost is the zero this wire does not believe", async () => {
      /* `unpriceZero` drops a non-BYOK `cost: 0` before the meter sees it, so
         the row is unpriced and so is the refusal. */
      const t = script(whole(503, { usage: { cost: 0 } }), seam.good);
      const run = await drive(() => seam.ask({}));
      expect(errorOf(run.outcome)).toBeUndefined();
      expect(t.sent()).toBe(2);
      expect(run.report.calls[0]?.cost).toEqual({ source: "none" });
    });
  }

  it("does not retry a plain Error from fetch — that is a test double or a guard, not a network", async () => {
    const boom = new Error("not a network failure");
    const t = script(boom, seam.good);
    const run = await drive(() => seam.ask({}));
    expect(errorOf(run.outcome)).toBe(boom);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it.each([
    ["a dropped connection", dropped() as Step],
    ["a 503", refused(503) as Step],
  ])("makes one request on %s when the caller passes retryTransport: false", async (_what, step) => {
    const t = script(step, seam.good);
    const run = await drive(() => seam.ask({ retryTransport: false }));
    expect(run.outcome.ok).toBe(false);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("ends as the abort it is when the signal fires during the backoff", async () => {
    const stop = new AbortController();
    const reason = new Error("the reader pressed Stop");
    const t = script(dropped(), seam.good);
    /* 50 ms is inside the shortest first wait (375 ms). */
    const run = await drive(async () => {
      setTimeout(() => stop.abort(reason), 50);
      return seam.ask({ signal: stop.signal });
    });
    /* The signal's own reason, by identity: that is what every caller's abort
       classification tests for (`stoppedByReader`, `explainAbort`). */
    expect(errorOf(run.outcome)).toBe(reason);
    expect(t.sent()).toBe(1);
    /* One row, for the attempt that was made. The wait is not a call. */
    expect(run.outcomes).toEqual(["error"]);
  });

  it("does not ask again when the failure lands on a signal that is already aborted", async () => {
    const stop = new AbortController();
    const failure = dropped();
    let sent = 0;
    vi.stubGlobal("fetch", async () => {
      sent += 1;
      stop.abort(new Error("gone"));
      throw failure;
    });
    const run = await drive(() => seam.ask({ signal: stop.signal }));
    /* The attempt's own error, unchanged: a provider dying as the reader left
       is not rewritten into a cancel. */
    expect(errorOf(run.outcome)).toBe(failure);
    expect(sent).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("opens no attempt when the signal aborts as the backoff finishes", async () => {
    const stop = new AbortController();
    const reason = new DOMException("deadline expired", "TimeoutError");
    const t = script(dropped(), seam.good);
    const schedule = globalThis.setTimeout;
    /* Resolve the wait, then abort before its continuation runs. */
    vi.spyOn(globalThis, "setTimeout").mockImplementationOnce(((callback: () => void, ms: number) =>
      schedule(() => {
        callback();
        stop.abort(reason);
      }, ms)) as typeof setTimeout);
    try {
      const run = await drive(() => seam.ask({ signal: stop.signal }));
      expect(errorOf(run.outcome)).toBe(reason);
      expect(t.sent()).toBe(1);
      expect(run.outcomes).toEqual(["error"]);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

/* ------------------------------------------------------- a 200 is the line -- */

describe("a 200 of any kind is not retried", () => {
  /** A 200 whose body throws the same class `fetch` throws for a dead socket. */
  const brokenBody = (): Response =>
    ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => {
        throw new TypeError("terminated");
      },
    }) as unknown as Response;

  it.each(SEAMS.filter((s) => s.name !== "openRouterStream"))(
    "$name: a 200 whose body will not read is one request",
    async (seam) => {
      const t = script(brokenBody, seam.good);
      const run = await drive(() => seam.ask({}));
      expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
      expect(t.sent()).toBe(1);
      expect(run.outcomes).toEqual(["error"]);
    },
  );

  it.each(SEAMS.filter((s) => s.name !== "openRouterStream"))(
    "$name: a 200 that does not parse is one request",
    async (seam) => {
      const t = script(whole(200, "<html>not json</html>"), seam.good);
      await drive(() => seam.ask({}));
      expect(t.sent()).toBe(1);
    },
  );
});

/* ----------------------------------------------------------- the predicate -- */

describe("worthAskingAgain", () => {
  it("is true for a transient refusal that priced nothing, and false once it priced something", () => {
    for (const status of [408, 409, 500, 502, 503, 504, 529]) {
      expect(worthAskingAgain(new ProviderRefused(status, "", new Headers(), false)), `${status}`).toBe(true);
      expect(worthAskingAgain(new ProviderRefused(status, "", new Headers(), true)), `${status} priced`).toBe(false);
    }
  });

  it("is false for a 429 and for a verdict", () => {
    for (const status of [400, 401, 402, 403, 404, 413, 429]) {
      expect(worthAskingAgain(new ProviderRefused(status, "", new Headers(), false)), `${status}`).toBe(false);
    }
  });

  it("is false for a TypeError that did not come from fetch, and for anything that is not an error", () => {
    expect(worthAskingAgain(new TypeError("fetch failed"))).toBe(false);
    expect(worthAskingAgain(new Error("fetch failed"))).toBe(false);
    expect(worthAskingAgain("fetch failed")).toBe(false);
    expect(worthAskingAgain(null)).toBe(false);
    expect(worthAskingAgain(undefined)).toBe(false);
  });

  it("is true for the error an opted-out seam throws when fetch itself failed", async () => {
    script(dropped());
    const run = await drive(() => openRouterJson("pdf", { model: "m", messages: [] }, { retryTransport: false }));
    expect(worthAskingAgain(errorOf(run.outcome))).toBe(true);
  });

  it("is false for a fetch that rejected with something that is not a TypeError, or not an object", async () => {
    for (const thrown of [new Error("guard"), new DOMException("slow", "TimeoutError"), "a string", null]) {
      vi.stubGlobal("fetch", async () => {
        throw thrown;
      });
      const run = await drive(() => openRouterJson("pdf", { model: "m", messages: [] }, { retryTransport: false }));
      expect(errorOf(run.outcome)).toBe(thrown);
      expect(worthAskingAgain(errorOf(run.outcome))).toBe(false);
    }
  });
});

/* -------------------------------------------------------------- the stream -- */

describe("openRouterStream — nothing is retried once a 200 is in hand", () => {
  /** Drain with everything observable: chunks, the shared `end`, and an ordered log. */
  function open(opts: { end?: StreamEnd; log?: string[]; signal?: AbortSignal } = {}) {
    const end = opts.end ?? { terminated: false };
    const chunks: unknown[] = [];
    const ask = async () => {
      for await (const c of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        {
          signal: opts.signal ?? new AbortController().signal,
          onActivity: () => opts.log?.push("activity"),
          end,
        },
      )) {
        chunks.push(c);
      }
    };
    return { ask, chunks, end };
  }

  /** A 200 whose body yields `parts` and then dies as a dropped socket does. */
  function dies(...parts: string[]): () => Response {
    return () => {
      const encoder = new TextEncoder();
      let i = 0;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            if (i < parts.length) c.enqueue(encoder.encode(parts[i++] as string));
            else c.error(new TypeError("terminated"));
          },
        }),
      } as unknown as Response;
    };
  }

  it("does not ask again when the body breaks before its first frame", async () => {
    /* Tighter than the Messages wire on purpose: a 200 here means OpenRouter
       accepted the work and may be billing it. */
    const t = script(dies(), streamed(WORD, DONE));
    const s = open();
    const run = await drive(s.ask);
    expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
    expect(s.chunks).toEqual([]);
  });

  it("does not ask again when the stream dies after a chunk was yielded", async () => {
    const t = script(dies(WORD), streamed(WORD, DONE));
    const s = open();
    const run = await drive(s.ask);
    expect(run.outcome.ok).toBe(false);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
    expect(s.chunks).toHaveLength(1);
  });

  it("hands the consumer each chunk once across a retry", async () => {
    script(refused(503), dropped(), streamed(WORD, WORD, DONE));
    const s = open();
    const run = await drive(s.ask);
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(s.chunks).toHaveLength(2);
    expect(run.outcomes).toEqual(["error", "error", "ok"]);
    expect(s.end).toMatchObject({ terminated: true, answered: true });
  });

  it("clears `end` at the start of every attempt, not only the first", async () => {
    /* Nothing in a refused attempt writes to `end` today. The fake dirties it
       during attempt one, standing in for whatever one day does, and attempt
       two must still start from a clean verdict. */
    const end: StreamEnd = { terminated: false };
    const seenAtRequest: StreamEnd[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      seenAtRequest.push({ ...end });
      if (n === 1) {
        end.terminated = true;
        end.finishReason = "stop";
        end.answered = true;
        throw dropped();
      }
      /* Refused for good, so nothing after the reset can explain a clean `end`. */
      return refused(400)();
    });
    const run = await drive(open({ end }).ask);
    expect(run.outcome.ok).toBe(false);
    expect(n).toBe(2);
    expect(seenAtRequest[1]).toEqual({ terminated: false, finishReason: null, answered: false });
    expect(end).toEqual({ terminated: false, finishReason: null, answered: false });
  });

  it("resets the caller's stall clock before the backoff and again before the next request", async () => {
    const log: string[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async () => {
      n += 1;
      log.push("request");
      if (n === 1) throw dropped();
      return refused(400)();
    });
    const s = open({ log });
    let outcome: unknown;
    const running = collectSpend(() =>
      s.ask().catch((err: unknown) => {
        outcome = err;
      }),
    );
    /* No time has passed: the first attempt has failed and the wait has begun.
       A failure that lands just before a stall clock would fire must not have
       the wait counted as provider silence. */
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toEqual(["request", "activity"]);
    await vi.advanceTimersByTimeAsync(5000);
    await running;
    expect(outcome).toBeInstanceOf(ProviderRefused);
    expect(log).toEqual(["request", "activity", "activity", "request"]);
  });

  it("opens no retry if the activity callback aborts after the wait", async () => {
    const stop = new AbortController();
    const reason = new Error("stopped after the wait");
    const t = script(dropped(), streamed(WORD, DONE));
    let activities = 0;
    const run = await drive(async () => {
      for await (const chunk of openRouterStream("chat", { model: "m", messages: [] }, {
        signal: stop.signal,
        end: { terminated: false },
        onActivity: () => {
          if (++activities === 2) stop.abort(reason);
        },
      })) void chunk;
    });
    expect(errorOf(run.outcome)).toBe(reason);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("leaves nothing pending and no timer running when the consumer stops during the backoff", async () => {
    const stop = new AbortController();
    const t = script(refused(503), streamed(WORD, DONE));
    const s = open({ signal: stop.signal });
    const run = await drive(async () => {
      setTimeout(() => stop.abort(new Error("left")), 50);
      await s.ask();
    });
    expect(run.outcome.ok).toBe(false);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ------------------------------------------ the callers that own their loop -- */

/** `openRouterJson`'s chat body, as the PDF reader expects it back. */
const pdfAnswer = whole(200, {
  usage: { cost: 0.000_25 },
  choices: [{ message: { content: JSON.stringify({ records: [], notes: "" }) } }],
});

describe("the PDF reader's own loop, through the real gateway", () => {
  const read = () => openRouterReader("openai/gpt-5.1").read(new Uint8Array([1, 2, 3]), "read it", undefined);

  it("asks again after an unpriced 503 — the gap its loop had", async () => {
    const t = script(refused(503), pdfAnswer);
    const run = await drive(read);
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(t.sent()).toBe(2);
    expect(run.outcomes).toEqual(["error", "ok"]);
  });

  it("does not buy a priced 503 again", async () => {
    const t = script(whole(503, { usage: { cost: 0.125 } }), pdfAnswer);
    const run = await drive(read);
    expect(run.outcome.ok).toBe(false);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("makes three requests on three 503s, not nine — its loop is the only loop", async () => {
    const t = script(...Array.from({ length: 10 }, () => refused(503)));
    const run = await drive(read);
    expect(run.outcome.ok).toBe(false);
    expect(t.sent()).toBe(3);
    expect(run.outcomes).toEqual(["error", "error", "error"]);
  });

  it("still does not ask again after a 400", async () => {
    const t = script(refused(400), pdfAnswer);
    await drive(read);
    expect(t.sent()).toBe(1);
  });
});

describe("embedBatch's own loop, through the real gateway", () => {
  const embedded = whole(200, { data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 3 } });
  const embed = () => embedBatch("voyage/voyage-4", ["a paragraph"], "sk-test-key", "document");

  it("asks again after a dropped connection — the gap its loop had", async () => {
    const t = script(dropped(), embedded);
    const run = await drive(embed);
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(t.sent()).toBe(2);
    expect(run.outcomes).toEqual(["error", "ok"]);
  });

  it("asks again after an unpriced 503, as it always has", async () => {
    const t = script(refused(503), embedded);
    const run = await drive(embed);
    expect(errorOf(run.outcome)).toBeUndefined();
    expect(t.sent()).toBe(2);
  });

  it("does not buy a priced 503 again", async () => {
    const t = script(whole(503, { usage: { cost: 0.01 } }), embedded);
    const run = await drive(embed);
    expect(errorOf(run.outcome)).toBeInstanceOf(EmbeddingFailure);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("does not ask again after a 200 whose body threw a TypeError", async () => {
    /* The class is the same as a dropped connection's; the boundary is not.
       Only `send` knows which, which is why the loop asks `worthAskingAgain`
       rather than `instanceof TypeError`. */
    const t = script(
      () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => {
            throw new TypeError("terminated");
          },
        }) as unknown as Response,
      embedded,
    );
    const run = await drive(embed);
    expect(errorOf(run.outcome)).toBeInstanceOf(EmbeddingFailure);
    expect(t.sent()).toBe(1);
  });

  it("makes five requests on five dropped connections, not fifteen — its loop is the only loop", async () => {
    const t = script(...Array.from({ length: 16 }, dropped));
    const run = await drive(embed);
    expect(errorOf(run.outcome)).toBeInstanceOf(EmbeddingFailure);
    expect(t.sent()).toBe(5);
    expect(run.outcomes).toEqual(["error", "error", "error", "error", "error"]);
  });
});

describe("the callers that count their asks make one request per ask", () => {
  it("the figure locator: one request on a 503, so MAX_LOCATE_CALLS stays a cap on requests", async () => {
    const t = script(refused(503), refused(503), refused(503));
    const run = await drive(() => openRouterFigureLocator({ caption: "Figure 1", pages: [] }, new AbortController().signal));
    expect(run.outcome).toEqual({ ok: true, value: { ok: false } });
    expect(t.sent()).toBe(1);
  });

  it("the figure locator: one request on a dropped connection", async () => {
    const t = script(dropped(), dropped(), dropped());
    await drive(() => openRouterFigureLocator({ caption: "Figure 1", pages: [] }, new AbortController().signal));
    expect(t.sent()).toBe(1);
  });

  it("shelf topics: one request per ask on a 503 — the two outer retries are the retry", async () => {
    const t = script(refused(503), refused(503), refused(503));
    const run = await drive(() =>
      nameTopics([{ id: "w1", title: "A paper", gist: null }], { profile: null, within: null, previous: [] }, undefined),
    );
    expect(errorOf(run.outcome)).toBeInstanceOf(ProviderRefused);
    expect(t.sent()).toBe(1);
  });
});

/* ------------------------------------- what each attempt's row says of itself --

   Plan docs/plans/261006b-count-ai-calls-that-die-part-way-and-transport-retries.md.
   The retry above writes a row per attempt; these are about what a row can be
   asked afterwards: which go it was, whether it failed before or after the
   answer began, and why. `said` is compared whole, so a row that gained a
   field it should not have is as red as one that lost one. */

/** `[attempt, outcome, failure]` for every row, in order. Nothing defaulted: a field never set is `undefined`, not `null`. */
const said = (report: SpendReport): unknown[] => report.calls.map((c) => [c.attempt, c.outcome, c.failure]);

const beforeAnswer = (cls: string, status: number | null = null) => ({ phase: "before_answer", class: cls, status });
const midAnswer = (cls: string, status: number | null = 200) => ({ phase: "mid_answer", class: cls, status });

/** `fetch failed`, with the code where undici puts it. */
const droppedWith = (code: unknown) =>
  new TypeError("fetch failed", { cause: Object.assign(new Error("socket"), { code }) });

const WHOLE = SEAMS.filter((s) => s.name !== "openRouterStream");

/**
 * What a signal can be aborted with, and the label each is recorded under.
 * The last three only look like one of our clocks. `AbortSignal.timeout`
 * itself is on a real clock this file fakes; the `DOMException` here is what
 * it aborts with, and tests/call-failure.test.ts checks that against the
 * real thing.
 */
const STOPS: { name: string; reason: () => unknown; cls: "stall" | "deadline" | "abort" }[] = [
  { name: "a stall clock", reason: () => new StallReached(), cls: "stall" },
  { name: "an AbortSignal.timeout", reason: () => new DOMException("the reader asked about badgers", "TimeoutError"), cls: "deadline" },
  { name: "a hand-written per-call clock", reason: () => new CallDeadlineReached("the reader asked about badgers"), cls: "deadline" },
  { name: "a reader's Stop", reason: () => new Error("the reader asked about badgers"), cls: "abort" },
  { name: "a plain Error that says stalled", reason: () => new Error("stalled"), cls: "abort" },
  { name: "an Error renamed TimeoutError", reason: () => Object.assign(new Error("slow"), { name: "TimeoutError" }), cls: "abort" },
  { name: "an object named TimeoutError", reason: () => ({ name: "TimeoutError" }), cls: "abort" },
];

describe.each(SEAMS)("$name — every attempt's row says which go it was, and how it failed", (seam) => {
  it("a blip then an answer is (1, error, before_answer) and (2, ok)", async () => {
    script(dropped(), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)).toEqual([
      [1, "error", beforeAnswer("network")],
      [2, "ok", null],
    ]);
  });

  it("a 503 then an answer carries the status on the failed row", async () => {
    script(refused(503), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)).toEqual([
      [1, "error", beforeAnswer("refused", 503)],
      [2, "ok", null],
    ]);
  });

  it("three failures end at attempt 3", async () => {
    script(dropped(), dropped(), refused(503), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)).toEqual([
      [1, "error", beforeAnswer("network")],
      [2, "error", beforeAnswer("network")],
      [3, "error", beforeAnswer("refused", 503)],
    ]);
  });

  it("a Stop during the backoff leaves one row, and no attempt 2", async () => {
    const stop = new AbortController();
    script(dropped(), seam.good);
    const run = await drive(async () => {
      setTimeout(() => stop.abort(new Error("the reader pressed Stop")), 50);
      return seam.ask({ signal: stop.signal });
    });
    expect(said(run.report)).toEqual([[1, "error", beforeAnswer("network")]]);
  });

  it("leaves `attempt` null when the caller owns the loop", async () => {
    script(dropped(), seam.good);
    const run = await drive(() => seam.ask({ retryTransport: false }));
    /* Phase, class and status are still the row's own; only the ordinal is
       somebody else's to count. */
    expect(said(run.report)).toEqual([[null, "error", beforeAnswer("network")]]);
  });

  it("names a network code it knows, from the cause", async () => {
    script(droppedWith("ECONNRESET"), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)[0]).toEqual([1, "error", beforeAnswer("network:ECONNRESET")]);
  });

  it("keeps nothing of a cause code or an error name it was not told about", async () => {
    const odd = Object.assign(droppedWith("reader_search_term"), { name: "reader_search_term" });
    script(odd, seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)[0]).toEqual([1, "error", beforeAnswer("network")]);
    expect(JSON.stringify(run.report.calls)).not.toContain("reader_search_term");
  });

  /* Plan 261006d: an `aborted` row says who stopped the call. The label is
     picked from the reason and nothing of the reason is kept. */
  it.each(STOPS)("an abort before any response is aborted / before_answer / $cls: $name", async ({ reason, cls }) => {
    const stop = new AbortController();
    const why = reason();
    vi.stubGlobal("fetch", async () => {
      stop.abort(why);
      throw why;
    });
    const run = await drive(() => seam.ask({ signal: stop.signal }));
    expect(said(run.report)).toEqual([[1, "aborted", beforeAnswer(cls)]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });

  it("is `other` for a failure it cannot place, and keeps none of its words", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("the reader asked about badgers");
    });
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)).toEqual([[1, "error", beforeAnswer("other")]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });
});

describe.each(WHOLE)("$name — the acceptance boundary is the 2xx headers", (seam) => {
  /** Headers of `status`, then a body that dies as a dropped socket does. */
  const brokenBody = (status: number, cause?: unknown) => (): Response =>
    ({
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(),
      text: async () => {
        throw new TypeError("terminated", cause === undefined ? undefined : { cause });
      },
    }) as unknown as Response;

  it("503 headers and a body that breaks is before_answer, with the 503", async () => {
    const t = script(brokenBody(503), seam.good);
    const run = await drive(() => seam.ask({}));
    /* Not asked again, as before: this records what happened, and changes
       nobody's retry. */
    expect(t.sent()).toBe(1);
    expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
    expect(said(run.report)).toEqual([[1, "error", beforeAnswer("refused", 503)]]);
  });

  it("a 200 whose body breaks is mid_answer", async () => {
    script(brokenBody(200, Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" })), seam.good);
    const run = await drive(() => seam.ask({}));
    expect(said(run.report)).toEqual([[1, "error", midAnswer("network:UND_ERR_SOCKET")]]);
  });

  it.each(STOPS)("an abort while the 200's body is read is aborted / mid_answer / $cls: $name", async ({ reason, cls }) => {
    const stop = new AbortController();
    const why = reason();
    script(
      () =>
        ({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => {
            stop.abort(why);
            throw why;
          },
        }) as unknown as Response,
    );
    const run = await drive(() => seam.ask({ signal: stop.signal }));
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer(cls)]]);
  });

  it("an abort while a refusal's body is read is before_answer, with the status", async () => {
    const stop = new AbortController();
    const why = new StallReached();
    const t = script(
      () =>
        ({
          ok: false,
          status: 503,
          headers: new Headers(),
          text: async () => {
            stop.abort(why);
            throw why;
          },
        }) as unknown as Response,
      seam.good,
    );
    const run = await drive(() => seam.ask({ signal: stop.signal }));
    expect(t.sent()).toBe(1);
    expect(said(run.report)).toEqual([[1, "aborted", beforeAnswer("stall", 503)]]);
  });
});

describe("a 200 that is not an answer is not an `ok` row", () => {
  const NOT_JSON = "<html>the reader asked about badgers</html>";
  const ENVELOPE = { error: { code: 502, message: "the reader asked about badgers" } };
  const json = () => openRouterJson("pdf", { model: "m", messages: [] });

  it("openRouterJson: a body that will not parse is error / mid_answer / unreadable, and still returns null", async () => {
    script(whole(200, NOT_JSON));
    const run = await drive(json);
    /* The return contract is untouched: `src/pdf-read.ts` is handed the `null`
       it has always been handed, and says its own sentence about it. */
    expect(run.outcome).toMatchObject({ ok: true, value: { json: null } });
    expect(said(run.report)).toEqual([[1, "error", midAnswer("unreadable")]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });

  it("openRouterJson: a literal JSON null parsed, and is the caller's to judge", async () => {
    script(whole(200, "null"));
    const run = await drive(json);
    expect(said(run.report)).toEqual([[1, "ok", null]]);
  });

  it("openRouterJson: an error envelope is error / mid_answer / in_band, and is still handed back", async () => {
    script(whole(200, ENVELOPE));
    const run = await drive(json);
    expect(run.outcome).toMatchObject({ ok: true, value: { json: ENVELOPE } });
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });

  it("openRouterJson: an answer that also carries an `error` is an answer", async () => {
    script(whole(200, { error: { code: 1 }, choices: [{ message: { content: "ok" } }] }));
    const run = await drive(json);
    expect(said(run.report)).toEqual([[1, "ok", null]]);
  });

  it("openRouterJson: neither is asked again", async () => {
    const t = script(whole(200, NOT_JSON), whole(200, ENVELOPE));
    await drive(json);
    expect(t.sent()).toBe(1);
  });

  it.each(WHOLE.filter((s) => s.name !== "openRouterJson"))(
    "$name: a body that will not parse is unreadable, and an envelope is in_band",
    async (seam) => {
      script(whole(200, NOT_JSON));
      const garbled = await drive(() => seam.ask({}));
      expect(garbled.outcome.ok).toBe(false);
      expect(said(garbled.report)).toEqual([[1, "error", midAnswer("unreadable")]]);
      script(whole(200, ENVELOPE));
      const enveloped = await drive(() => seam.ask({}));
      expect(enveloped.outcome.ok).toBe(false);
      expect(said(enveloped.report)).toEqual([[1, "error", midAnswer("in_band")]]);
    },
  );

  it.each(WHOLE.filter((s) => s.name !== "openRouterJson"))(
    "$name: a body that parsed and still was not an answer is unreadable",
    async (seam) => {
      script(whole(200, { nothing: "useful" }));
      const run = await drive(() => seam.ask({}));
      expect(run.outcome.ok).toBe(false);
      expect(said(run.report)).toEqual([[1, "error", midAnswer("unreadable")]]);
    },
  );
});

describe("openRouterStream — a death after the 200 is mid_answer, and says which kind", () => {
  const ERROR_CHUNK = frame({ error: { message: "the reader asked about badgers" } });

  /** A 200 that yields `parts` and then dies as a dropped socket does, code and all. */
  function dies(...parts: string[]): () => Response {
    return () => {
      const encoder = new TextEncoder();
      let i = 0;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            if (i < parts.length) c.enqueue(encoder.encode(parts[i++] as string));
            else
              c.error(
                new TypeError("terminated", { cause: Object.assign(new Error("closed"), { code: "UND_ERR_SOCKET" }) }),
              );
          },
        }),
      } as unknown as Response;
    };
  }

  /** A 200 that yields `parts` and then says nothing until `signal` fires, when the read rejects with its reason. */
  function hangs(signal: AbortSignal, ...parts: string[]): () => Response {
    return () => {
      const encoder = new TextEncoder();
      let i = 0;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: new ReadableStream<Uint8Array>({
          pull(c) {
            if (i < parts.length) {
              c.enqueue(encoder.encode(parts[i++] as string));
              return;
            }
            return new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  c.error(signal.reason);
                  resolve();
                },
                { once: true },
              );
            });
          },
        }),
      } as unknown as Response;
    };
  }

  const open = (opts: { signal?: AbortSignal; malformedFrames?: "throw"; onActivity?: () => void } = {}) =>
    openRouterStream(
      "chat",
      { model: "m", messages: [] },
      {
        signal: opts.signal ?? new AbortController().signal,
        onActivity: opts.onActivity ?? (() => {}),
        end: { terminated: false },
        ...(opts.malformedFrames ? { malformedFrames: opts.malformedFrames } : {}),
      },
    );

  /** Drain the way every real consumer does: throw on an in-band error chunk. */
  function consume(
    opts: { signal?: AbortSignal; onChunk?: () => void; onActivity?: () => void; malformedFrames?: "throw" } = {},
  ) {
    return async () => {
      for await (const c of open(opts)) {
        if (c.error) throw new Error("the provider stopped mid-answer");
        opts.onChunk?.();
      }
    };
  }

  it("a stream that breaks after a chunk", async () => {
    script(dies(WORD));
    const run = await drive(consume());
    expect(said(run.report)).toEqual([[1, "error", midAnswer("network:UND_ERR_SOCKET")]]);
  });

  it("a stream that ends without [DONE]", async () => {
    script(streamed(WORD));
    const run = await drive(consume());
    expect(said(run.report)).toEqual([[1, "error", midAnswer("unfinished")]]);
  });

  it("an in-band error chunk is an error, not the abort the consumer's throw looks like", async () => {
    script(streamed(WORD, ERROR_CHUNK, DONE));
    const run = await drive(consume());
    expect(run.outcome.ok).toBe(false);
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });

  it("an in-band error chunk is an error for a consumer that reads on past it", async () => {
    script(streamed(ERROR_CHUNK));
    const run = await drive(async () => {
      for await (const _ of open()) {
        /* drained */
      }
    });
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
  });

  it("keeps an observed in-band error when the body subsequently breaks", async () => {
    const t = script(dies(ERROR_CHUNK), streamed(WORD, DONE));
    const run = await drive(async () => {
      for await (const _ of open()) {
        /* Read on after the provider's error. */
      }
    });
    expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
    expect(t.sent()).toBe(1);
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
  });

  it("keeps an observed in-band error when a later read is aborted", async () => {
    const stop = new AbortController();
    const reason = new Error("the reader pressed Stop");
    const t = script(streamed(ERROR_CHUNK, WORD, DONE));
    let reads = 0;
    const run = await drive(async () => {
      for await (const _ of open({
        signal: stop.signal,
        onActivity: () => {
          if (++reads === 2) stop.abort(reason);
        },
      })) {
        /* Read on until the abort lands on the next body read. */
      }
    });
    expect(errorOf(run.outcome)).toBe(reason);
    expect(t.sent()).toBe(1);
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
  });

  it("keeps an observed in-band error when it is our own stall clock that stops the later read", async () => {
    const stop = new AbortController();
    script(streamed(ERROR_CHUNK, WORD, DONE));
    let reads = 0;
    const run = await drive(async () => {
      for await (const _ of open({
        signal: stop.signal,
        onActivity: () => {
          if (++reads === 2) stop.abort(new StallReached());
        },
      })) {
        /* Read on until the stall lands on the next body read. */
      }
    });
    expect(said(run.report)).toEqual([[1, "error", midAnswer("in_band")]]);
  });

  /* No signal fired, so nobody's clock did this: `abort`. */
  it("a consumer that simply stops is aborted / mid_answer / abort", async () => {
    script(streamed(WORD, WORD, DONE));
    const run = await drive(async () => {
      for await (const _ of open()) break;
    });
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer("abort")]]);
  });

  it("a consumer that stops while a clock that has not fired is on the signal is still `abort`", async () => {
    script(streamed(WORD, WORD, DONE));
    const run = await drive(async () => {
      for await (const _ of open({ signal: new AbortController().signal })) break;
    });
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer("abort")]]);
  });

  /* The clean-end race: `sseChunks` cancels the reader on abort, the
     cancelled read resolves `done`, and the loop ends without throwing. The
     row has to say who stopped it all the same. */
  it.each(STOPS)("a stop after a chunk, ending the loop cleanly, is aborted / mid_answer / $cls: $name", async ({ reason, cls }) => {
    const stop = new AbortController();
    script(streamed(WORD, WORD, DONE));
    const run = await drive(consume({ signal: stop.signal, onChunk: () => stop.abort(reason()) }));
    expect(run.outcome.ok).toBe(true);
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer(cls)]]);
    expect(JSON.stringify(run.report.calls)).not.toContain("badgers");
  });

  /* The other way an abort ends a stream: the loop throws the signal's own
     reason, here because the signal fired while a chunk was being read. */
  it.each(STOPS)("a stop that the stream throws is aborted / mid_answer / $cls: $name", async ({ reason, cls }) => {
    const stop = new AbortController();
    const why = reason();
    script(streamed(WORD, WORD, DONE));
    let reads = 0;
    const run = await drive(
      consume({
        signal: stop.signal,
        onActivity: () => {
          if (++reads === 2) stop.abort(why);
        },
      }),
    );
    expect(errorOf(run.outcome)).toBe(why);
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer(cls)]]);
  });

  /* This seam's boundary is a `2xx` with a body in hand, so a provider that
     answers `200` and then says nothing has been accepted: `mid_answer`. */
  it("a stall after the 200 and before the first chunk is mid_answer / stall", async () => {
    const stop = new AbortController();
    script(hangs(stop.signal));
    const run = await drive(async () => {
      setTimeout(() => stop.abort(new StallReached()), 50);
      await consume({ signal: stop.signal })();
    });
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer("stall")]]);
  });

  it("a stall while the request is still waiting for headers is before_answer / stall, and is not asked again", async () => {
    const stop = new AbortController();
    const why = new StallReached();
    let sent = 0;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      sent += 1;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const run = await drive(async () => {
      setTimeout(() => stop.abort(why), 50);
      await consume({ signal: stop.signal })();
    });
    expect(sent).toBe(1);
    expect(errorOf(run.outcome)).toBe(why);
    expect(said(run.report)).toEqual([[1, "aborted", beforeAnswer("stall")]]);
  });

  /* What a runner really hands the gateway: the reader's signal, a deadline
     and a stall clock, as one. */
  it("tells the stall from the reader through the composite signal a runner builds", async () => {
    const reader = new AbortController();
    const stall = new AbortController();
    const deadline = new AbortController();
    const signal = AbortSignal.any([reader.signal, deadline.signal, stall.signal]);
    script(hangs(signal, WORD));
    const run = await drive(async () => {
      setTimeout(() => stall.abort(new StallReached()), 50);
      /* The reader leaving afterwards does not rewrite who stopped it. */
      setTimeout(() => reader.abort(new Error("the reader left")), 60);
      await consume({ signal })();
    });
    expect(said(run.report)).toEqual([[1, "aborted", midAnswer("stall")]]);
  });

  it("a frame that is not JSON, where the caller asked for that to throw, is unreadable", async () => {
    script(streamed(WORD, "data: {the reader asked about badgers\n\n", DONE));
    const run = await drive(consume({ malformedFrames: "throw" }));
    expect(run.outcome.ok).toBe(false);
    expect(said(run.report)).toEqual([[1, "error", midAnswer("unreadable")]]);
  });

  it("the accepted attempt of a retried stream is attempt 2, and its death is mid_answer", async () => {
    script(dropped(), dies(WORD));
    const run = await drive(consume());
    expect(said(run.report)).toEqual([
      [1, "error", beforeAnswer("network")],
      [2, "error", midAnswer("network:UND_ERR_SOCKET")],
    ]);
  });

  it("a 200 with no body never reached the boundary", async () => {
    script(
      () => ({ ok: true, status: 200, headers: new Headers(), body: null, text: async () => "" }) as unknown as Response,
    );
    const run = await drive(consume());
    expect(said(run.report)).toEqual([[1, "error", beforeAnswer("unreadable", 200)]]);
  });
});

describe("a caller with a loop of its own gets the cause on every row, and no ordinal", () => {
  it("the PDF reader: three 503s are three rows, each with `attempt` null", async () => {
    script(...Array.from({ length: 10 }, () => refused(503)));
    const run = await drive(() => openRouterReader("openai/gpt-5.1").read(new Uint8Array([1, 2, 3]), "read it", undefined));
    expect(said(run.report)).toEqual([
      [null, "error", beforeAnswer("refused", 503)],
      [null, "error", beforeAnswer("refused", 503)],
      [null, "error", beforeAnswer("refused", 503)],
    ]);
  });
});

/* ------------------------------------------- a paid web search, sent once -- */

/**
 * **A web search is not bought twice** — qi-2gaxfaaj, plan
 * docs/plans/261009e-paid-web-search-not-retried-after-it-was-sent.md. A
 * request carrying `openrouter:web_search` is asked again after a network
 * failure only when the cause proves no request left; a reset may come after
 * OpenRouter accepted, and billed, the searches.
 */
const SEARCH_TOOLS = [{ type: "openrouter:web_search", parameters: { engine: "exa", max_results: 5 } }];

const SEARCHING: { name: string; ask: (body?: AiRequestBody) => Promise<unknown>; good: () => Response }[] = [
  {
    name: "openRouterJson",
    ask: (body = { model: "m", messages: [], tools: SEARCH_TOOLS }) => openRouterJson("reception", body),
    good: whole(200, { choices: [{ message: { content: "ok" } }] }),
  },
  {
    name: "openRouterStream",
    ask: async (body = { model: "m", messages: [], tools: SEARCH_TOOLS }) => {
      const chunks: unknown[] = [];
      for await (const c of openRouterStream(
        "chat",
        body,
        { signal: new AbortController().signal, onActivity: () => {}, end: { terminated: false } },
      )) {
        chunks.push(c);
      }
      return chunks;
    },
    good: streamed(WORD, DONE),
  },
];

describe.each(SEARCHING)("$name with a web search — sent again only if it never left", (seam) => {
  it("checks the sent payload even when the caller removes tools during the request", async () => {
    const body: AiRequestBody = { model: "m", messages: [], tools: SEARCH_TOOLS };
    const failure = droppedWith("ECONNRESET");
    let sent = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent++;
      expect(JSON.parse(String(init.body)).tools).toEqual(SEARCH_TOOLS);
      body.tools = [];
      if (sent === 1) throw failure;
      return seam.good();
    });
    const run = await drive(() => seam.ask(body));
    expect(errorOf(run.outcome)).toBe(failure);
    expect(sent).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it("checks tools produced by JSON serialization", async () => {
    const failure = droppedWith("ECONNRESET");
    const t = script(failure, seam.good);
    const run = await drive(() => seam.ask({
      model: "m",
      messages: [],
      tools: { toJSON: () => SEARCH_TOOLS },
    }));
    expect(t.bodies[0]?.tools).toEqual(SEARCH_TOOLS);
    expect(errorOf(run.outcome)).toBe(failure);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it.each([
    ["a reset", () => droppedWith("ECONNRESET")],
    ["a closed socket", () => droppedWith("UND_ERR_SOCKET")],
    ["a broken pipe", () => droppedWith("EPIPE")],
    ["a headers timeout", () => droppedWith("UND_ERR_HEADERS_TIMEOUT")],
    ["a body timeout", () => droppedWith("UND_ERR_BODY_TIMEOUT")],
    ["an ETIMEDOUT, which can come after the write", () => droppedWith("ETIMEDOUT")],
    ["a bare fetch failed, which names nothing", dropped],
  ])("does not send it again after %s", async (_what, failure) => {
    const t = script(failure(), seam.good);
    const run = await drive(seam.ask);
    expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it.each(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"])(
    "sends it again after %s, which no request got past",
    async (code) => {
      const t = script(droppedWith(code), seam.good);
      const run = await drive(seam.ask);
      expect(errorOf(run.outcome)).toBeUndefined();
      expect(t.sent()).toBe(2);
      expect(run.outcomes).toEqual(["error", "ok"]);
    },
  );

  it.each([408, 409, 500, 502, 503, 504, 529])("does not send it again after an unpriced %i", async (status) => {
    const t = script(refused(status), seam.good);
    const run = await drive(seam.ask);
    expect((errorOf(run.outcome) as ProviderRefused).status).toBe(status);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });

  it.each(["code", "cause"] as const)("does not mistake a refusal's %s for an unsent request", async (where) => {
    const failure = Object.assign(
      new ProviderRefused(503, "", new Headers(), false),
      where === "code" ? { code: "ECONNREFUSED" } : { cause: droppedWith("ECONNREFUSED") },
    );
    const t = script(failure, seam.good);
    const run = await drive(seam.ask);
    expect(errorOf(run.outcome)).toBe(failure);
    expect(t.sent()).toBe(1);
    expect(run.outcomes).toEqual(["error"]);
  });
});

it("a web search on the default engine is sent once too", async () => {
  const t = script(droppedWith("ECONNRESET"), whole(200, { choices: [{ message: { content: "ok" } }] }));
  const run = await drive(() =>
    openRouterJson("reception", { model: "m", messages: [], tools: [{ type: "openrouter:web_search" }] }),
  );
  expect(errorOf(run.outcome)).toBeInstanceOf(TypeError);
  expect(t.sent()).toBe(1);
});

it.each(SEAMS)("$name asks fetch to refuse redirects, including when retries are opted out", async (seam) => {
  let redirect: RequestRedirect | undefined;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    redirect = init.redirect;
    return seam.good();
  });
  const run = await drive(() => seam.ask({ retryTransport: false }));
  expect(errorOf(run.outcome)).toBeUndefined();
  expect(redirect).toBe("error");
});

it("a call without a web search is still asked again after a reset", async () => {
  const t = script(droppedWith("ECONNRESET"), whole(200, { choices: [{ message: { content: "ok" } }] }));
  const run = await drive(() => openRouterJson("reception", { model: "m", messages: [] }));
  expect(errorOf(run.outcome)).toBeUndefined();
  expect(t.sent()).toBe(2);
});
