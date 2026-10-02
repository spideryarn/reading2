/**
 * Quick search — [`src/quick-search.ts`](../src/quick-search.ts), Jev scoring
 * every block (docs/plans/261002e-quick-search-v1.md).
 *
 * Three halves: which blocks are asked about and how they are split into
 * requests, how probabilities become hits, and the stream the route reads —
 * against a stubbed `fetch`, never a live call. The request shape and the
 * overflow body are the spike's, measured on 2026-10-02
 * (docs/investigations/261002o-quick-search-spike.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRefused } from "../src/ai-call.js";
import { collectSpend } from "../src/ai-spend.js";
import { MAX_HITS, type SearchEvent } from "../src/search.js";
import {
  CHUNK_TOKEN_BUDGET,
  QUICK_FLOOR,
  chunkBlocks,
  estimateTokens,
  hitsFrom,
  quickBlocks,
  quickPassagesStream,
} from "../src/quick-search.js";
import type { Block, Meta } from "../src/types.js";

beforeEach(() => vi.stubEnv("OPENROUTER_API_KEY", "sk-test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const meta = { title: "A piece", url: "https://example.com/a" } as Meta;

let n = 0;
/** A block with a fresh, well-formed id. */
function block(text: string, over: Partial<Block> = {}): Block {
  n++;
  return {
    id: `spya-q${String(n).padStart(5, "0")}`,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
    ...over,
  } as Block;
}

const OVERFLOW =
  '{"error":{"message":"HTTP 400: {\\"detail\\":{\\"error_type\\":\\"max_tokens_exceeded\\"}}","code":400}}';

function reply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

interface Sent {
  url: string;
  body: {
    model: string;
    state: { query: string; passages: Record<string, string> };
    questions: Record<string, { type: string; instructions: string }>;
  };
}

/** Replace `fetch` with a judge: `answer` decides each request's reply. */
function stubJudge(answer: (sent: Sent) => Response): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const s = { url, body: JSON.parse(String(init.body)) as Sent["body"] };
    sent.push(s);
    return answer(s);
  });
  return sent;
}

/** Every question answered with `p(id)`, priced like the spike's replies. */
function scoring(p: (id: string) => number) {
  return (s: Sent) =>
    reply({
      answers: Object.fromEntries(Object.keys(s.body.questions).map((id) => [id, { noul: p(id) }])),
      usage: { input_tokens: 1000, output_tokens: 10, cost: 0.000042 },
    });
}

async function drain(gen: AsyncGenerator<SearchEvent>): Promise<SearchEvent[]> {
  const out: SearchEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("which blocks are asked about", () => {
  it("keeps searchable prose and drops headings, unsearchable blocks and empty text", () => {
    const prose = block("The argument.");
    const note = block("A footnote.", { treatment: "supplement" } as Partial<Block>);
    const blocks = [
      block("The Title", { kind: "heading", tag: "h1", level: 1 } as Partial<Block>),
      prose,
      block("", {}),
      block("   ", {}),
      block("an image", { kind: "media", gistable: false } as Partial<Block>),
      note,
    ];
    /* A note stays, because `isSearchable`'s policy is Greg's: a note is part
       of what a reader searches. A heading goes, because Jev rates a title
       highly for any query about the piece (0.85–0.90 in the spike). */
    expect(quickBlocks(blocks).map((b) => b.id)).toEqual([prose.id, note.id]);
  });
});

describe("splitting a long article into requests", () => {
  it("keeps a short article in one request", () => {
    const blocks = [block("a".repeat(320)), block("b".repeat(320))];
    expect(chunkBlocks(blocks)).toEqual([blocks]);
  });

  it("starts a new request before one would pass the budget, keeping order", () => {
    /* Each block is ~10k estimated tokens, so two fit under 26k and three do not. */
    const big = () => block("x".repeat(32_000));
    const blocks = [big(), big(), big(), big(), big()];
    expect(estimateTokens(blocks[0]!)).toBeGreaterThan(CHUNK_TOKEN_BUDGET / 3);
    const chunks = chunkBlocks(blocks);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
    expect(chunks.flat()).toEqual(blocks);
  });

  it("gives a block bigger than the budget a request of its own rather than dropping it", () => {
    const huge = block("y".repeat(200_000));
    const small = block("z");
    expect(chunkBlocks([small, huge, small])).toEqual([[small], [huge], [small]]);
  });
});

describe("turning probabilities into hits", () => {
  const a = block("Alpha passage.");
  const b = block("Beta passage.");
  const c = block("Gamma passage.");

  it("keeps the blocks at or above the floor, best first, whole paragraph quoted", () => {
    const { hits } = hitsFrom({ [a.id]: 0.81, [b.id]: 0.6, [c.id]: 0.934 }, [a, b, c]);
    expect(hits).toEqual([
      { blockId: c.id, quote: c.text, confidence: 93, reasoning: "", start: 0 },
      { blockId: a.id, quote: a.text, confidence: 81, reasoning: "", start: 0 },
    ]);
  });

  it("puts the floor at 0.7, inclusive", () => {
    expect(QUICK_FLOOR).toBe(0.7);
    expect(hitsFrom({ [a.id]: 0.7 }, [a]).hits).toHaveLength(1);
    expect(hitsFrom({ [a.id]: 0.6999 }, [a]).hits).toHaveLength(0);
  });

  it("breaks a tie in the article's order, so the list does not shuffle", () => {
    const { hits } = hitsFrom({ [c.id]: 0.9, [a.id]: 0.9 }, [a, b, c]);
    expect(hits.map((h) => h.blockId)).toEqual([a.id, c.id]);
  });

  it("caps at MAX_HITS and counts what the cap threw away", () => {
    const many = Array.from({ length: MAX_HITS + 5 }, (_, i) => block(`passage ${i}`));
    const { hits, dropped } = hitsFrom(
      Object.fromEntries(many.map((m, i) => [m.id, 0.81 + i / 1000])),
      many,
    );
    expect(hits).toHaveLength(MAX_HITS);
    expect(dropped.truncated).toBe(5);
    expect(hits[0]?.blockId).toBe(many[many.length - 1]?.id);
  });

  it("ignores an answer naming a block it was not asked about, and counts it", () => {
    const { hits, dropped } = hitsFrom({ [a.id]: 0.9, "spya-zzzzzz": 0.99 }, [a]);
    expect(hits.map((h) => h.blockId)).toEqual([a.id]);
    expect(dropped.unknownIds).toBe(1);
  });

});

describe("quickPassagesStream", () => {
  it("asks one question per block, keyed by id, about one shared state", async () => {
    const a = block("He rejects the idea that mind is software.");
    const b = block("A thermostat has no interior.");
    const sent = stubJudge(scoring(() => 0.1));
    await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks: [a, b], criterion: "minds are not software" })),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(sent[0]?.body.model).toBe("typesafe/jev-1.13");
    expect(sent[0]?.body.state).toEqual({
      query: "minds are not software",
      passages: { [a.id]: a.text, [b.id]: b.text },
    });
    expect(sent[0]?.body.questions[a.id]).toEqual({
      type: "noul",
      instructions: `Does passage ${a.id} match what the reader is looking for (query)?`,
    });
    expect(Object.keys(sent[0]?.body.questions ?? {})).toEqual([a.id, b.id]);
  });

  it("yields the hits and then one done, in findPassagesStream's shape", async () => {
    const a = block("First.");
    const b = block("Second.");
    stubJudge(scoring((id) => (id === b.id ? 0.92 : 0.2)));
    const { result: events } = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks: [a, b], criterion: "q" })),
    );
    expect(events.map((e) => e.type)).toEqual(["hit", "done"]);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.result.hits.map((h) => h.blockId)).toEqual([b.id]);
    expect(done.result.model).toBe("typesafe/jev-1.13");
    expect(done.result.usage?.promptTokens).toBe(1000);
  });

  it("sends the chunks of a long article in parallel and writes one ledger row each", async () => {
    const blocks = Array.from({ length: 5 }, () => block("x".repeat(32_000)));
    let inFlight = 0;
    let most = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      const body = JSON.parse(String(init.body)) as Sent["body"];
      return scoring(() => 0.85)({ url: "", body });
    });
    const { result: events, report } = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    );
    expect(most).toBe(3);
    expect(report.calls).toHaveLength(3);
    expect(report.calls.every((c) => c.job === "search-quick" && c.wire === "decisions")).toBe(true);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.result.hits).toHaveLength(5);
  });

  it("halves a chunk the model says is too long, and asks again", async () => {
    const blocks = Array.from({ length: 4 }, (_, i) => block(`passage ${i}`));
    const sent = stubJudge((s) =>
      Object.keys(s.body.questions).length > 2 ? reply(OVERFLOW, 400) : scoring(() => 0.9)(s),
    );
    const { result: events, report } = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    );
    expect(sent.map((s) => Object.keys(s.body.questions).length)).toEqual([4, 2, 2]);
    expect(report.calls.map((c) => c.outcome)).toEqual(["error", "ok", "ok"]);
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no done");
    expect(done.result.hits.map((h) => h.blockId)).toEqual(blocks.map((b) => b.id));
  });

  it("stops halving after a bounded depth rather than spending without end", async () => {
    const blocks = Array.from({ length: 64 }, (_, i) => block(`passage ${i}`));
    const sent = stubJudge(() => reply(OVERFLOW, 400));
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRefused);
    /* 64 → 32 → 16 → 8 is three halvings: 1 + 2 + 4 + 8 requests at most. */
    expect(sent.length).toBeLessThanOrEqual(15);
    expect(sent.length).toBeGreaterThan(1);
  });

  it("fails the whole search when a question comes back unanswered, never a clean miss", async () => {
    const blocks = [block("one"), block("two")];
    stubJudge((s) =>
      reply({ answers: { [Object.keys(s.body.questions)[0]!]: { noul: 0.95 } } }),
    );
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    ).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/\[ai-/);
    expect((err as Error).cause).toBe("unanswered");
  });

  it("fails the whole search on an answer that is not a probability", async () => {
    const blocks = [block("one"), block("two")];
    stubJudge((s) =>
      reply({
        answers: Object.fromEntries(
          Object.keys(s.body.questions).map((id, i) => [id, { noul: i === 0 ? 1.7 : 0.9 }]),
        ),
      }),
    );
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    ).catch((e: unknown) => e);
    expect((err as Error).cause).toBe("unanswered");
  });

  it("refuses a reply with no answers at all as unreadable", async () => {
    stubJudge(() => reply({ usage: { input_tokens: 10, cost: 0.000001 } }));
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks: [block("one")], criterion: "q" })),
    ).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/\[ai-/);
    expect((err as Error).cause).toBe("no-answers");
  });

  it("fails when one chunk fails, and stops the others rather than paying for them", async () => {
    const blocks = Array.from({ length: 5 }, () => block("x".repeat(32_000)));
    let call = 0;
    const aborted: boolean[] = [];
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const mine = call++;
      if (mine === 0) return Promise.resolve(reply("{}", 502));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted.push(true);
          reject(init.signal?.reason);
        });
      });
    });
    const { report } = await collectSpend(async () => {
      await expect(
        drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
      ).rejects.toThrowError(ProviderRefused);
    });
    expect(aborted).toHaveLength(2);
    /* One row per request, every one of them inside the collector. */
    expect(report.calls.map((c) => c.outcome).sort()).toEqual(["aborted", "aborted", "error"]);
  });

  it("ends with the refusal when a single block still overflows", async () => {
    const blocks = [block("one"), block("two")];
    const sent = stubJudge(() => reply(OVERFLOW, 400));
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderRefused);
    expect((err as ProviderRefused).kind).toBe("context-exceeded");
    /* The pair, then each singleton once — never a singleton halved. */
    expect(sent.map((s) => Object.keys(s.body.questions).length)).toEqual([2, 1, 1]);
  });

  it("drains a halved chunk's aborted sibling before closing its spend collector", async () => {
    const blocks = [block("one"), block("two")];
    let siblingFinished = false;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Sent["body"];
      const ids = Object.keys(body.questions);
      if (ids.length === 2) return Promise.resolve(reply(OVERFLOW, 400));
      if (ids[0] === blocks[0]!.id) return Promise.resolve(reply("{}", 502));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          // Real cancellation still has asynchronous body/transport cleanup.
          setTimeout(() => {
            siblingFinished = true;
            reject(init.signal?.reason);
          }, 20);
        });
      });
    });
    const { report } = await collectSpend(async () => {
      await expect(
        drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
      ).rejects.toThrowError(ProviderRefused);
    });
    // Capture at collector closure; letting a late call mutate the array would
    // disguise the missing persistent row as a correct in-memory report.
    const outcomes = report.calls.map((c) => c.outcome).sort();
    const finishedAtClose = siblingFinished;
    await new Promise((r) => setTimeout(r, 30));
    expect(finishedAtClose).toBe(true);
    expect(report.pending).toEqual([]);
    expect(outcomes).toEqual(["aborted", "error", "error"]);
  });

  it("keeps the halved chunk's failure when another top-level chunk aborts first", async () => {
    const blocks = Array.from({ length: 3 }, () => block("x".repeat(32_000)));
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Sent["body"];
      const ids = Object.keys(body.questions);
      if (ids.length === 2) return Promise.resolve(reply(OVERFLOW, 400));
      if (ids[0] === blocks[0]!.id) return Promise.resolve(reply("{}", 502));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const delay = ids[0] === blocks[1]!.id ? 20 : 0;
          setTimeout(() => reject(new DOMException("Aborted", "AbortError")), delay);
        });
      });
    });
    const { report } = await collectSpend(async () => {
      await expect(
        drain(quickPassagesStream({ meta, blocks, criterion: "q" })),
      ).rejects.toMatchObject({ status: 502 });
    });
    expect(report.pending).toEqual([]);
    expect(report.calls.map((c) => c.outcome).sort()).toEqual([
      "aborted", "aborted", "error", "error",
    ]);
  });

  it.each(["deadline", "reader"] as const)(
    "drains every descendant of a halved chunk on %s cancellation",
    async (cause) => {
      const blocks = [block("one"), block("two")];
      const left = new AbortController();
      const signals: AbortSignal[] = [];
      let startedHalves = 0;
      vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Sent["body"];
        if (Object.keys(body.questions).length === 2) {
          return Promise.resolve(reply(OVERFLOW, 400));
        }
        const signal = init.signal!;
        signals.push(signal);
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            setTimeout(() => reject(signal.reason), ++startedHalves * 10);
          });
          if (signals.length === 2 && cause === "reader") left.abort();
        });
      });
      const { report } = await collectSpend(async () => {
        await expect(
          drain(quickPassagesStream({
            meta, blocks, criterion: "q", signal: left.signal, timeoutMs: 30,
          })),
        ).rejects.toThrow(cause === "reader" ? /reader disconnected/ : /\[ai-/);
      });
      expect(signals).toHaveLength(2);
      expect(signals[0]).toBe(signals[1]);
      expect(report.pending).toEqual([]);
      expect(report.calls.map((c) => c.outcome).sort()).toEqual(["aborted", "aborted", "error"]);
    },
  );

  it("does not relabel a provider refusal when the deadline expires during cancellation cleanup", async () => {
    const blocks = Array.from({ length: 3 }, () => block("x".repeat(32_000)));
    let call = 0;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      if (call++ === 0) return Promise.resolve(reply("{}", 502));
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          setTimeout(() => reject(init.signal?.reason), 60);
        });
      });
    });
    const { report } = await collectSpend(async () => {
      await expect(
        drain(quickPassagesStream({ meta, blocks, criterion: "q", timeoutMs: 30 })),
      ).rejects.toMatchObject({ status: 502 });
    });
    expect(report.pending).toEqual([]);
    expect(report.calls.map((c) => c.outcome).sort()).toEqual(["aborted", "error"]);
  });

  it("does not halve an ordinary refusal", async () => {
    const blocks = Array.from({ length: 4 }, (_, i) => block(`passage ${i}`));
    const sent = stubJudge(() => reply('{"error":{"message":"HTTP 400: bad","code":400}}', 400));
    await expect(
      collectSpend(() => drain(quickPassagesStream({ meta, blocks, criterion: "q" }))),
    ).rejects.toThrowError(ProviderRefused);
    expect(sent).toHaveLength(1);
  });

  it("gives up at its deadline with a sentence a reader can act on", async () => {
    const blocks = [block("one"), block("x".repeat(32_000)), block("y".repeat(32_000))];
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const err = await collectSpend(() =>
      drain(quickPassagesStream({ meta, blocks, criterion: "q", timeoutMs: 30 })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/\[ai-/);
  });

  it("makes no call at all for an article with nothing to score", async () => {
    const sent = stubJudge(scoring(() => 0.9));
    const events = await drain(
      quickPassagesStream({
        meta,
        blocks: [block("Title", { kind: "heading" } as Partial<Block>)],
        criterion: "q",
      }),
    );
    expect(sent).toHaveLength(0);
    expect(events).toEqual([
      { type: "done", result: { hits: [], model: "typesafe/jev-1.13" } },
    ]);
  });
});
