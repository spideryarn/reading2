/**
 * **`generateQuotes` end to end, with the model stubbed** — the three things
 * GPT Sol found in the Find more plan that live in the stage's own body rather
 * than in `buildQuotes`, where tests/quotes-find-more.test.ts can reach them:
 *
 *  - a stale list is replaced with **fresh** ids — an id carried across a
 *    re-extraction would point a reader's `?quote=` link at words from a
 *    different version of the piece (the plan had this backwards);
 *  - the run's `dropped` is **this pass's** alone, for the log that watches for
 *    prompt drift, while the artefact's `discarded` is the whole list's;
 *  - the count asked for is **capped by the room left** under
 *    `MAX_QUOTES_TOTAL`, and at the ceiling no call is made at all.
 *
 * docs/plans/260911a-quotes-find-more-and-a-fade-that-carries-priority.md.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_QUOTES_TOTAL, type Block, type Quote, type Quotes, type Tree, type TreeNode } from "../src/types.js";

/** What the stubbed model will answer next, and every request it was sent. */
let answer = '{"quotes": []}';
const sent: string[] = [];

vi.mock("../src/messages-stream.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/messages-stream.js")>();
  return {
    ...real,
    streamMessage: (_task: string, body: unknown) => {
      sent.push(JSON.stringify(body));
      return {
        onText: () => {},
        finalMessage: async () => ({
          content: [{ type: "text", text: answer }],
          stop_reason: "end_turn",
          stop_details: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      };
    },
  };
});

const { generateQuotes, inputFingerprint, noneDropped } = await import("../src/quotes.js");

const FIRST = "Writing is thinking, and there is no other kind of thinking.";
const SECOND = "The mathematical marriage of convenience starts to fall apart here.";
const THIRD = "Most people never had to write anything at all, and now they must.";

function block(id: string, text: string): Block {
  return { id, tag: "p", kind: "text", text, words: 400, html: `<p>${text}</p>`, gistable: true };
}

const BLOCKS: Block[] = [block("spya-aaaaaa", FIRST), block("spya-bbbbbb", SECOND)];
const TREE = {
  slug: "writes",
  generatedAt: "2026-08-31T00:00:00.000Z",
  rootId: "n0",
  nodes: {
    n0: { id: "n0", depth: 0, parent: null, children: ["n1"], range: ["spya-aaaaaa", "spya-bbbbbb"], title: "A piece" },
    n1: { id: "n1", depth: 1, parent: "n0", children: [], range: ["spya-aaaaaa", "spya-bbbbbb"], title: "Part one", gist: "g" },
  } as Record<string, TreeNode>,
} as unknown as Tree;
const ARTICLE = { slug: "writes", blocks: BLOCKS, tree: TREE, meta: null };
const HERE = inputFingerprint(BLOCKS, TREE, null);

function previous(over: Partial<Quotes> = {}): Quotes {
  return {
    version: "quotes/3",
    generator: "m",
    slug: "writes",
    sourceHash: HERE,
    profileHash: null,
    quotes: [{ id: "spya-keep01", blockId: "spya-aaaaaa", text: FIRST, start: 0 }],
    discarded: { ...noneDropped(), unfound: 5 },
    generatedAt: "2026-09-10T00:00:00.000Z",
    elapsedMs: 1,
    ...over,
  };
}

beforeEach(() => {
  sent.length = 0;
});

describe("generateQuotes, on a Find more", () => {
  it("appends to an unmoved list and keeps its id", async () => {
    answer = JSON.stringify({ quotes: [{ text: SECOND }] });
    const run = await generateQuotes({ article: ARTICLE, previous: previous() });
    expect(run.quotes.quotes.map((q) => q.id)[0]).toBe("spya-keep01");
    expect(run.quotes.quotes).toHaveLength(2);
    expect(sent[0]).toContain("ALREADY ON THE LIST");
  });

  it("reports this pass's drops for the log, and the whole list's on the artefact", async () => {
    answer = JSON.stringify({ quotes: [{ text: SECOND }, { text: "Words this piece has never contained anywhere." }] });
    const run = await generateQuotes({ article: ARTICLE, previous: previous() });
    expect(run.dropped.unfound).toBe(1);
    expect(run.quotes.discarded.unfound).toBe(6);
  });

  it("keeps an old supplement quote in place although today's evidence filters its block out", async () => {
    const supplement = { ...block("spya-bbbbbb", SECOND), treatment: "supplement" as const };
    const third = block("spya-cccccc", THIRD);
    const blocks = [BLOCKS[0]!, supplement, third];
    const article = { ...ARTICLE, blocks };
    const sourceHash = inputFingerprint(blocks, TREE, null);
    const keptSupplement: Quote = {
      id: "spya-keep02",
      blockId: supplement.id,
      text: SECOND,
      start: 0,
    };
    answer = JSON.stringify({ quotes: [{ text: THIRD }] });

    const run = await generateQuotes({
      article,
      previous: previous({
        sourceHash,
        quotes: [previous().quotes[0]!, keptSupplement],
      }),
    });

    expect(run.quotes.quotes.map((q) => q.id)).toEqual([
      "spya-keep01",
      "spya-keep02",
      expect.any(String),
    ]);
    expect(run.quotes.quotes[1]).toEqual(keptSupplement);
  });
});

describe("generateQuotes, on a stale list", () => {
  it("replaces it with FRESH ids, even for the same words", async () => {
    answer = JSON.stringify({ quotes: [{ text: FIRST }] });
    const run = await generateQuotes({ article: ARTICLE, previous: previous({ sourceHash: "an-older-article" }) });
    expect(run.quotes.quotes).toHaveLength(1);
    expect(run.quotes.quotes[0]?.id).not.toBe("spya-keep01");
    expect(run.quotes.passes).toBe(1);
    expect(sent[0]).not.toContain("ALREADY ON THE LIST");
  });
});

describe("generateQuotes, near the ceiling", () => {
  const full = (n: number): Quote[] =>
    Array.from({ length: n }, (_, i) => ({ id: `spya-f${String(i).padStart(5, "0")}`, blockId: "spya-aaaaaa", text: FIRST, start: 0 }));

  it("asks for no more than the room left", async () => {
    answer = '{"quotes": []}';
    await generateQuotes({ article: ARTICLE, previous: previous({ quotes: full(MAX_QUOTES_TOTAL - 3) }) });
    expect(sent[0]).toContain("up to 3 MORE");
  });

  it("makes no call at all when there is no room, and says it found nothing", async () => {
    const run = await generateQuotes({ article: ARTICLE, previous: previous({ quotes: full(MAX_QUOTES_TOTAL) }) });
    expect(sent).toHaveLength(0);
    expect(run.quotes.quotes).toHaveLength(MAX_QUOTES_TOTAL);
    expect(run.quotes.lastAdded).toBe(0);
  });
});
