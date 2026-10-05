import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagesBody } from "../src/messages-stream.js";
import type { Block } from "../src/types.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, ROOT_ONLY, sectionsAnswer, USAGE } from "./helpers/slice-model.js";

interface Call { ids: string[]; root: boolean; signal: AbortSignal; attempts: number }
let calls: Call[] = [];
let respond: (call: Call) => unknown;
vi.mock("../src/messages-stream.js", async (original) => ({
  ...(await original<typeof import("../src/messages-stream.js")>()),
  streamMessage: (_task: string, params: MessagesBody, opts: { signal: AbortSignal }) => {
    const call = { ids: askedIds(params), root: isRootCall(params), signal: opts.signal, attempts: 1 };
    calls.push(call);
    return {
      attempts: () => call.attempts,
      finalMessage: async () => {
        const answer = await respond(call);
        return typeof answer === "string" ? messageOf(answer) : answer;
      },
    };
  },
}));

const { runSlices, promotedSections, SLICE_CALL_CAP_MS, ROOT_CALL_CAP_MS } = await import("../src/structure-slices.js");
const { buildTree, canonicalWholeDocumentRequest, estimateStructureTokens, generateStructure, parseWholeDocumentAnswer, questionFor, wholeDocumentRequest, STRUCTURE_HEADROOM } = await import("../src/structure.js");
const { paragraphs } = await import("./helpers/bounded-tree.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const deps = { request: (blocks: Block[]) => ({ ...wholeDocumentRequest(blocks), answerTokens: estimateStructureTokens(blocks) }), headroom: STRUCTURE_HEADROOM, parse: parseWholeDocumentAnswer, build: buildTree, canonical: canonicalWholeDocumentRequest, question: questionFor };
const body = paragraphs(12);
const checkpoints = () => memoryCheckpoints({ articleId: "adversarial", slug: "adversarial" });
const bounded = (blocks: Block[]) => buildTree({
  title: "Title", gist: "The document has two parts.", range: [blocks[0]!.id, blocks.at(-1)!.id],
  children: [0, Math.floor(blocks.length / 2)].map((start, i) => ({
    title: `Part ${i}`, gist: `Part ${i} develops an argument.`,
    range: [blocks[start]!.id, blocks[i === 0 ? Math.floor(blocks.length / 2) - 1 : blocks.length - 1]!.id] as [string, string],
  })),
}, {}, blocks, "adversarial");
const run = (over: Partial<Parameters<typeof runSlices>[0]> = {}) => {
  const blocks = over.body ?? body;
  return runSlices({ body: blocks, slug: "adversarial", bounded: bounded(blocks), power: "standard", checkpoints: checkpoints(), deps, deadline: Infinity, ...over });
};
const good = (call: Call) => call.root ? ROOT_ANSWER : sectionsAnswer(call.ids, 3);
beforeEach(() => { calls = []; respond = good; });
afterEach(() => { vi.useRealTimers(); });

describe("stage E adversarial regressions", () => {
  it("rejects promoted overlaps, gaps, and starts outside the supplied slice", () => {
    const make = (ranges: [number, number][]) => ({ title: "Root", range: [body[0]!.id, body[5]!.id] as [string, string],
      children: ranges.map(([lo, hi]) => ({ title: "Section", gist: "A claim.", range: [body[lo]!.id, body[hi]!.id] as [string, string] })) });
    for (const ranges of [
      [[0, 3], [3, 5]], // overlap
      [[0, 1], [3, 5]], // gap
      [[1, 5]], // missing first block
      [[6, 7]], // starts outside slice
    ] satisfies [number, number][][]) {
      expect(() => promotedSections(make(ranges), body.slice(0, 6))).toThrow();
    }
  });

  it("a model start outside the slice is re-asked and then falls back", async () => {
    respond = (call) => {
      if (call.ids[0] !== body[0]!.id) return good(call);
      const answer = JSON.parse(sectionsAnswer(call.ids, 3));
      answer.root.children[0].start = body[7]!.id;
      return JSON.stringify(answer);
    };
    expect(await run()).toMatchObject({ ok: false, failure: "slice-failed" });
    expect(calls.filter((call) => call.ids[0] === body[0]!.id)).toHaveLength(2);
    expect(calls.some((call) => call.root)).toBe(false);
  });

  it("F22 counts a failed call as well as every successful peer", async () => {
    respond = (call) => { if (call.ids[0] === body[0]!.id) throw new Error("failed call"); return good(call); };
    const out = await run();
    expect(out.ok).toBe(false);
    expect(out.spend.calls).toBe(calls.length);
    expect(out.spend.usage).toEqual(USAGE);
  });

  it("F22 counts transport attempts on both successful and failed calls", async () => {
    respond = (call) => { call.attempts = 3; return good(call); };
    const out = await run();
    expect(out.ok).toBe(true);
    expect(out.spend.calls).toBe(calls.length * 3);
    expect(out.spend.usage.input_tokens).toBe(calls.length * USAGE.input_tokens);
  });

  it("F23 rejects a root statement rather than inventing its question mark", async () => {
    respond = (call) => call.root ? JSON.stringify({ gist: "The pieces share a worry.", question: "The document discusses ownership." }) : good(call);
    const out = await run();
    expect(out).toMatchObject({ ok: false, failure: "root-call-failed" });
    expect(calls.filter((c) => c.root)).toHaveLength(2);
  });

  it("F24 a slice resolving after its cap is awaited and counted but cannot admit a root", async () => {
    vi.useFakeTimers();
    const store = checkpoints();
    respond = async (call) => {
      if (call.ids[0] === body[0]!.id) await new Promise((resolve) => setTimeout(resolve, SLICE_CALL_CAP_MS + 1));
      return good(call);
    };
    let returned = false;
    const going = run({ checkpoints: store }).then((out) => { returned = true; return out; });
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time" });
    expect(calls.filter((c) => c.root)).toHaveLength(0);
    expect(out.spend.calls).toBe(2);
    expect(store.entries.size, "good late answers must still be checkpointed").toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F24 a root resolving after its cap cannot publish a slices tree", async () => {
    vi.useFakeTimers();
    respond = async (call) => {
      if (call.root) await new Promise((resolve) => setTimeout(resolve, ROOT_CALL_CAP_MS + 1));
      return good(call);
    };
    const going = run();
    await vi.advanceTimersByTimeAsync(ROOT_CALL_CAP_MS + 1);
    expect(await going).toMatchObject({ ok: false, failure: "out-of-time" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("F24 clock overrun stops admission before a late answer's checkpoint settles", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = (call) => {
      if (call.ids[0] === body[0]!.id) {
        vi.setSystemTime(Date.now() + SLICE_CALL_CAP_MS + 1);
        return good(call);
      }
      return ROOT_ONLY;
    };
    expect(await run()).toMatchObject({ ok: false, failure: "out-of-time" });
    expect(calls).toHaveLength(2);
  });

  it("F25 a pre-aborted reader starts no call", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(run({ signal: stop.signal })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("a reader Stop after the slices, while reading the root checkpoint, remains cancellation", async () => {
    const store = checkpoints();
    await run({ checkpoints: store });
    calls = [];
    const read = store.read;
    const stop = new AbortController();
    store.read = async <T>(...args: Parameters<typeof store.read>) => {
      const rows = await read<T>(...args);
      if ([...rows.values()].some((entry) => (entry as { answer: string }).answer === ROOT_ANSWER)) stop.abort();
      return rows;
    };
    await expect(run({ checkpoints: store, signal: stop.signal })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("F26 a peer failure prevents a concurrently invalid slice from re-asking", async () => {
    respond = (call) => {
      if (call.ids[0] === body[0]!.id) throw new Error("first peer failed");
      return ROOT_ONLY;
    };
    const out = await run();
    expect(out).toMatchObject({ ok: false, failure: "slice-failed" });
    expect(calls).toHaveLength(2);
  });

  it("awaits a second peer that rejects after the first has failed", async () => {
    let rejectPeer!: (err: Error) => void;
    const peer = new Promise<never>((_, reject) => { rejectPeer = reject; });
    respond = (call) => {
      if (call.ids[0] === body[0]!.id) throw new Error("first failure");
      return peer;
    };
    let returned = false;
    const going = run().then((out) => { returned = true; return out; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(returned).toBe(false);
    rejectPeer(new Error("later failure"));
    expect(await going).toMatchObject({ ok: false, spend: { calls: 2 } });
  });

  it("checkpoint read exceptions are misses and good answers are still written", async () => {
    const store = checkpoints();
    store.read = async () => { throw new Error("checkpoint read failed"); };
    expect(await run({ checkpoints: store })).toMatchObject({ ok: true });
    expect(store.entries.size).toBe(3);
  });

  it("a changed slice's blocks invalidate its checkpoint even when IDs are stable", async () => {
    const store = checkpoints();
    await run({ checkpoints: store });
    calls = [];
    const changed = body.map((block, i) => i === 1 ? { ...block, text: "A different argument.", html: "<p>A different argument.</p>" } : block);
    expect(await run({ body: changed, checkpoints: store })).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ids[0]).toBe(body[0]!.id);
  });

  it("one-block slices contribute a promoted section each", async () => {
    const small = paragraphs(2);
    const out = await run({ body: small });
    expect(out).toMatchObject({ ok: true, slices: 2, sections: 2, seams: [small[1]!.id] });
  });

  it("F27 a throwing progress observer cannot abandon an in-flight peer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const store = checkpoints();
    respond = async (call) => {
      if (call.ids[0] === body[6]!.id) await gate;
      return good(call);
    };
    let returned = false;
    const going = run({ checkpoints: store, onProgress: () => { throw new Error("progress observer failed"); } })
      .then((out) => { returned = true; return out; }, (err: unknown) => { returned = true; return err; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(returned).toBe(false);
    } finally {
      release();
    }
    expect(await going).toMatchObject({ ok: true });
    expect(store.entries.size).toBe(3);
  });

  it("F28 a failed refill stops admission, settles peers, and falls back", async () => {
    const long = paragraphs(600);
    respond = (call) => {
      if (call.ids.length === 300) return sectionsAnswer(call.ids, 130, true);
      throw new Error("refill failed");
    };
    const out = await run({ body: long });
    expect(out).toMatchObject({ ok: false, failure: "slice-failed" });
    expect(calls.filter((c) => c.root)).toHaveLength(0);
    expect(out.spend.calls).toBe(calls.length);
  });

  it("F30 partially cached slices that cannot ask the missing part are not a wholly resumed run", async () => {
    const long = paragraphs(3000);
    const store = checkpoints();
    respond = (call) => call.root ? ROOT_ANSWER : sectionsAnswer(call.ids);
    const generate = (stepBudgetMs?: number) => generateStructure({
      blocks: long, slug: "adversarial", power: "standard", checkpoints: store,
      ...(stepBudgetMs !== undefined ? { stepBudgetMs } : {}),
    });
    expect((await generate()).source.by).toBe("slices");
    const [missing] = [...store.entries].find(([, json]) => json.includes(long[1500]!.id))!;
    store.entries.delete(missing);
    calls = [];
    const out = await generate(1);
    expect(out.source).toMatchObject({ by: "headings", slicesFailed: "out-of-time" });
    expect(calls).toHaveLength(0);
    expect(out.wholeDocumentResumed).toBe(false);
  }, 60_000);
});
