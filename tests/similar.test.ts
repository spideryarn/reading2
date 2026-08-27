/**
 * **The similarity route's arithmetic** — src/similar.ts.
 *
 * The model is faked. What is under test is the ranking, the exclusions and the
 * cache, all of which fail by returning a perfectly plausible list of pairs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Block, BlockId } from "../src/types.js";
import { clearSimilarCache, similarBlocks } from "../src/similar.js";
import type { Tree } from "../src/types.js";

function block(id: string, words: number): Block {
  const text = Array.from({ length: words }, (_, i) => `word${i}`).join(" ");
  return {
    id: `spya-${id}` as BlockId,
    tag: "p",
    kind: "text",
    text,
    words,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

/**
 * Vectors on a line, so similarity is a known function of position: block `i`
 * gets angle `angles[i]`, and two blocks are alike exactly when their angles
 * are close. That makes every expected ordering below arithmetic rather than a
 * guess about what an embedding model would say.
 */
function fakeModel(angles: number[]): void {
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { input: string[] };
    // The texts arrive in block order, and the fixture's texts are distinct by
    // length, so the index into `angles` is the position in the batch.
    const data = body.input.map((_t, i) => ({
      index: i,
      embedding: [Math.cos(angles[i] ?? 0), Math.sin(angles[i] ?? 0)],
    }));
    return new Response(JSON.stringify({ data, usage: { prompt_tokens: 1 } }), { status: 200 });
  });
}

/**
 * A tree that puts each block in its own section, so nothing is excluded for
 * being same-section unless a test asks for it.
 *
 * The tree is not decoration here: since 2026-08-27 the server excludes
 * same-section pairs *before* ranking, because otherwise one dense section can
 * take the whole pool and the response is made entirely of findings the client
 * is about to discard.
 */
function oneEach(blocks: Block[]): Tree {
  const nodes: Record<string, unknown> = {
    n0: { id: "n0", depth: 0, parent: null, children: blocks.map((_b, i) => `s${i}`),
          range: [blocks[0]?.id, blocks[blocks.length - 1]?.id], title: "All" },
  };
  for (const [i, b] of blocks.entries()) {
    nodes[`s${i}`] = { id: `s${i}`, depth: 1, parent: "n0", children: [], range: [b.id, b.id], title: `S${i}` };
  }
  return { version: "1", generator: "t", slug: "s", rootId: "n0", nodes } as unknown as Tree;
}

/** One section covering every block — so every pair is same-section. */
function allOne(blocks: Block[]): Tree {
  const nodes: Record<string, unknown> = {
    n0: { id: "n0", depth: 0, parent: null, children: ["s0"],
          range: [blocks[0]?.id, blocks[blocks.length - 1]?.id], title: "All" },
    s0: { id: "s0", depth: 1, parent: "n0", children: [],
          range: [blocks[0]?.id, blocks[blocks.length - 1]?.id], title: "One" },
  };
  return { version: "1", generator: "t", slug: "s", rootId: "n0", nodes } as unknown as Tree;
}

const KEY = "test-key";
afterEach(() => {
  vi.unstubAllGlobals();
  clearSimilarCache();
});

/** Enough words that every block clears `MIN_WORDS`. */
const LONG = 20;

describe("similarBlocks", () => {
  it("ranks pairs globally, best first", async () => {
    process.env.OPENROUTER_API_KEY = KEY;
    // 0 and 3 are identical in direction; 0 and 2 are a little apart.
    fakeModel([0, 1.5, 0.4, 0]);
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    const { pairs } = await similarBlocks("s", blocks, oneEach(blocks));
    expect(pairs[0]).toMatchObject({ a: "spya-b0", b: "spya-b3" });
    expect(pairs.map((p) => p.score)).toEqual([...pairs.map((p) => p.score)].sort((x, y) => y - x));
  });

  it("never pairs a block with the paragraph next to it", async () => {
    /* Two consecutive paragraphs of one argument are similar for a reason the
       Force picture already draws, thick, with an arrow on it. Left in, they
       take every slot and the measure looks like it worked while telling the
       reader nothing. */
    process.env.OPENROUTER_API_KEY = KEY;
    fakeModel([0, 0, 0, 0]);
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    const { pairs } = await similarBlocks("s", blocks, oneEach(blocks));
    const adjacent = pairs.filter(
      (p) => Math.abs(Number(p.a.slice(-1)) - Number(p.b.slice(-1))) <= 1,
    );
    expect(adjacent).toEqual([]);
  });

  it("skips a block too short to say anything, and says how many it embedded", async () => {
    /* A three-word heading embeds fine and then sits close to every other
       three-word heading, because what they have in common is being short.
       Same mistake `MIN_TERMS_FOR_EDGE` in graph.ts exists to refuse. */
    process.env.OPENROUTER_API_KEY = KEY;
    fakeModel([0, 0.2, 0.4]);
    const blocks = [block("b0", LONG), block("b1", 3), block("b2", LONG), block("b3", LONG)];
    const answer = await similarBlocks("s", blocks, oneEach(blocks));
    expect(answer.blocks).toBe(3);
    expect(answer.pairs.some((p) => p.a === "spya-b1" || p.b === "spya-b1")).toBe(false);
  });

  it("asks the model once for an article, however many times it is asked", async () => {
    process.env.OPENROUTER_API_KEY = KEY;
    let calls = 0;
    fakeModel([0, 0.5, 1, 1.5]);
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      calls++;
      return real(u, i);
    });
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    await similarBlocks("s", blocks, oneEach(blocks));
    await similarBlocks("s", blocks, oneEach(blocks));
    expect(calls).toBe(1);
  });

  it("buys one copy when two readers arrive at a cold article together", async () => {
    /* Two tabs opening the Force picture at the same moment is the ordinary
       case, not the unlucky one. Without an in-flight promise cache they each
       embed the whole article and each pay for it — and a cache written only
       after the await coalesces nothing at all. GPT Sol's finding. */
    process.env.OPENROUTER_API_KEY = KEY;
    let calls = 0;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init.body)) as { input: string[] };
      await new Promise((r) => setTimeout(r, 10));
      return new Response(
        JSON.stringify({
          data: body.input.map((_t, i) => ({ index: i, embedding: [i, 1] })),
          usage: {},
        }),
        { status: 200 },
      );
    });
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    await Promise.all([similarBlocks("s", blocks, oneEach(blocks)), similarBlocks("s", blocks, oneEach(blocks))]);
    expect(calls).toBe(1);
  });

  it("misses when the article's words change, not just when its slug does", async () => {
    /* The key is the slug AND what the blocks say. A slug alone would be the
       version of this cache that is wrong exactly when it matters — after a
       re-ingest, serving vectors for prose that is gone. */
    process.env.OPENROUTER_API_KEY = KEY;
    let calls = 0;
    fakeModel([0, 0.5, 1, 1.5]);
    const real = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      calls++;
      return real(u, i);
    });
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    await similarBlocks("s", blocks, oneEach(blocks));
    const edited = [...blocks];
    edited[2] = block("b2", LONG + 9);
    await similarBlocks("s", edited, oneEach(edited));
    expect(calls).toBe(2);
  });

  it("does not cache a failure", async () => {
    process.env.OPENROUTER_API_KEY = KEY;
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("nope", { status: 400 });
    });
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    await expect(similarBlocks("s", blocks, oneEach(blocks))).rejects.toThrow();
    await expect(similarBlocks("s", blocks, oneEach(blocks))).rejects.toThrow();
    expect(calls).toBe(2);
  });

  it("returns nothing, without calling the model, for an article of one passage", async () => {
    process.env.OPENROUTER_API_KEY = KEY;
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response("{}", { status: 200 });
    });
    const one = [block("b0", LONG)];
    expect(await similarBlocks("s", one, oneEach(one))).toMatchObject({ pairs: [], blocks: 1 });
    expect(calls).toBe(0);
  });

  it("puts equally-alike pairs in reading order, and gives the same answer twice", async () => {
    /* **This one passes with the row tie-break in `byScore` deleted, and it is
       kept anyway.** `Array.prototype.sort` has been stable since ES2019 and
       the pairs are inserted in row order, so ties already come out in reading
       order without the tie-break doing anything. What this pins is the
       *contract* — equal scores come out earliest-first, and the same article
       gives the same list — rather than the mechanism that currently delivers
       it. A future change to how the pair loop iterates (or to how the
       incremental trim works) would break the contract without touching the
       comparator, and this is what would notice.

       Recorded rather than quietly kept, because a test nobody has watched fail
       is not evidence — docs/reusable/silent-success.md. */
    process.env.OPENROUTER_API_KEY = KEY;
    fakeModel([0, 0, 0, 0, 0]);
    const blocks = [0, 1, 2, 3, 4].map((i) => block(`b${i}`, LONG + i));
    const first = await similarBlocks("s", blocks, oneEach(blocks));
    // Every score is identical here, so the whole list is one big tie.
    expect(new Set(first.pairs.map((p) => p.score.toFixed(6))).size).toBe(1);
    const rows = first.pairs.map((p) => [Number(p.a.slice(-1)), Number(p.b.slice(-1))]);
    expect(rows).toEqual([...rows].sort((x, y) => (x[0] ?? 0) - (y[0] ?? 0) || (x[1] ?? 0) - (y[1] ?? 0)));

    clearSimilarCache();
    fakeModel([0, 0, 0, 0, 0]);
    expect((await similarBlocks("s", blocks, oneEach(blocks))).pairs).toEqual(first.pairs);
  });
});

describe("what happens at the sizes the small fixtures never reach", () => {
  /* ⟨Sol⟩ Every test above uses four or five blocks, so the 240-pair pool, the
     incremental trim, the block ceiling and the eviction were all untested —
     the code paths that only exist because a real article is bigger than a
     fixture. */

  it("does not let one crowded section take the whole answer", () => {
    /* **The failure that made this a NO-SHIP.** Sol's probe: 52 blocks where
       one section is full of near-identical passages. Ranked globally over all
       pairs, the top 240 are all inside that section at score ~1.0 and the
       cross-section pairs at 0.9 never appear — so the response is 240 findings
       the client is about to discard, and the picture says nothing came back.
       The exclusion has to happen before the ranking, which means the server
       needs the tree. */
    process.env.OPENROUTER_API_KEY = KEY;
    const blocks = Array.from({ length: 52 }, (_, i) => block(`b${i}`, LONG + i));
    // Rows 0–39 are one section and all point the same way; 40–51 are their own
    // sections, pointing slightly differently.
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      const data = body.input.map((t, i) => {
        const row = Number(/word(\d+)$/.exec(t)?.[1] ?? 0) - (LONG - 1);
        const angle = row < 40 ? 0 : 0.45 + row * 0.001;
        return { index: i, embedding: [Math.cos(angle), Math.sin(angle)] };
      });
      return new Response(JSON.stringify({ data, usage: {} }), { status: 200 });
    });
    const nodes: Record<string, unknown> = {
      n0: { id: "n0", depth: 0, parent: null, children: [], range: [blocks[0]?.id, blocks[51]?.id], title: "All" },
      crowd: { id: "crowd", depth: 1, parent: "n0", children: [], range: [blocks[0]?.id, blocks[39]?.id], title: "Crowd" },
    };
    for (let i = 40; i < 52; i++) {
      nodes[`s${i}`] = { id: `s${i}`, depth: 1, parent: "n0", children: [], range: [blocks[i]?.id, blocks[i]?.id], title: `S${i}` };
    }
    (nodes.n0 as { children: string[] }).children = Object.keys(nodes).filter((k) => k !== "n0");
    const tree = { version: "1", generator: "t", slug: "s", rootId: "n0", nodes } as unknown as Tree;

    return similarBlocks("s", blocks, tree).then(({ pairs }) => {
      expect(pairs.length).toBeGreaterThan(0);
      // Not one pair may have both ends inside the crowded section.
      const inCrowd = pairs.filter(
        (p) => Number(p.a.replace("spya-b", "")) < 40 && Number(p.b.replace("spya-b", "")) < 40,
      );
      expect(inCrowd).toEqual([]);
    });
  });

  it("says how many blocks the ceiling left out, rather than stopping quietly", async () => {
    /* **This needs to actually reach the ceiling**, and the first version did
       not: it asserted `eligible === 4` on a four-block article, where the
       ceiling is 1,500 and nothing it guards can happen. It passed with the
       loop `break`ing at the ceiling — the exact bug it was written for.

       1,501 blocks, all in one section, so every pair is excluded and the
       O(n²) loop allocates nothing. A bounded sweep that says nothing about its
       bound reads as complete coverage — docs/reusable/silent-success.md. */
    process.env.OPENROUTER_API_KEY = KEY;
    const blocks = Array.from({ length: 1501 }, (_, i) => block(`b${i}`, LONG));
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      const data = body.input.map((_t, i) => ({ index: i, embedding: [1, 0] }));
      return new Response(JSON.stringify({ data, usage: {} }), { status: 200 });
    });
    const answer = await similarBlocks("s", blocks, allOne(blocks));
    expect(answer.eligible).toBe(1501);
    expect(answer.blocks).toBe(1500);
    expect(answer.omitted).toBe(1);
  });

  it("returns nothing when the whole article is one section", async () => {
    // Not a degenerate case to shrug at: an article with no tree worth the name
    // must produce no dotted lines rather than a picture full of them.
    process.env.OPENROUTER_API_KEY = KEY;
    fakeModel([0, 0.1, 0.2, 0.3]);
    const blocks = [0, 1, 2, 3].map((i) => block(`b${i}`, LONG + i));
    expect((await similarBlocks("s", blocks, allOne(blocks))).pairs).toEqual([]);
  });

  it("caps the answer at the pool size", async () => {
    process.env.OPENROUTER_API_KEY = KEY;
    const blocks = Array.from({ length: 60 }, (_, i) => block(`b${i}`, LONG + i));
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      // Every pair distinct, so nothing is filtered and the cap is what bites.
      const data = body.input.map((_t, i) => ({ index: i, embedding: [Math.cos(i * 0.01), Math.sin(i * 0.01)] }));
      return new Response(JSON.stringify({ data, usage: {} }), { status: 200 });
    });
    const { pairs } = await similarBlocks("s", blocks, oneEach(blocks));
    // 60 blocks is 1,711 eligible pairs; the pool keeps 240.
    expect(pairs).toHaveLength(240);
    expect(pairs.map((p) => p.score)).toEqual([...pairs.map((p) => p.score)].sort((a, b) => b - a));
  });
});
