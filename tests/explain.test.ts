/**
 * The explain request — src/explain.ts. See docs/project/comments.md.
 *
 * `fetch` is stubbed, so this is deterministic and costs nothing: what is under
 * test is the *shape* of the request we send and how we read the reply, not the
 * model's answer.
 *
 * That shape is worth pinning because getting it wrong is invisible. Both the
 * old `plugins` form and the server tool return an answer with url citations, so
 * the dialog looked right either way while the model had no say in whether it
 * searched — and the search count was read from a field that does not exist, so
 * it was always 0 and the dialog always said "no web search needed".
 * docs/reusable/silent-success.md is about exactly this.
 *
 * **These mocks are SSE, because the request is now `stream: true`.** They were
 * a single JSON body until 2026-08-26, and it matters that they moved with the
 * code: a test that mocks a response shape the server never sends is a test that
 * passes while production fails. That is not hypothetical here — it is how the
 * `server_tool_use` field name came to be wrong with a green suite. See
 * docs/plans/explain-deeper-answers.md § 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXPLAIN_TIMEOUT_MS,
  MAX_SEARCHES,
  buildExplainMessages,
  explain,
  explainStream,
} from "../src/explain.js";
import type { Block, Meta } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const blocks = [
  { id: "spya-k3m9qt", html: "<p>alpha</p>", text: "alpha" },
  { id: "spya-aaaaaa", html: "<p>beta</p>", text: "beta" },
] as Block[];

/** One SSE frame, exactly as OpenRouter writes them. */
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/**
 * A response whose body is a stream of the given raw SSE text.
 *
 * Deliberately **not** one chunk per frame: the text is split at an awkward
 * point so a `data:` line lands across two reads. `sseChunks` holds a partial
 * line over precisely for that, and a mock that always delivers whole frames
 * would never exercise it.
 */
function sse(raw: string, splitAt = 7): Response {
  const bytes = new TextEncoder().encode(raw);
  const parts = [bytes.slice(0, splitAt), bytes.slice(splitAt)].filter((p) => p.length > 0);
  let i = 0;
  return {
    ok: true,
    body: new ReadableStream<Uint8Array>({
      pull(c) {
        if (i < parts.length) c.enqueue(parts[i++] as Uint8Array);
        else c.close();
      },
    }),
  } as unknown as Response;
}

/**
 * A minimal OpenRouter success, with whatever `usage` the test wants to try.
 *
 * The usage rides on its own final chunk with an empty `choices`, which is where
 * a real streamed response puts it — that is the shape `stream_options:
 * {include_usage: true}` buys, and the reason explain.ts holds `usage` across
 * the loop rather than reading it off the chunk that had the text.
 */
function reply(usage: unknown, annotations: unknown[] = []) {
  return sse(
    frame({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ delta: { content: "Because of X.", ...(annotations.length ? { annotations } : {}) } }],
    }) +
      frame({ choices: [{ finish_reason: "stop", delta: {} }], ...(usage ? { usage } : {}) }) +
      "data: [DONE]\n\n",
  );
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

const ask = () => explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha" });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("the web search is the model's choice", () => {
  it("asks with the server tool, so the model decides whether to search", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    const body = bodyOf(fetchMock);
    expect(body.tools).toEqual([
      { type: "openrouter:web_search", parameters: { max_uses: MAX_SEARCHES, max_results: 5 } },
    ]);
  });

  it("does NOT use the `plugins` form, which searches once whatever the model wants", () => {
    // The regression this file exists for. Greg asked for model-invoked search
    // (comments.md § Decision: the model decides whether to search); the plugin
    // runs one search per request regardless, and looks identical from outside.
    fetchMock.mockResolvedValue(reply({}));
    return ask().then(() => expect(bodyOf(fetchMock).plugins).toBeUndefined());
  });
});

describe("streaming", () => {
  it("asks for usage on the stream, without which every count is silently null", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    const body = bodyOf(fetchMock);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("yields the text in pieces, then one `done` carrying the whole answer", async () => {
    fetchMock.mockResolvedValue(
      sse(
        frame({ choices: [{ delta: { content: "Because " } }] }) +
          frame({ choices: [{ delta: { content: "of X." } }] }) +
          frame({ choices: [{ finish_reason: "stop", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );
    const seen: string[] = [];
    let answer = "";
    for await (const e of explainStream({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha" })) {
      if (e.type === "delta") seen.push(e.text);
      else answer = e.answer;
    }
    expect(seen).toEqual(["Because ", "of X."]);
    expect(answer).toBe("Because of X.");
  });

  it("refuses a stream that stopped mid-answer instead of storing half of one", async () => {
    /* The silent-success shape a stream has and a single JSON body does not: a
       connection cut two paragraphs in delivers a well-formed prefix and an
       EOF, which without this check reads exactly like a finished answer. No
       `[DONE]`, no `finish_reason`. */
    fetchMock.mockResolvedValue(sse(frame({ choices: [{ delta: { content: "Because of" } }] })));
    await expect(ask()).rejects.toThrow(/stopped arriving before it was finished/);
  });

  it("accepts a `finish_reason` as a second witness when the terminator is missing", async () => {
    // A provider that reports why it stopped has told us the answer is whole.
    // Requiring both witnesses would turn such a provider into a permanent
    // failure; requiring neither is what produced the bug above.
    fetchMock.mockResolvedValue(
      sse(frame({ choices: [{ finish_reason: "stop", delta: { content: "Because of X." } }] })),
    );
    expect((await ask()).answer).toBe("Because of X.");
  });
});

describe("the reported search count", () => {
  // OpenRouter's docs and OpenRouter's responses disagree about the field name,
  // so both are read. This was found by calling the live API on 2026-08-25 and
  // printing `usage`, *after* a review confidently said the docs were right —
  // the count is 0 either way when you guess wrong, and 0 is a number a reader
  // believes. See src/explain.ts § Web research.
  it("reads the field the live API actually sends", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use_details: { web_search_requests: 2 } }));
    expect((await ask()).searches).toBe(2);
  });

  it("reads the field the docs describe, in case they ever reconcile", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use: { web_search_requests: 3 } }));
    expect((await ask()).searches).toBe(3);
  });

  it("is 0 when the model genuinely did not search", async () => {
    fetchMock.mockResolvedValue(reply({ server_tool_use_details: { web_search_requests: 0 } }));
    expect((await ask()).searches).toBe(0);
  });

  it("is 0, not undefined, when the response carries no usage at all", async () => {
    fetchMock.mockResolvedValue(reply(undefined));
    expect((await ask()).searches).toBe(0);
  });
});

describe("a deeper search, when the reader says the answer was not good enough", () => {
  it("does NOT touch the tool definition, which would invalidate every cache tier", async () => {
    /* The first draft of this feature raised `max_uses` from 4 to 8 for a deep
       call. Tools render at position 0, ahead of system and messages, and
       editing a tool definition invalidates all three tiers — so the variant
       that took pains to keep its instruction out of `SYSTEM` was throwing the
       whole cache away one field earlier. The cap is now the same for everyone.
       docs/research/prompt-caching-anthropic.md, invalidation table. */
    fetchMock.mockResolvedValue(reply({}));
    await explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha", deep: true });
    const deepTools = bodyOf(fetchMock).tools;

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    expect(deepTools).toEqual(bodyOf(fetchMock).tools);
  });

  it("leaves the cached prefix byte-identical, so it does not pay for the article twice", () => {
    /* **The expensive mistake this test exists to stop.** The cache breakpoint
       sits on the article content-part, so the cached prefix is system+article.
       Putting the deep instruction in `SYSTEM` — the obvious place — changes
       that prefix, which is a cache miss AND a second cache write of the whole
       article, on the one call in the app a reader is sitting and waiting for.
       Nothing about it is visible from outside: the answer is fine, it just
       costs more. docs/project/prompt-caching.md. */
    const plain = buildExplainMessages(meta, blocks, "spya-k3m9qt", "alpha");
    const deep = buildExplainMessages(meta, blocks, "spya-k3m9qt", "alpha", true);

    expect(deep[0]).toEqual(plain[0]); // the system message
    const parts = (m: (typeof plain)[number]) => m.content as { text: string }[];
    expect(parts(deep[1] as (typeof plain)[number])[0]).toEqual(
      parts(plain[1] as (typeof plain)[number])[0],
    ); // the article part, which carries the breakpoint

    // And the instruction really is there, after it.
    const last = parts(deep[1] as (typeof plain)[number])[1]?.text ?? "";
    expect(last).toMatch(/look properly/);
    expect(JSON.stringify(plain)).not.toMatch(/look properly/);
  });
});

describe("failures are loud", () => {
  it("gives the request a deadline, so a hung model cannot spin for ever", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await ask();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(EXPLAIN_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("explains a timeout in words, rather than passing on `AbortError`", async () => {
    // A real 20ms deadline, because `AbortSignal.timeout` runs off an internal
    // timer that fake timers do not drive — faking them here would hang.
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      // What an aborted fetch actually does: reject once the signal fires.
      return new Promise((_resolve, rejectIt) => {
        init.signal?.addEventListener("abort", () =>
          rejectIt(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
        );
      });
    });
    await expect(
      explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha", timeoutMs: 20 }),
    ).rejects.toThrow(/did not finish within/);
  });

  it("says a silence is a silence, not a slow answer", async () => {
    /* The second clock. A stream that goes quiet forever would otherwise sit
       under the overall deadline for its full ninety seconds, and be reported
       as a slow model rather than a dropped connection. */
    fetchMock.mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({ pull() {} }), // opens, then says nothing
    } as unknown as Response);
    await expect(
      explain({ meta, blocks, blockId: "spya-k3m9qt", quote: "alpha", stallMs: 20 }),
    ).rejects.toThrow(/stopped arriving after/);
  });

  it("refuses a 200 with no text rather than storing a blank answer", async () => {
    fetchMock.mockResolvedValue(
      sse(`${frame({ choices: [{ finish_reason: "length", delta: { content: "" } }] })}data: [DONE]\n\n`),
    );
    await expect(ask()).rejects.toThrow(/returned no text/);
  });

  it("surfaces an error carried inside a 200 stream", async () => {
    // A mid-generation provider failure arrives as data, not as a broken
    // connection, so nothing else in the plumbing would notice it.
    fetchMock.mockResolvedValue(sse(frame({ error: { message: "upstream exploded" } })));
    await expect(ask()).rejects.toThrow(/upstream exploded/);
  });
});

describe("citations", () => {
  it("keeps one entry per url, however many sentences it grounded", async () => {
    const cite = (url: string, title?: string) => ({ type: "url_citation", url_citation: { url, title } });
    fetchMock.mockResolvedValue(
      reply({}, [cite("https://a.test", "A"), cite("https://a.test", "A"), cite("https://b.test")]),
    );
    expect((await ask()).citations).toEqual([{ url: "https://a.test", title: "A" }, { url: "https://b.test" }]);
  });

  it("drops a citation whose URL is not http(s), where it is stored rather than where it is drawn", async () => {
    const cite = (url: string) => ({ type: "url_citation", url_citation: { url } });
    fetchMock.mockResolvedValue(reply({}, [cite("javascript:alert(1)"), cite("https://ok.test")]));
    expect((await ask()).citations).toEqual([{ url: "https://ok.test" }]);
  });
});
