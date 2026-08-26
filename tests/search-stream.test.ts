/**
 * The streaming half of semantic search — `findPassagesStream` in src/search.ts.
 *
 * `fetch` is stubbed with real SSE frames, the same discipline
 * tests/explain.test.ts follows and for the same reason: a mock of the shape
 * the server actually sends is worth having, and a mock of a shape it doesn't
 * send is a test that stays green while production breaks.
 *
 * What's under test here is specifically the seam this module adds on top of
 * src/search-hits-stream.ts (already tested on its own in
 * tests/search-hits-stream.test.ts) and src/search.ts's existing
 * `validateHits`/`parseHits` (already tested in tests/search.test.ts): that a
 * hit shown mid-stream has genuinely been through the same validation the
 * final pass uses, that the cap is respected while streaming, and that the
 * final `done` event — not whatever streamed — is what a caller can trust.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_HITS, findPassages, findPassagesStream } from "../src/search.js";
import type { SearchRequest, SearchResult } from "../src/search.js";
import type { Block, Meta, SearchHit } from "../src/types.js";

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;
const BLOCKS = [
  { id: "spya-k3m9qt", text: "He rejects the idea that mind is software running on wet hardware." },
  { id: "spya-p7w2dn", text: "A thermostat has no interior. There is nothing it is like to be one." },
] as Block[];

const req = (): SearchRequest => ({ meta, blocks: BLOCKS, criterion: "arguments against dualism" });

const HIT1 = { blockId: "spya-k3m9qt", quote: "mind is software", confidence: 90, reasoning: "r1" };
const HIT2 = { blockId: "spya-p7w2dn", quote: "no interior", confidence: 70, reasoning: "r2" };

/** One SSE frame, exactly as OpenRouter writes them. */
const frame = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;

/**
 * A response whose body is a stream of the given raw SSE text, deliberately
 * split at an awkward point so a `data:` line lands across two reads — the
 * same reason tests/explain.test.ts splits its mocks, and `sseChunks` is the
 * same code either caller drives.
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
 * A minimal OpenRouter streamed success: the whole `{"hits": [...]}` object
 * as one content delta, then the usage/finish_reason chunk, then `[DONE]`.
 *
 * One delta rather than several is enough to exercise `hitExtractor` — it
 * finds every complete hit within a single `push()` call — and the tests
 * that need genuinely incremental delivery build their own SSE text instead.
 */
function reply(usage: unknown, hits: unknown[] = [HIT1, HIT2]): Response {
  return sse(
    frame({
      model: "anthropic/claude-sonnet-4.5",
      choices: [{ delta: { content: JSON.stringify({ hits }) } }],
    }) +
      frame({ choices: [{ finish_reason: "stop", delta: {} }], ...(usage ? { usage } : {}) }) +
      "data: [DONE]\n\n",
  );
}

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

async function drain(events: AsyncGenerator<{ type: string }>) {
  const hits: SearchHit[] = [];
  let done: SearchResult | undefined;
  for await (const e of events) {
    if (e.type === "hit") hits.push((e as { hit: SearchHit }).hit);
    else done = (e as { result: SearchResult }).result;
  }
  return { hits, done };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "test-key";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("switching the request to stream: true", () => {
  it("asks for usage on the stream, without which every count is silently null", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await findPassages(req());
    const body = bodyOf(fetchMock);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });

  it("still asks for no tools — the question is always where in this piece", async () => {
    fetchMock.mockResolvedValue(reply({}));
    await findPassages(req());
    expect(bodyOf(fetchMock).tools).toBeUndefined();
  });
});

describe("findPassages, drained rather than watched", () => {
  it("returns exactly what draining findPassagesStream's `done` event returns", async () => {
    fetchMock.mockResolvedValueOnce(reply({ prompt_tokens: 100, completion_tokens: 20 }));
    const direct = await findPassages(req());

    fetchMock.mockResolvedValueOnce(reply({ prompt_tokens: 100, completion_tokens: 20 }));
    const { done } = await drain(findPassagesStream(req()));

    expect(done).toEqual(direct);
  });

  it("reads usage from the final SSE chunk, not a JSON body", async () => {
    fetchMock.mockResolvedValue(
      reply({
        prompt_tokens: 500,
        completion_tokens: 40,
        prompt_tokens_details: { cached_tokens: 300, cache_write_tokens: 0 },
      }),
    );
    const result = await findPassages(req());
    expect(result.usage).toEqual({
      promptTokens: 500,
      completionTokens: 40,
      cacheReadTokens: 300,
      cacheWriteTokens: 0,
    });
  });

  it("keeps nulls, rather than inventing zeros, when the response carries no usage at all", async () => {
    fetchMock.mockResolvedValue(reply(undefined));
    const result = await findPassages(req());
    expect(result.usage).toEqual({
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
    });
  });
});

describe("hits, shown as they arrive", () => {
  it("emits hits in order as the model produces them", async () => {
    fetchMock.mockResolvedValue(reply(undefined, [HIT1, HIT2]));
    const { hits } = await drain(findPassagesStream(req()));
    expect(hits.map((h) => h.blockId)).toEqual(["spya-k3m9qt", "spya-p7w2dn"]);
  });

  it("does not emit a hit mid-stream whose quote is not in its block — the same rule the final pass uses", async () => {
    const bad = { blockId: "spya-k3m9qt", quote: "something not in the block at all", confidence: 80, reasoning: "r" };
    fetchMock.mockResolvedValue(reply(undefined, [bad, HIT2]));
    const { hits, done } = await drain(findPassagesStream(req()));
    // Only the good one is shown as a preview...
    expect(hits.map((h) => h.blockId)).toEqual(["spya-p7w2dn"]);
    // ...and the final pass, applying the identical rule, agrees.
    expect(done?.hits.map((h) => h.blockId)).toEqual(["spya-p7w2dn"]);
  });

  it("stops emitting hit events past MAX_HITS, and the final pass still settles on the same MAX_HITS", async () => {
    const many = Array.from({ length: MAX_HITS + 3 }, (_, i) => ({
      blockId: i % 2 === 0 ? "spya-k3m9qt" : "spya-p7w2dn",
      quote: i % 2 === 0 ? "mind is software" : "no interior",
      confidence: 80,
      reasoning: `r${i}`,
    }));
    fetchMock.mockResolvedValue(reply(undefined, many));
    const { hits, done } = await drain(findPassagesStream(req()));
    expect(hits).toHaveLength(MAX_HITS);
    expect(done?.hits).toHaveLength(MAX_HITS);
  });
});

describe("the final `done` is authoritative, not a rollup of what streamed", () => {
  it("refuses a truncated final response as a loud failure, even though a valid hit already streamed", async () => {
    /* A response cut off mid-object: OpenRouter still terminates the SSE
       stream cleanly (`[DONE]`, `finish_reason: "length"`), so nothing about
       the connection itself looks broken. The first hit is complete and well
       formed, so hitExtractor finds it and it survives per-item validation —
       a reader watching would have seen a real result appear. The strict
       whole-text parse below disagrees: the JSON object never closes, so
       parseHits throws rather than quietly reporting a one-hit answer. That
       is the property this describe block is for — a preview is never
       promoted to a result on its own; only the authoritative parse can
       produce a `done`. */
    const partial = `{"hits":[${JSON.stringify(HIT1)},{"blockId":"spya-p7`;
    fetchMock.mockResolvedValue(
      sse(
        frame({ choices: [{ delta: { content: partial } }] }) +
          frame({ choices: [{ finish_reason: "length", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );

    const hits: SearchHit[] = [];
    let thrown: Error | undefined;
    try {
      for await (const e of findPassagesStream(req())) {
        if (e.type === "hit") hits.push(e.hit);
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(hits).toHaveLength(1); // the preview really did show something
    expect(thrown).toBeDefined(); // but it was never treated as the answer
  });
});

describe("a provider error mid-stream", () => {
  it("throws without leaking what it said, and never produces a `done`", async () => {
    fetchMock.mockResolvedValue(sse(frame({ error: { message: "the whole article, verbatim: ..." } })));
    let thrown: Error | undefined;
    let sawDone = false;
    try {
      for await (const e of findPassagesStream(req())) {
        if (e.type === "done") sawDone = true;
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown?.message).not.toMatch(/the whole article, verbatim/);
    expect(sawDone).toBe(false);
  });
});
