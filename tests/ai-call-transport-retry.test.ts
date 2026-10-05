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
  ProviderRefused,
  openRouterDecisions,
  openRouterImage,
  openRouterJson,
  openRouterStream,
  openRouterTranscription,
  worthAskingAgain,
} from "../src/ai-call.js";
import { type SpendReport, collectSpend } from "../src/ai-spend.js";
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
