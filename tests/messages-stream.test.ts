/**
 * The metering seam in [`src/messages-stream.ts`](../src/messages-stream.ts).
 *
 * **What this file is really for is one assertion:** that a `message_delta`
 * arriving *without* a `cost` leaves `costNanos` at `null` rather than `0`. That
 * is the shape the whole migration to OpenRouter's Anthropic Skin rests on, and
 * it is the shape that cannot be caught by looking at a working system — a
 * dropped `cost` produces a perfectly good article, a perfectly good log line,
 * and a cost column that quietly reads as free. See
 * [silent-success.md](../docs/reusable/silent-success.md).
 *
 * The event fixtures below are **verbatim from live calls** on 2026-08-27, not
 * hand-written to match the code. If OpenRouter moves the field, these are the
 * record of where it used to be.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectSpend, totalSpend } from "../src/ai-spend.js";
import { CAPABLE_MODEL, modelFor } from "../src/models.js";
import {
  MESSAGES_PROVIDER,
  messagesClient,
  streamMessage,
  wasRefused,
} from "../src/messages-stream.js";

/* Captured from a live streamed call through https://openrouter.ai/api/v1/messages,
   2026-08-27. Trimmed only of the content blocks. */
const MESSAGE_START = {
  type: "message_start",
  message: {
    id: "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
    type: "message",
    role: "assistant",
    model: "anthropic/claude-sonnet-5",
    stop_reason: null,
    stop_details: null,
    usage: { input_tokens: 13, output_tokens: 4, cache_creation_input_tokens: 8583, cache_read_input_tokens: 0 },
    provider: "Claude Platform on AWS",
  },
};

const MESSAGE_DELTA = {
  type: "message_delta",
  delta: { stop_reason: "end_turn", stop_details: null, stop_sequence: null },
  usage: {
    input_tokens: 13,
    output_tokens: 4,
    output_tokens_details: { thinking_tokens: 0 },
    cache_creation_input_tokens: 8583,
    cache_read_input_tokens: 0,
    cache_creation: { ephemeral_5m_input_tokens: 8583, ephemeral_1h_input_tokens: 0 },
    service_tier: "standard",
    speed: "standard",
    cost: 0.0215235,
    is_byok: false,
    cost_details: { upstream_inference_cost: 0.0215235 },
  },
};

describe("MESSAGES_PROVIDER", () => {
  /* These three are pinned because each one fails *silently* if it changes —
     see the header of src/messages-stream.ts. A diff that flips one should have
     to say so here in words. */
  it("prefers Anthropic, so repeat calls land where the cache already is", () => {
    expect(MESSAGES_PROVIDER.order).toEqual(["anthropic"]);
  });

  it("allows fallback, so an Anthropic outage is not a hard failure", () => {
    expect(MESSAGES_PROVIDER.allow_fallbacks).toBe(true);
  });

  it("requires parameters, so no fallback may serve the call without caching or thinking", () => {
    /* OpenRouter's default is false. Left at the default, an upstream that
       cannot honour `cache_control` is still offered the request and answers it
       at full price, successfully. */
    expect(MESSAGES_PROVIDER.require_parameters).toBe(true);
  });
});

describe("messagesClient", () => {
  /* Explicitly, because vite.config.ts's loadEnvLocal() puts the real
     .env.local into vitest's process.env — so a test that merely *deletes* a
     key passes on this laptop and fails nowhere else. */
  const saved = process.env.OPENROUTER_API_KEY;
  beforeEach(() => { process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key"; });
  afterEach(() => {
    if (saved === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved;
  });

  it("points the Anthropic SDK at OpenRouter, not at api.anthropic.com", () => {
    /* The literal, because the constant is private now — and because a test
       comparing a value with its own source proves nothing either way. */
    expect(messagesClient().baseURL).toBe("https://openrouter.ai/api");
    expect(messagesClient().baseURL).not.toContain("anthropic.com");
  });

  it("sends the key as a bearer token, which is what OpenRouter reads", () => {
    /* The SDK puts `apiKey` in Anthropic's `x-api-key` header and `authToken`
       in `Authorization: Bearer`. Only the second reaches OpenRouter as
       credentials; getting this wrong is a 401 on every pipeline call. */
    const client = messagesClient();
    expect(client.authToken).toBe("sk-or-test-not-a-real-key");
  });

  it("refuses without a key, in words a reader may see", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { NOT_CONFIGURED } = await import("../src/messages.js");
    /* Not the SDK's own error, which names an environment variable — an
       instruction for whoever runs this app, not for whoever is reading. */
    expect(() => messagesClient()).toThrow(NOT_CONFIGURED.message);
  });
});

/* ===================================================================== the lifecycle
   Everything above tests the *pieces*. A GPT Sol review pointed out that every
   one of them stays green if the recording is deleted outright: nothing was
   driving `streamMessage`, so the wrapper could stop recording, the stages could
   go back to the unmetered `call.stream.finalMessage()`, and the provider
   injection could vanish, with 11 passing tests either way.

   These drive the real function against a stubbed transport. They are the only
   thing standing between "the cost is recorded" and "the cost appears to be
   recorded". */

/** One SSE frame in the shape the SDK's parser expects. */
const sse = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

/**
 * A complete streamed response, ending in the `message_delta` that carries the
 * cost. `usage` overrides let a test remove or corrupt exactly one field.
 */
function cannedStream(usage: Record<string, unknown> = {}): string {
  return (
    sse("message_start", { type: "message_start", message: { ...MESSAGE_START.message, content: [] } }) +
    sse("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }) +
    sse("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "ok" },
    }) +
    sse("content_block_stop", { type: "content_block_stop", index: 0 }) +
    sse("message_delta", { ...MESSAGE_DELTA, usage: { ...MESSAGE_DELTA.usage, ...usage } }) +
    sse("message_stop", { type: "message_stop" })
  );
}

/** Swap in a `fetch` that replays `body`, and keep the request it was given. */
function stubTransport(body: string | { fail: true }) {
  const seenRequests: { url: string; body: Record<string, unknown> }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
    seenRequests.push({
      url: String((input as { url?: string })?.url ?? input),
      body: JSON.parse(init?.body ?? "{}"),
    });
    if (typeof body !== "string") throw new Error("upstream exploded");
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof globalThis.fetch;
  return { seenRequests, restore: () => { globalThis.fetch = original; } };
}

const A_BODY = {
  max_tokens: 16,
  messages: [{ role: "user" as const, content: "irrelevant" }],
};

/** Drive one whole call and hand back the single row it recorded. */
async function recordOne(usage: Record<string, unknown> = {}) {
  const t = stubTransport(cannedStream(usage));
  try {
    const { report } = await collectSpend(async () => {
      await streamMessage("toc", A_BODY).finalMessage();
    });
    expect(report.calls).toHaveLength(1);
    return report.calls[0]!;
  } finally {
    t.restore();
  }
}

describe("streamMessage — the recording lifecycle", () => {
  const savedKey = process.env.OPENROUTER_API_KEY;
  beforeEach(() => { process.env.OPENROUTER_API_KEY = "sk-or-test-not-a-real-key"; });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("records exactly one call, with the cost that was on the wire", async () => {
    const t = stubTransport(cannedStream());
    try {
      const { report } = await collectSpend(async () => {
        const call = streamMessage("toc", A_BODY);
        await call.finalMessage();
      });

      expect(report.calls).toHaveLength(1);
      expect(report.calls[0]?.job).toBe("toc");
      expect(report.calls[0]?.costNanos).toBe(21_523_500);
      expect(report.calls[0]?.outcome).toBe("ok");
      expect(report.calls[0]?.upstream).toBe("Claude Platform on AWS");
      expect(report.calls[0]?.generationId).toBe(
        "gen-1787844432-JKwGQebcNXfkCfTX5mUq",
      );
      /* Tokens come off the SDK's merged message, cost off the raw event. Both
         have to survive, or the row can say what it did without what it cost. */
      expect(report.calls[0]?.cacheWriteTokens).toBe(8583);
    } finally {
      t.restore();
    }
  });

  it("pins the provider on the outgoing request, which nothing else checks", async () => {
    /* The failure this prevents is invisible: unpinned, the call succeeds, the
       article is fine, and the cache is never read again. */
    const t = stubTransport(cannedStream());
    try {
      await streamMessage("toc", A_BODY).finalMessage();
      expect(t.seenRequests).toHaveLength(1);
      expect(t.seenRequests[0]?.body.provider).toEqual({
        order: ["anthropic"],
        allow_fallbacks: true,
        require_parameters: true,
      });
      expect(t.seenRequests[0]?.url).toContain("openrouter.ai");
    } finally {
      t.restore();
    }
  });

  it("puts the task's own model on the wire, which no stage can now get wrong", async () => {
    /* Until a GPT Sol review, each stage passed its own `model:`. A stage
       switched back to the unprefixed `CAPABLE_MODEL` would 404 on every call
       and `tests/models.test.ts` would stay green, because it only asked
       `modelFor()` what it *would* return — never what was sent. */
    const t = stubTransport(cannedStream());
    try {
      for (const task of ["toc", "arc", "labels", "quotes", "glossary", "ideas", "tweets"] as const) {
        await streamMessage(task, { max_tokens: 16, messages: A_BODY.messages }).finalMessage();
      }
      const sent = t.seenRequests.map((r) => r.body.model);
      expect(sent).toEqual(sent.map((_, i) => modelFor(
        (["toc", "arc", "labels", "quotes", "glossary", "ideas", "tweets"] as const)[i]!,
      )));
      /* And specifically: the prefixed spelling, never the artefact stamp. */
      for (const m of sent) {
        expect(m).toBe("anthropic/claude-sonnet-5");
        expect(m).not.toBe(CAPABLE_MODEL);
      }
    } finally {
      t.restore();
    }
  });

  it("overrides a caller's provider and model rather than honouring them", async () => {
    /* **This test used to assert the opposite** — that an override worked, "so
       the injection is not a wall". A GPT Sol review pointed out what that
       allowed once the numbers reached a ledger: a caller could drop the cache
       pin, which does not fail, it just costs several times more, and could send
       a model the row would then misattribute the money to.

       Both fields are typed `never` now, so this is a cast rather than something
       anybody could write by accident — and the cast is exactly the shape of a
       body assembled at run time out of something the type system never saw,
       which is what the overwrite-after-spread is for. */
    const t = stubTransport(cannedStream());
    try {
      await streamMessage("toc", {
        ...A_BODY,
        provider: { order: ["something-else"] },
        model: "openai/gpt-4o",
      } as unknown as typeof A_BODY).finalMessage();
      const sent = t.seenRequests[0]?.body;
      expect((sent?.provider as { order?: string[] })?.order).toEqual(["anthropic"]);
      expect(sent?.model).toBe(modelFor("toc"));
    } finally {
      t.restore();
    }
  });

  /* ============================================ what came off the wire ====
     These used to drive `meterStream` directly, which is private now — a caller
     holding a meter is a caller that can decline to finish it, and that mattered
     more once the numbers became rows. They assert the same facts through the
     only door there is. */

  it("takes the cost off the wire, where finalMessage() would have dropped it", async () => {
    const row = await recordOne();
    /* Nano-dollars, per src/pricing.ts — an integer, so no float drift in a sum. */
    expect(row.costNanos).toBe(21_523_500);
    expect(row.upstreamCostNanos).toBe(21_523_500);
    expect(row.isByok).toBe(false);
  });

  it("leaves cost NULL, not zero, when the field stops arriving", async () => {
    /* **The one assertion this file is really for.** A dropped `cost` produces a
       perfectly good article, a perfectly good log line, and a cost column that
       quietly reads as free. `null` is a thing a report can count and complain
       about; `0` is indistinguishable from a free call. */
    const row = await recordOne({ cost: undefined, cost_details: undefined });
    expect(row.costNanos).toBeNull();
    expect(row.costNanos).not.toBe(0);
  });

  it("refuses a cost that is not a finite number rather than coercing it", async () => {
    for (const bad of [null, "0.02", Number.NaN, -1]) {
      const row = await recordOne({ cost: bad, cost_details: undefined });
      expect(row.costNanos, `cost: ${String(bad)}`).toBeNull();
    }
  });

  it("keeps the pricing inputs a token count cannot supply", async () => {
    /* Each of these changes what a call is *worth* rather than what it did: the
       two cache TTLs are priced at 1.25x and 2x, batch is half price, and a US
       geo is a documented 1.1x. A ledger without them can record the tokens
       exactly and still be unable to say whether its own total is right. */
    const row = await recordOne();
    expect(row.cacheWrite5mTokens).toBe(8583);
    expect(row.cacheWrite1hTokens).toBe(0);
    expect(row.serviceTier).toBe("standard");
    expect(row.reasoningTokens).toBe(0);
    expect(row.wire).toBe("messages");
  });

  it("names the key that paid, and never carries it", async () => {
    const row = await recordOne();
    const { keyFingerprint } = await import("../src/ai-spend.js");
    expect(row.credentialFingerprint).toBe(keyFingerprint("sk-or-test-not-a-real-key"));
    expect(row.credentialFingerprint).not.toContain("sk-or");
    expect(row.credentialFingerprint).toHaveLength(12);
  });

  it("records once, not twice, when finalMessage is awaited again", async () => {
    /* `finalMessage()` is idempotent on the SDK's side, so awaiting it twice is
       legal — and used to append a second row. Double-counting is worse than
       undercounting: it is wrong in the direction that looks like the answer. */
    const t = stubTransport(cannedStream());
    try {
      const { report } = await collectSpend(async () => {
        const call = streamMessage("arc", A_BODY);
        const first = await call.finalMessage();
        const second = await call.finalMessage();
        expect(second).toBe(first);
      });
      expect(report.calls).toHaveLength(1);
    } finally {
      t.restore();
    }
  });

  it("still records a call whose stream never carried a cost", async () => {
    const t = stubTransport(cannedStream({ cost: undefined }));
    try {
      const { report } = await collectSpend(async () => {
        await streamMessage("labels", A_BODY).finalMessage();
      });
      /* The row exists and admits it does not know — rather than not existing,
         which is a hole in the bill that nothing points at. */
      expect(report.calls).toHaveLength(1);
      expect(report.calls[0]?.costNanos).toBeNull();
      expect(totalSpend(report.calls).unpriced).toBe(1);
    } finally {
      t.restore();
    }
  });

  it("records a failed call as an error rather than losing it", async () => {
    const t = stubTransport({ fail: true });
    try {
      const { report } = await collectSpend(async () => {
        await expect(
          streamMessage("ideas", A_BODY).finalMessage(),
        ).rejects.toThrow();
      });
      expect(report.calls).toHaveLength(1);
      expect(report.calls[0]?.outcome).toBe("error");
    } finally {
      t.restore();
    }
  });

  it("calls the transport once per streamMessage, so a record is one real call", async () => {
    const t = stubTransport(cannedStream());
    try {
      const { report } = await collectSpend(async () => {
        await streamMessage("toc", A_BODY).finalMessage();
        await streamMessage("arc", A_BODY).finalMessage();
      });
      expect(t.seenRequests).toHaveLength(2);
      expect(report.calls.map((c) => c.job)).toEqual(["toc", "arc"]);
    } finally {
      t.restore();
    }
  });

  it("keeps concurrent calls' meters apart", async () => {
    /* labels.ts fans out. If the meters shared state, two calls would report
       each other's cost and the total would still look plausible. */
    const t = stubTransport(cannedStream());
    try {
      const { report } = await collectSpend(async () => {
        await Promise.all([
          streamMessage("labels", A_BODY).finalMessage(),
          streamMessage("labels", A_BODY).finalMessage(),
          streamMessage("labels", A_BODY).finalMessage(),
        ]);
      });
      expect(report.calls).toHaveLength(3);
      for (const c of report.calls) expect(c.costNanos).toBe(21_523_500);
      expect(totalSpend(report.calls).nanos).toBe(3 * 21_523_500);
    } finally {
      t.restore();
    }
  });
});

describe("the gateway is the only way to Anthropic's SDK", () => {
  /**
   * A source scan, not a behavioural test, and the only kind that can catch this.
   *
   * Every mutation in the block above is caught by driving `streamMessage`. The
   * one that is not is a *new* call site that never goes through it — a stage
   * added next month that builds its own `new Anthropic(…)`, or one of the seven
   * quietly reverting to `call.stream.finalMessage()`. Both produce a working
   * article, a real bill, and no row. Nothing behavioural can notice code that
   * was never asked to run.
   *
   * Raised by a GPT Sol review, which put it plainly: bypassing the wrapper
   * "invokes no recorder at all, so it increments nothing" — the two failures
   * look identical from outside and only one of them is counted.
   */
  const SRC = new URL("../src/", import.meta.url);

  /** Every `.ts`/`.tsx` under `src/`, with comments and strings left in — see below. */
  async function sourceFiles(dir: URL): Promise<{ path: string; text: string }[]> {
    const { readdir, readFile } = await import("node:fs/promises");
    const out: { path: string; text: string }[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) out.push(...(await sourceFiles(child)));
      else if (/\.tsx?$/.test(entry.name)) {
        out.push({ path: entry.name, text: await readFile(child, "utf8") });
      }
    }
    return out;
  }

  /* Comment lines are stripped before matching, so that the several files whose
     comments *discuss* `call.stream.finalMessage()` — deliberately, as a warning
     — do not read as violations. A blunter matcher would go red on the
     documentation written to prevent the very thing it is checking for. */
  const code = (text: string) =>
    text
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
      .join("\n");

  it("is the only file that constructs an Anthropic client", async () => {
    const offenders = (await sourceFiles(SRC))
      .filter((f) => f.path !== "messages-stream.ts")
      .filter((f) => /new Anthropic\s*\(/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("is the only file that opens a message stream", async () => {
    const offenders = (await sourceFiles(SRC))
      .filter((f) => f.path !== "messages-stream.ts")
      .filter((f) => /\.messages\s*\.\s*(stream|create)\s*\(/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("has no stage awaiting the unmetered stream.finalMessage()", async () => {
    /* The exact bypass: legal, works, records nothing. */
    const offenders = (await sourceFiles(SRC))
      .filter((f) => f.path !== "messages-stream.ts")
      .filter((f) => /\.stream\s*\.\s*finalMessage\s*\(/.test(code(f.text)))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});

describe("wasRefused", () => {
  /* Two shapes, because OpenRouter's own reference shows both and they cannot
     both be right. Accepting either is correct whichever way it gets fixed. */
  const message = (over: Record<string, unknown>) =>
    ({ stop_reason: "end_turn", stop_details: null, ...over }) as unknown as Parameters<
      typeof wasRefused
    >[0];

  it("catches Anthropic's own spelling", () => {
    expect(wasRefused(message({ stop_reason: "refusal" }))).toBe(true);
  });

  it("catches the shape OpenRouter's reference shows — end_turn with refusal details", () => {
    /* The one this was added for. If only `stop_reason` were checked, this
       returns false, and the stage parses a refusal sentence as JSON — a stage
       that repairs before giving up then buys a second call for it. Nothing
       errors and the bill goes up. */
    expect(wasRefused(message({ stop_reason: "end_turn", stop_details: { type: "refusal" } }))).toBe(
      true,
    );
  });

  it("says no to an ordinary finish", () => {
    expect(wasRefused(message({}))).toBe(false);
    expect(wasRefused(message({ stop_reason: "max_tokens" }))).toBe(false);
    expect(wasRefused(message({ stop_details: { type: "something_else" } }))).toBe(false);
  });

  it("survives the field being missing entirely", () => {
    /* The Skin is a compatibility layer; a field it does not send must read as
       "not a refusal" rather than throwing inside every stage's happy path. */
    expect(wasRefused({ stop_reason: "end_turn" } as unknown as Parameters<typeof wasRefused>[0])).toBe(
      false,
    );
  });
});
