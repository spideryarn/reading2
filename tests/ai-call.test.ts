/**
 * The chat-wire gateway — [`src/ai-call.ts`](../src/ai-call.ts).
 *
 * **The point of this file is the lifecycle, not the parsing.** A GPT Sol review
 * of the first draft found the hole in about a page: when the fetch, the status
 * check and the metering were three things a caller held, a non-200 let the
 * caller throw its own error before it ever reached the metering step, and the
 * call sat open having cost money nobody recorded. So the tests that matter here
 * are the ugly exits — a refusal, a consumer that breaks, a throw, an abort, a
 * body that will not read — each asserting that **exactly one spend record**
 * comes out.
 *
 * Every one of them was checked against the broken state before being kept: the
 * `finally` was deleted, the `catch` was deleted, the idempotence guard was
 * deleted, and each mutation turned something here red. A test nobody has
 * watched fail is not evidence — docs/reusable/silent-success.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_JOB_ROUTE,
  ProviderRefused,
  openRouterJson,
  openRouterStream,
  pathFor,
} from "../src/ai-call.js";
import { AI_JOB_WIRE } from "../src/models.js";
import { collectSpend } from "../src/ai-spend.js";
import type { StreamEnd } from "../src/openrouter-stream.js";

/* The env is stubbed explicitly rather than relied on: vite.config.ts's
   `loadEnvLocal()` leaks `.env.local` into vitest, so a test that "passes"
   because the real key is present passes only on this laptop. */
beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** One SSE frame, as OpenRouter writes them. */
function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * A usage chunk exactly as a live streamed chat/completions call returns one —
 * copied verbatim from a probe on 2026-08-27, cost and all.
 */
const USAGE_CHUNK = frame({
  choices: [],
  usage: {
    prompt_tokens: 14,
    completion_tokens: 4,
    total_tokens: 18,
    cost: 0.000068,
    is_byok: false,
    prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    cost_details: { upstream_inference_cost: 0.000068 },
  },
});

interface Sent {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Replace `fetch`, capture what went out, replay what comes back. */
function stubTransport(reply: () => Response | Promise<Response>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({
      url,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
      headers: init.headers as Record<string, string>,
    });
    return reply();
  });
  return sent;
}

/** A 200 that streams `parts` and then closes. */
function streamed(...parts: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "x-generation-id": "gen-test-1" }),
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < parts.length) c.enqueue(encoder.encode(parts[i++] as string));
        else c.close();
      },
    }),
  } as unknown as Response;
}

function end(): StreamEnd {
  return { terminated: false };
}

const noop = () => {};

/** Drain a stream inside a collector and hand back what was recorded. */
async function drain(
  reply: () => Response | Promise<Response>,
  opts: { signal?: AbortSignal } = {},
) {
  const sent = stubTransport(reply);
  const signal = opts.signal ?? new AbortController().signal;
  const chunks: unknown[] = [];
  const { report } = await collectSpend(async () => {
    for await (const c of openRouterStream(
      "chat",
      { model: "anthropic/claude-sonnet-5", messages: [] },
      { signal, onActivity: noop, end: end() },
    )) {
      chunks.push(c);
    }
  });
  return { report, chunks, sent };
}

describe("the request that actually goes out", () => {
  it("sends the routing policy for the job, not whatever the caller felt like", async () => {
    const { sent } = await drain(() =>
      streamed(USAGE_CHUNK, "data: [DONE]\n\n"),
    );
    /* The literal, not the constant it was built from: a test that asserts a
       value against its own source asserts nothing. */
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0]?.body.provider).toEqual({
      order: ["anthropic"],
      require_parameters: true,
    });
  });

  it("asks for usage on both flags, because the absence of either looks like a free call", async () => {
    const { sent } = await drain(() =>
      streamed(USAGE_CHUNK, "data: [DONE]\n\n"),
    );
    expect(sent[0]?.body.usage).toEqual({ include: true });
    expect(sent[0]?.body.stream).toBe(true);
    expect(sent[0]?.body.stream_options).toEqual({ include_usage: true });
  });

  it("overrides a caller that tried to set the protected fields anyway", async () => {
    /* The type says `never`, so this cannot be written in ordinary code. It can
       be built at run time from something the type system never saw — a body
       assembled from JSON, a spread of a wider object — and the injection is
       after the spread precisely so that case cannot win. */
    const sent = stubTransport(() => streamed(USAGE_CHUNK, "data: [DONE]\n\n"));
    const sneaky = {
      model: "anthropic/claude-sonnet-5",
      messages: [],
      provider: { order: ["someone-else"] },
      usage: { include: false },
      stream_options: { include_usage: false },
    } as unknown as { model: string };
    await collectSpend(async () => {
      for await (const _ of openRouterStream("chat", sneaky, {
        signal: new AbortController().signal,
        onActivity: noop,
        end: end(),
      })) {
        void _;
      }
    });
    expect(sent[0]?.body.provider).toEqual({
      order: ["anthropic"],
      require_parameters: true,
    });
    expect(sent[0]?.body.usage).toEqual({ include: true });
    expect(sent[0]?.body.stream_options).toEqual({ include_usage: true });
  });

  it("attributes every call, so OpenRouter's dashboard is not a view of half the app", async () => {
    const { sent } = await drain(() =>
      streamed(USAGE_CHUNK, "data: [DONE]\n\n"),
    );
    expect(sent[0]?.headers["X-Title"]).toBe("Spideryarn");
    expect(sent[0]?.headers.Authorization).toBe("Bearer sk-test-key");
  });

  it("sends nothing at all until somebody iterates", async () => {
    /* Laziness is what makes the lifecycle one frame. If the request left on
       construction, a caller could build the generator and drop it. */
    const sent = stubTransport(() => streamed("data: [DONE]\n\n"));
    const gen = openRouterStream(
      "chat",
      { model: "m", messages: [] },
      { signal: new AbortController().signal, onActivity: noop, end: end() },
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(sent).toHaveLength(0);
    await gen.next();
    expect(sent).toHaveLength(1);
  });
});

describe("the routing table", () => {
  it("agrees with AI_JOB_WIRE about which endpoint each job speaks to", () => {
    /* The two are separate because deriving one from the other would need a
       value import and would close a module cycle — src/ai-call.ts says so at
       the import. Separate facts get checked rather than trusted. */
    for (const [job, route] of Object.entries(AI_JOB_ROUTE)) {
      const wire = AI_JOB_WIRE[job as keyof typeof AI_JOB_WIRE];
      expect(route.path, job).toBe(
        wire === "embeddings" ? "/v1/embeddings" : "/v1/chat/completions",
      );
    }
  });

  it("covers every job that is not a pipeline stage, and no others", () => {
    const chatJobs = Object.entries(AI_JOB_WIRE)
      .filter(([, wire]) => wire !== "messages")
      .map(([job]) => job)
      .sort();
    expect(Object.keys(AI_JOB_ROUTE).sort()).toEqual(chatJobs);
  });

  it("sends each job's own policy on the wire, not just chat's", async () => {
    /* **Comparing the table against itself proves nothing**, which is what the
       first version of this block did — coordinated wrong values pass, and only
       `chat` was ever checked against a real outgoing request. Raised by a GPT
       Sol review. This asserts the bytes, per job. */
    for (const job of ["chat", "explain", "search", "dictation", "pdf"] as const) {
      const sent = stubTransport(() => streamed(USAGE_CHUNK, "data: [DONE]\n\n"));
      await collectSpend(async () => {
        for await (const _ of openRouterStream(
          job,
          { model: "m", messages: [] },
          { signal: new AbortController().signal, onActivity: noop, end: end() },
        )) {
          void _;
        }
      });
      expect(sent[0]?.body.provider, job).toEqual(AI_JOB_ROUTE[job].provider);
      /* Spelled out rather than read back off the table, so a wrong path in the
         table fails here instead of agreeing with itself. */
      expect(sent[0]?.url, job).toBe("https://openrouter.ai/api/v1/chat/completions");
    }
  });

  it("does not pin Anthropic on the three jobs that are not Anthropic's", () => {
    /* The bug this prevents is silent: `order: ["anthropic"]` on a Gemini or a
       Voyage model finds no Anthropic upstream, falls through to the real one,
       and answers. The pin does nothing while looking like it did something. */
    for (const job of ["dictation", "embeddings", "pdf"] as const) {
      expect(AI_JOB_ROUTE[job].provider.order, job).toBeUndefined();
    }
    expect(AI_JOB_ROUTE.dictation.provider.zdr).toBe(true);
    expect(AI_JOB_ROUTE.pdf.provider.allow_fallbacks).toBe(false);
  });

  it("refuses to route a pipeline stage down this wire", () => {
    expect(() => pathFor("labels" as never)).toThrow(/pipeline stage/);
  });
});

describe("one record per call, however the call ends", () => {
  it("records the cost that was on the wire", async () => {
    const { report } = await drain(() =>
      streamed(USAGE_CHUNK, "data: [DONE]\n\n"),
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.job).toBe("chat");
    expect(report.calls[0]?.costNanos).toBe(68_000);
    expect(report.calls[0]?.upstreamCostNanos).toBe(68_000);
    expect(report.calls[0]?.isByok).toBe(false);
    expect(report.calls[0]?.inputTokens).toBe(14);
    expect(report.calls[0]?.generationId).toBe("gen-test-1");
    expect(report.calls[0]?.outcome).toBe("ok");
    expect(report.pending).toHaveLength(0);
  });

  it("records the model that answered, not only the one we asked for", async () => {
    const { report } = await drain(() =>
      streamed(
        frame({ model: "anthropic/claude-sonnet-5-2026", choices: [] }),
        USAGE_CHUNK,
      ),
    );
    expect(report.calls[0]?.model).toBe("anthropic/claude-sonnet-5");
    expect(report.calls[0]?.answeredBy).toBe("anthropic/claude-sonnet-5-2026");
  });

  it("records a refusal — the call happened and the meter must not be left open", async () => {
    /* **The hole the whole shape exists to close.** With the fetch and the
       metering as two things a caller holds, this is the path where the caller
       throws in between and the money vanishes. */
    const { report } = await collectSpend(async () => {
      stubTransport(
        () =>
          ({
            ok: false,
            status: 429,
            headers: new Headers({
              "retry-after": "3",
              "x-generation-id": "gen-refused",
            }),
            text: async () => "slow down",
          }) as unknown as Response,
      );
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            {
              signal: new AbortController().signal,
              onActivity: noop,
              end: end(),
            },
          )) {
            void _;
          }
        })(),
      ).rejects.toBeInstanceOf(ProviderRefused);
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
    expect(report.calls[0]?.costNanos).toBeNull();
    /* The one handle on a call that produced no usage object at all. */
    expect(report.calls[0]?.generationId).toBe("gen-refused");
    expect(report.pending).toHaveLength(0);
  });

  it("records a fetch that never connected", async () => {
    const { report } = await collectSpend(async () => {
      vi.stubGlobal("fetch", async () => {
        throw new TypeError("fetch failed");
      });
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            {
              signal: new AbortController().signal,
              onActivity: noop,
              end: end(),
            },
          )) {
            void _;
          }
        })(),
      ).rejects.toThrow(/fetch failed/);
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
  });

  it("records a stream that died mid-answer, keeping the cost it had already seen", async () => {
    /* A lower bound rather than nothing: if the usage chunk arrived and the
       connection then broke, that figure is real, and a row saying "at least
       this much" beats a row saying nothing.

       **The enqueue and the throw are two separate pulls, and the first draft
       had them in one.** A stream that errors discards whatever is still queued,
       so enqueueing and throwing in the same `pull` delivers nothing at all —
       the test then proved the opposite of what it claimed and I would have
       "fixed" working code to satisfy it. */
    const { report } = await collectSpend(async () => {
      let pulls = 0;
      stubTransport(
        () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              pull(c) {
                if (pulls++ === 0) {
                  c.enqueue(new TextEncoder().encode(USAGE_CHUNK));
                  return;
                }
                throw new Error("the connection went away");
              },
            }),
          }) as unknown as Response,
      );
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            {
              signal: new AbortController().signal,
              onActivity: noop,
              end: end(),
            },
          )) {
            void _;
          }
        })(),
      ).rejects.toThrow(/connection went away/);
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
    expect(report.calls[0]?.costNanos).toBe(68_000);
  });

  it("records a consumer that broke out early", async () => {
    /* A `break` from a `for await` runs the generator's `finally` — which is
       exactly why the recording lives there and not after the loop. */
    const { report } = await collectSpend(async () => {
      stubTransport(() =>
        streamed(
          frame({ choices: [{ delta: { content: "one" } }] }),
          USAGE_CHUNK,
        ),
      );
      for await (const _ of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: new AbortController().signal, onActivity: noop, end: end() },
      )) {
        void _;
        break;
      }
    });
    expect(report.calls).toHaveLength(1);
    expect(report.pending).toHaveLength(0);
  });

  it("records a consumer that threw as abandoned, not as a clean success", async () => {
    /* **The subtlety, and the reason the previous version of this test proved
       nothing.** A throw inside a `for await` closes the generator through its
       `return()`, which runs the `finally` and **not** the `catch` — so the
       outcome stayed `"ok"` and a turn that blew up on `chunk.error` was
       recorded as a successful call. The old assertion checked only that one
       record came out, which was true of the broken code too. Found by a GPT
       Sol review of the code. */
    const { report } = await collectSpend(async () => {
      stubTransport(() =>
        streamed(frame({ choices: [{ delta: { content: "one" } }] })),
      );
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            {
              signal: new AbortController().signal,
              onActivity: noop,
              end: end(),
            },
          )) {
            void _;
            throw new Error("the caller gave up");
          }
        })(),
      ).rejects.toThrow(/caller gave up/);
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("aborted");
  });

  it("records a consumer that broke out early as abandoned too", async () => {
    /* Indistinguishable from the throw above, from inside the generator: the
       iteration protocol hands us the same `return()`. Both are *this call did
       not run to completion*, which is weaker than the truth and not wrong. */
    const { report } = await collectSpend(async () => {
      stubTransport(() =>
        streamed(frame({ choices: [{ delta: { content: "one" } }] }), USAGE_CHUNK),
      );
      for await (const _ of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: new AbortController().signal, onActivity: noop, end: end() },
      )) {
        void _;
        break;
      }
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("aborted");
  });

  it("does not call a provider failure a cancel merely because a signal fired", async () => {
    /* **The distinction the ledger made expensive.** Any error raised while the
       signal happened to be aborted used to be recorded as `"aborted"` — and a
       provider dying at the moment a reader presses Stop is not far-fetched, a
       stall on their side being exactly what makes somebody press it. A cancel
       is the outcome nobody investigates, so the one event that could explain
       what went wrong went into the bin marked "the reader did that".

       Aborting rejects with the signal's own reason, so identity is the test.
       Here the signal is aborted *and* the failure is something else. Raised by
       a GPT Sol review of the code. */
    const controller = new AbortController();
    const { report } = await collectSpend(async () => {
      stubTransport(() => {
        controller.abort();
        throw new Error("the upstream fell over");
      });
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            { signal: controller.signal, onActivity: noop, end: end() },
          ))
            void _;
        })(),
      ).rejects.toThrow("the upstream fell over");
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
  });

  it("still calls a real abort a cancel, which is the other half of that", async () => {
    /* The rule has to keep working in the direction it was already right about,
       or "never say aborted" would pass the test above. */
    const controller = new AbortController();
    const { report } = await collectSpend(async () => {
      stubTransport(() => {
        controller.abort();
        throw controller.signal.reason;
      });
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            { signal: controller.signal, onActivity: noop, end: end() },
          ))
            void _;
        })(),
      ).rejects.toThrow();
    });
    expect(report.calls[0]?.outcome).toBe("aborted");
  });

  it("records a stream that stopped without saying it had finished as an error", async () => {
    /* `[DONE]` is the only clean end there is, and every caller already treats
       its absence as a failure. Recording it as `"ok"` made the spend row and
       the feature's own verdict disagree about the same event. */
    const { report } = await collectSpend(async () => {
      stubTransport(() => streamed(USAGE_CHUNK));
      for await (const _ of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: new AbortController().signal, onActivity: noop, end: end() },
      )) {
        void _;
      }
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
    /* The cost it did report is kept: the money went either way. */
    expect(report.calls[0]?.costNanos).toBe(68_000);
  });

  it("writes no record at all when there was no attempt to record", async () => {
    /* The inverse of *one record, one call*. A missing key fails before a
       request exists, and a row for a call that never left the process is a
       phantom in the bill. Every caller happens to check its own key first,
       which is why nothing caught this. */
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const sent = stubTransport(() => streamed("data: [DONE]\n\n"));
    const { report } = await collectSpend(async () => {
      await expect(
        (async () => {
          for await (const _ of openRouterStream(
            "chat",
            { model: "m", messages: [] },
            { signal: new AbortController().signal, onActivity: noop, end: end() },
          )) {
            void _;
          }
        })(),
      ).rejects.toThrow(/ai-not-set-up/);
    });
    expect(sent).toHaveLength(0);
    expect(report.calls).toHaveLength(0);
    expect(report.pending).toHaveLength(0);
  });

  it("calls an abort an abort even when the loop ends cleanly", async () => {
    /* **The race the whole `finally` clause is written for**, and the test that
       found I had it right: `sseChunks` cancels the reader when the signal
       fires, and a cancelled read resolves `{done: true}` rather than throwing.
       So this loop **exits normally, with no error at all** — the first draft of
       this test asserted a rejection and was simply wrong about the mechanism.

       Which is precisely why the outcome cannot be decided in the `catch`: on
       this path there is no catch. Delete the `if (outcome === "ok" &&
       signal.aborted)` line and a reader's disconnect is billed as a clean
       success, which is the reading a spend limit would be built on. */
    const controller = new AbortController();
    const { report } = await collectSpend(async () => {
      stubTransport(
        () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => {});
              },
            }),
          }) as unknown as Response,
      );
      setTimeout(() => controller.abort(new Error("stopped")), 5);
      for await (const _ of openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: controller.signal, onActivity: noop, end: end() },
      )) {
        void _;
      }
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("aborted");
  });

  it("still records a call whose stream carried no usage at all", async () => {
    /* The failure `usage: {include: true}` exists to prevent. Recorded with a
       null cost and counted as unpriced, never as free. */
    const { report } = await drain(() =>
      streamed(
        frame({ choices: [{ delta: { content: "hi" } }] }),
        "data: [DONE]\n\n",
      ),
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.costNanos).toBeNull();
  });

  it("records a call per round, because a turn that ran three bought three", async () => {
    const { report } = await collectSpend(async () => {
      stubTransport(() => streamed(USAGE_CHUNK, "data: [DONE]\n\n"));
      for (let round = 0; round < 3; round++) {
        for await (const _ of openRouterStream(
          "chat",
          { model: "m", messages: [] },
          {
            signal: new AbortController().signal,
            onActivity: noop,
            end: end(),
          },
        )) {
          void _;
        }
      }
    });
    expect(report.calls).toHaveLength(3);
    expect(report.calls.every((c) => c.costNanos === 68_000)).toBe(true);
  });
});

describe("the non-streamed half", () => {
  function stubJson(
    status: number,
    body: string,
    headers: Record<string, string> = {},
  ) {
    return stubTransport(
      () =>
        ({
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(headers),
          text: async () => body,
        }) as unknown as Response,
    );
  }

  it("records the call and hands back the parsed body", async () => {
    const { result, report } = await collectSpend(async () => {
      stubJson(
        200,
        JSON.stringify({
          model: "google/gemini-3.1-flash-lite",
          usage: { cost: 0.5 },
        }),
      );
      return openRouterJson("dictation", {
        model: "google/gemini-3.1-flash-lite",
      });
    });
    expect((result.json as { model: string }).model).toBe(
      "google/gemini-3.1-flash-lite",
    );
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.job).toBe("dictation");
    expect(report.calls[0]?.costNanos).toBe(500_000_000);
  });

  it("hands back null rather than the provider's words when the body is not JSON", async () => {
    /* V8 puts the first characters of the offending input into a
       `SyntaxError`'s message, so rethrowing a parse failure publishes a prefix
       of whatever the provider sent — which on a mangled response can be a
       prefix of what we sent it, and what we sent is a reader's voice. */
    const { result } = await collectSpend(async () => {
      stubJson(200, "SECRET article prose, not JSON");
      return openRouterJson("dictation", { model: "m" });
    });
    expect(result.json).toBeNull();
  });

  it("throws the status and the retry delay, and nothing the provider wrote", async () => {
    const { report } = await collectSpend(async () => {
      stubJson(429, "you are sending us a reader's whole article back", {
        "retry-after": "7",
      });
      const err = await openRouterJson("embeddings", { model: "m" }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ProviderRefused);
      const refused = err as ProviderRefused;
      expect(refused.status).toBe(429);
      expect(refused.retryAfterMs).toBe(7000);
      expect(refused.kind).toBeNull();
      expect(JSON.stringify(refused)).not.toContain("reader's whole article");
      expect(refused.message).not.toContain("reader's whole article");
    });
    expect(report.calls).toHaveLength(1);
    expect(report.calls[0]?.outcome).toBe("error");
  });

  it("classifies the 404 that is an account setting, without carrying the sentence", async () => {
    const err = await collectSpend(async () =>
      (() => {
        stubJson(
          404,
          "No endpoints available matching your guardrail restrictions",
        );
        return openRouterJson("embeddings", { model: "m" }).catch(
          (e: unknown) => e,
        );
      })(),
    );
    const refused = err.result as ProviderRefused;
    expect(refused.kind).toBe("no-endpoints");
    expect(refused.message).not.toContain("guardrail");
  });

  it("uses an explicit key when one is passed, so a caller keeps its own", async () => {
    const sent = stubJson(200, "{}");
    await collectSpend(async () =>
      openRouterJson(
        "embeddings",
        { model: "m" },
        { apiKey: "sk-somebody-elses" },
      ),
    );
    expect(sent[0]?.headers.Authorization).toBe("Bearer sk-somebody-elses");
  });
});

describe("a call that is never finished", () => {
  it("is reported as pending rather than simply missing", async () => {
    /* The one failure this design can still have: a request that goes out and is
       dropped. Simulated by aborting the collector's scope around a generator
       nobody drains — the meter registers on the first `next()` and there is no
       `finally` to reach if nothing iterates further. */
    const { report } = await collectSpend(async () => {
      stubTransport(
        () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers(),
            body: new ReadableStream<Uint8Array>({
              pull() {
                return new Promise<void>(() => {});
              },
            }),
          }) as unknown as Response,
      );
      const gen = openRouterStream(
        "chat",
        { model: "m", messages: [] },
        { signal: new AbortController().signal, onActivity: noop, end: end() },
      );
      /* Started and abandoned. `next()` is not awaited: awaiting it would hang
         on the body that never yields, which is the shape of the real bug. */
      void gen.next();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(report.calls).toHaveLength(0);
    expect(report.pending).toHaveLength(1);
    expect(report.pending[0]?.job).toBe("chat");
  });
});

describe("nothing else may talk to OpenRouter", () => {
  /**
   * The backstop, not the guarantee — the lifecycle is what makes metering
   * unforgettable, and this is what makes the lifecycle unavoidable.
   *
   * Comments are stripped first: every one of these strings appears in prose in
   * this repo, at length, and a scan that matched them would be a scan that
   * could only ever pass by accident.
   */
  const SRC = join(process.cwd(), "src");

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...sourceFiles(full));
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))
        out.push(full);
    }
    return out;
  }

  function code(file: string): string {
    return readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/^\s*\*.*$/gm, "");
  }

  it("is the only file that names an OpenRouter endpoint", () => {
    const offenders = sourceFiles(SRC)
      .filter(
        (f) => !f.endsWith("ai-call.ts") && !f.endsWith("messages-stream.ts"),
      )
      .filter((f) => code(f).includes("openrouter.ai/api"));
    expect(offenders.map((f) => f.replace(process.cwd(), ""))).toEqual([]);
  });

  it("proves that scan can fail, using the scanner itself", () => {
    /* **The previous version of this test exercised none of the code above.**
       It filtered a one-line array literal and asserted the length — a check
       that stays green while `code()` strips too much, `sourceFiles()` walks
       the wrong tree, or the whole scan quietly matches nothing. Which is
       precisely the vacuous green this repo keeps a document about, written
       into the test whose job was to rule it out. Found by a GPT Sol review.

       So this runs the real `code()` and the real predicate against a real file
       on disk — src/ai-call.ts, the one file that is *allowed* to name the
       endpoint — and asserts it is caught. If the scanner ever stops seeing
       anything, this goes red before the exemption list does. */
    const gateway = join(SRC, "ai-call.ts");
    expect(code(gateway)).toContain("openrouter.ai/api");
    /* And that the stripping is real: the endpoint survives it because it is in
       a string literal, while a mention in a comment does not. */
    expect(code(gateway)).not.toContain("Anthropic Skin");
  });
});
