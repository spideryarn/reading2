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
import { MAX_HITS, findPassages, findPassagesStream, disagree, hitIdentities } from "../src/search.js";
import type { SearchEvent, SearchRequest, SearchResult } from "../src/search.js";
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
    headers: new Headers(),
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

/* Typed as the real `SearchEvent` union rather than `{ type: string }`, so the
   narrowing below is the compiler's and not a pair of casts. The casts were
   worse than untidy: `as` on a widened type would have kept compiling if the
   generator started yielding a differently-shaped hit, and this helper is what
   every assertion in the file reads its values through. */
async function drain(events: AsyncGenerator<SearchEvent>) {
  const hits: SearchHit[] = [];
  let done: SearchResult | undefined;
  for await (const e of events) {
    if (e.type === "hit") hits.push(e.hit);
    else done = e.result;
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

describe("a malformed SSE frame mid-stream", () => {
  it("throws rather than silently dropping a piece of the hits JSON", async () => {
    /* `sseChunks` is given `strict: true` for exactly this: a `data:` frame
       that is not valid JSON is, for chat and explain, a few lost words of
       prose — safe to skip. Here it can be exactly one content delta
       carrying part of `{"hits": [...]}`, and the text either side can still
       go on to parse as valid JSON, so a caller that skipped it could store
       a confidently wrong answer instead of noticing anything went missing.
       This frame is deliberately malformed at the SSE-envelope level (the
       line itself is not valid JSON) — not to be confused with the
       hits-JSON-inside-the-content-delta truncation the "authoritative done"
       tests above cover, which is a different failure at a different layer. */
    const firstPart = frame({
      choices: [{ delta: { content: `{"hits":[${JSON.stringify(HIT1)}` } }],
    });
    const corruptFrame = "data: {this is not a valid SSE JSON payload\n\n";
    fetchMock.mockResolvedValue(sse(firstPart + corruptFrame));

    let thrown: Error | undefined;
    const hits: SearchHit[] = [];
    try {
      for await (const e of findPassagesStream(req())) {
        if (e.type === "hit") hits.push(e.hit);
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeDefined();
    expect(thrown?.message).toMatch(/\[ai-unreadable\]/);
  });
});

/**
 * Cancellation — `signal` on `SearchRequest`.
 *
 * Search has no stop button (unlike chat's `converse`) and its payload is one
 * JSON object rather than prose, so `stoppedByReader`/`readerAborted` are
 * reused from openrouter-stream.ts (same as explain.ts) but the OUTCOME is
 * different from either sibling, and worth pinning explicitly per contract
 * rather than leaving it to be discovered: there is no "keep the words that
 * had arrived" the way converse.ts's stop button does, because a half-written
 * JSON object is not a usable partial answer the way half a sentence is.
 */
describe("cancellation", () => {
  /** A `fetch` that honours the signal it is given, as the real one does — see tests/converse-stop.test.ts. */
  function stubFetch(make: () => Response | Promise<Response>) {
    return vi.fn((_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Promise<Response>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        void Promise.resolve(make()).then(resolve, reject);
      });
    });
  }

  /** A response body that emits `frames` and then stays open until cancelled. */
  function hangingBody(frames: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < frames.length) {
          controller.enqueue(encoder.encode(frames[sent] as string));
          sent++;
          return;
        }
        return new Promise<void>(() => {}); // never resolves; the abort is what ends it
      },
    });
  }

  it("cancelling before the first byte throws — nothing was ever shown, because there was nothing to show", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", stubFetch(() => new Promise<Response>(() => {}))); // never replies
    const events: unknown[] = [];
    const iter = findPassagesStream({ ...req(), signal: controller.signal });
    setTimeout(() => controller.abort(new Error("stopped by the reader")), 5);
    /* **This used to assert `/stopped by the reader/` — the raw `AbortError`,
       rethrown by a `catch` that sat around the `fetch` itself.** When the fetch
       moved inside src/ai-call.ts's generator, that catch went with it, and this
       case now lands where every other disconnect lands: `READER_LEFT`.

       That is the improvement, not the regression. `stopped by the reader` is
       the *caller's* abort reason — a string a test happened to choose, which in
       production is whatever the route passed and by default is Node's own "This
       operation was aborted". The test three below this one ("the same honest
       disconnect message") already asserted `READER_LEFT` for a cancel a few
       milliseconds later, so the two nearly identical cases had two different
       answers and only one of them was a sentence. */
    await expect(
      (async () => {
        for await (const e of iter) events.push(e);
      })(),
    ).rejects.toThrow(/disconnected before this search finished/);
    expect(events).toEqual([]);
  });

  it("cancelling mid-stream, after a hit already showed, throws — the preview is never promoted to a `done`", async () => {
    /* An incomplete object is the ordinary outcome of a disconnect: the text
       so far is missing its outer `}`, `isBalanced` correctly calls that cut
       off, and `parseHits` refuses to treat it as a finished answer — the
       exact mechanism tests/search.test.ts pins for `parseHits` on its own,
       exercised here end to end through a real cancellation. */
    const controller = new AbortController();
    const missingOuterBrace = JSON.stringify({ hits: [HIT1] }).slice(0, -1);
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () =>
          ({
            ok: true,
            headers: new Headers(),
            body: hangingBody([
              frame({ choices: [{ delta: { content: missingOuterBrace } }] }),
            ]),
          }) as Response,
      ),
    );
    const events: { type: string }[] = [];
    let thrown: Error | undefined;
    try {
      for await (const e of findPassagesStream({ ...req(), signal: controller.signal })) {
        events.push(e);
        if (e.type === "hit") controller.abort(new Error("stopped by the reader"));
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(events.some((e) => e.type === "hit")).toBe(true); // the preview really did stream
    expect(events.some((e) => e.type === "done")).toBe(false); // but it was never treated as the answer
    // The point of this test, not just that SOMETHING was thrown: a reader
    // disconnecting must not be reported as a provider failure or logged as
    // a parse error — see READER_LEFT and where `stopped` is declared in
    // src/search.ts. Before that fix this threw ANSWER_OVERFLOWED,
    // [ai-overflowed], which told whoever eventually read it to ask for
    // something narrower — nonsensical advice for a search nobody is
    // waiting on any more.
    expect(thrown?.message).toBe("The reader disconnected before this search finished.");
    expect(thrown?.message).not.toMatch(/\[ai-/);
  });

  it("cancelling before any content arrives at all throws the same honest disconnect message", async () => {
    // The empty-text sibling of the test above: the response arrived, but
    // nothing had streamed yet when the reader left. Not "the model
    // returned no text" (saidNothing, an ai-coded sentence) — the model may
    // never even have been asked to finish.
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      stubFetch(() => ({ ok: true, body: hangingBody([]) }) as Response), // opens, then sends nothing
    );
    const events: { type: string }[] = [];
    let thrown: Error | undefined;
    setTimeout(() => controller.abort(new Error("stopped by the reader")), 5);
    try {
      for await (const e of findPassagesStream({ ...req(), signal: controller.signal })) {
        events.push(e);
      }
    } catch (err) {
      thrown = err as Error;
    }
    expect(events).toEqual([]);
    expect(thrown?.message).toBe("The reader disconnected before this search finished.");
  });

  it("cancelling once the text is already complete still produces a `done` — nothing was lost, only the wire's own [DONE] never arrived", async () => {
    /* The interesting case, and the reason all three of these are worth
       having rather than just the "obviously throws" one above: the model's
       JSON can be genuinely whole — parses, validates — even though neither
       `[DONE]` nor a `finish_reason` ever showed up, because the reader
       walked away a moment before OpenRouter's own sentinel did. Since the
       text itself is provably complete, this is not filed as a truncation:
       nothing is lost, so nothing is thrown away. */
    const controller = new AbortController();
    const complete = JSON.stringify({ hits: [HIT1] });
    vi.stubGlobal(
      "fetch",
      stubFetch(
        () =>
          ({ ok: true, body: hangingBody([frame({ choices: [{ delta: { content: complete } }] })]) }) as Response,
      ),
    );
    const events: { type: string }[] = [];
    for await (const e of findPassagesStream({ ...req(), signal: controller.signal })) {
      events.push(e);
      if (e.type === "hit") controller.abort(new Error("stopped by the reader"));
    }
    expect(events.map((e) => e.type)).toEqual(["hit", "done"]);
  });
});

describe("the alarm that says the preview and the stored result disagreed", () => {
  /* src/search.ts § disagree. This is the one check that would notice the
     extractor drifting away from a real parse — the reader sees a row appear
     and then quietly not be there once the run is saved, which has no other
     symptom. It lives in a log line, and nothing here reads logs, so the
     judgement is tested even though the wiring is not. Said plainly because
     "the alarm is tested" would otherwise be more than is true. */
  const ids = (...pairs: [string, number][]) =>
    hitIdentities(
      pairs.map(([blockId, start]) => ({
        blockId,
        start,
        quote: "unused",
        confidence: 50,
        reasoning: "",
      })),
    );

  it("stays quiet when the preview and the stored result match", () => {
    const same = ids(["spya-k3m9qt", 0], ["spya-aaaaaa", 12]);
    expect(disagree(same, [...same])).toBe(false);
  });

  it("fires when a previewed hit is missing from the stored result", () => {
    expect(disagree(ids(["spya-k3m9qt", 0], ["spya-aaaaaa", 12]), ids(["spya-k3m9qt", 0]))).toBe(
      true,
    );
  });

  it("fires when the same hits come back in a different order", () => {
    /* Not a set comparison, deliberately: hits are ranked best-first and the
       ranking is most of what the reader is being given. */
    expect(
      disagree(ids(["spya-k3m9qt", 0], ["spya-aaaaaa", 12]), ids(["spya-aaaaaa", 12], ["spya-k3m9qt", 0])),
    ).toBe(true);
  });

  it("fires when a hit is at a different place in the same block", () => {
    expect(disagree(ids(["spya-k3m9qt", 0]), ids(["spya-k3m9qt", 40]))).toBe(true);
  });

  it("names a hit without putting the article in the log", () => {
    // The identity is blockId:start. The quote is prose — see logging.md.
    expect(ids(["spya-k3m9qt", 7])).toEqual(["spya-k3m9qt:7"]);
  });
});

describe("a reply with two `hits` keys is refused outright", () => {
  /* JSON allows a key to repeat and `JSON.parse` silently keeps the LAST, while
     the extractor previews from the first. So the reader would be shown one set
     of passages and a different set would be saved — the one case where a
     preview really can be wrong rather than merely late.

     It cannot be fixed by preferring the later array: the preview is on screen
     before the second key exists. Refusing the whole reply is the only outcome
     that leaves nothing wrong *stored*, which is the guarantee the design makes.
     Found by GPT Sol, 2026-08-26, after two earlier fixes to the same claim. */
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** `JSON.stringify` cannot make a duplicate key — it has to be written out. */
  const twoKeys =
    `{"hits":[${JSON.stringify(HIT1)}],"hits":[${JSON.stringify(HIT2)}]}`;

  it("throws rather than storing the second array", async () => {
    fetchMock.mockResolvedValue(
      sse(
        frame({
          model: "anthropic/claude-sonnet-4.5",
          choices: [{ delta: { content: twoKeys } }],
        }) +
          frame({ choices: [{ finish_reason: "stop", delta: {} }] }) +
          "data: [DONE]\n\n",
      ),
    );
    await expect(findPassages(req())).rejects.toThrow(/\[ai-unreadable\]/);
  });

  it("proves the hazard is real: the two arrays genuinely differ", () => {
    /* Without this the test above could pass for the wrong reason — a typo in
       `twoKeys` making it merely unparseable. `JSON.parse` must succeed here,
       and must disagree with what the preview would have shown. */
    const parsed = JSON.parse(twoKeys) as { hits: { quote: string }[] };
    expect(parsed.hits[0]?.quote).toBe(HIT2.quote);
    expect(parsed.hits[0]?.quote).not.toBe(HIT1.quote);
  });

  it("leaves an ordinary reply alone", async () => {
    fetchMock.mockResolvedValue(reply(null));
    const result = await findPassages(req());
    expect(result.hits).toHaveLength(2);
  });
});
