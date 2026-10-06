/**
 * **One failed call no longer costs a long document its whole table of
 * contents.** Three behaviours of `runSlices` (src/structure-slices.ts), and
 * the rules they must not loosen:
 *
 * - a failed refill keeps the section it was meant to divide;
 * - a slice whose answer is refused or cut short is asked for in two halves,
 *   and that decision is remembered;
 * - a slice that failed is asked for once more before the run gives up;
 * - and so is the root call, the one question every slice's answer depends on.
 *
 * docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md
 * § Stage 1a, and § The plan review (F3, F4). No network: `streamMessage` is
 * the fake of tests/helpers/slice-model.ts.
 */
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

const { halvingCut, HALVE_MIN_BLOCKS, ROOT_CALL_CAP_MS, runSlices, seamsHeld, SLICE_CALL_CAP_MS } = await import("../src/structure-slices.js");
const { buildTree, canonicalWholeDocumentRequest, estimateStructureTokens, generateStructure, parseWholeDocumentAnswer, questionFor, wholeDocumentRequest, STRUCTURE_HEADROOM } = await import("../src/structure.js");
const { assertTreeSound } = await import("../src/tree-invariants.js");
const { heading, paragraphs } = await import("./helpers/bounded-tree.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");

const deps = { request: (blocks: Block[]) => ({ ...wholeDocumentRequest(blocks), answerTokens: estimateStructureTokens(blocks) }), headroom: STRUCTURE_HEADROOM, parse: parseWholeDocumentAnswer, build: buildTree, canonical: canonicalWholeDocumentRequest, question: questionFor };
const SLUG = "second-pass";
/** Two slices of 300: `A` is blocks 0 to 299 and `B` the rest. */
const body = paragraphs(600);
const at = new Map(body.map((b, i) => [b.id, i]));
const checkpoints = () => memoryCheckpoints({ articleId: SLUG, slug: SLUG });
const bounded = (blocks: Block[]) => buildTree({
  title: "Title", gist: "The document has two parts.", range: [blocks[0]!.id, blocks.at(-1)!.id],
  children: [0, Math.floor(blocks.length / 2)].map((start, i) => ({
    title: `Part ${i}`, gist: `Part ${i} develops an argument.`,
    range: [blocks[start]!.id, blocks[i === 0 ? Math.floor(blocks.length / 2) - 1 : blocks.length - 1]!.id] as [string, string],
  })),
}, {}, blocks, SLUG);
const run = (over: Partial<Parameters<typeof runSlices>[0]> = {}) => {
  const blocks = over.body ?? body;
  return runSlices({ body: blocks, slug: SLUG, bounded: bounded(blocks), power: "standard", checkpoints: checkpoints(), deps, deadline: Infinity, ...over });
};

/** Is this the call for exactly blocks `lo` to `lo + size - 1`? */
const is = (call: Call, lo: number, size: number): boolean => !call.root && at.get(call.ids[0]!) === lo && call.ids.length === size;
const asked = (lo: number, size: number): Call[] => calls.filter((c) => is(c, lo, size));
const good = (call: Call): string => (call.root ? ROOT_ANSWER : sectionsAnswer(call.ids, 100));
const hang = (call: Call): Promise<never> =>
  new Promise((_, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))));
const cutShort = (call: Call) => messageOf(sectionsAnswer(call.ids), "max_tokens");
/** Calls whose message came back, whatever was made of it: each one's usage is spent. */
let answered = 0;
const counting = (inner: (call: Call) => unknown) => async (call: Call) => {
  const out = await inner(call);
  answered += 1;
  return out;
};
/** The final build the caller makes, and its two checks. */
const builds = (out: Awaited<ReturnType<typeof run>>, blocks: Block[] = body): boolean => {
  if (!out.ok) return false;
  const tree = buildTree(out.proposal, {}, blocks, SLUG);
  assertTreeSound(blocks, tree);
  return seamsHeld(tree, out.sections, out.seams);
};

beforeEach(() => { calls = []; respond = good; answered = 0; });
afterEach(() => { vi.useRealTimers(); });

describe("where a slice is cut in two", () => {
  it("is the middle block when no heading is near it, and nowhere under the minimum size", () => {
    expect(halvingCut(body, { lo: 0, hi: 299 })).toBe(150);
    expect(halvingCut(body, { lo: 300, hi: 599 })).toBe(450);
    expect(halvingCut(body, { lo: 0, hi: HALVE_MIN_BLOCKS - 1 })).toBe(HALVE_MIN_BLOCKS / 2);
    expect(halvingCut(body, { lo: 0, hi: HALVE_MIN_BLOCKS - 2 })).toBeNull();
  });
  it("is the heading nearest the middle, when one is within a quarter of the slice of it", () => {
    const withHeadings = [...body];
    for (const i of [20, 120, 190]) withHeadings[i] = heading(`Heading ${i}`, 2);
    expect(halvingCut(withHeadings, { lo: 0, hi: 299 })).toBe(120);
    /* One at block 20 alone is too far from the middle to be worth cutting at. */
    const far = [...body];
    far[20] = heading("Far", 2);
    expect(halvingCut(far, { lo: 0, hi: 299 })).toBe(150);
  });
  it("is never one block after a heading, which the final build would move", () => {
    const run2 = [...body];
    run2[148] = heading("A part", 1);
    run2[149] = heading("Its first chapter", 2);
    expect(halvingCut(run2, { lo: 0, hi: 299 })).toBe(148);
    const before = [...body];
    before[149] = heading("Just before the middle", 2);
    expect(halvingCut(before, { lo: 0, hi: 299 })).toBe(149);
  });
  it("does not snap outside the central band across a long run of headings", () => {
    const consecutive = [...body];
    for (let i = 0; i <= 150; i++) consecutive[i] = { ...body[i]!, kind: "heading", level: 2 };
    expect(halvingCut(consecutive, { lo: 0, hi: 299 })).toBeNull();
  });
});

describe("a refill that fails keeps the section it was meant to divide", () => {
  /** A's answer is two undivided sections, of 130 and 170 blocks; each is asked for again. */
  const undivided = (refill: (call: Call) => unknown) =>
    counting((call) => {
      if (call.root) return ROOT_ANSWER;
      if (is(call, 0, 300)) return sectionsAnswer(call.ids, 130, true);
      if (call.ids.length === 300) return good(call);
      return refill(call);
    });
  const faults: [string, (call: Call) => unknown][] = [
    ["its call does not come back", () => { throw new Error("the refill call failed"); }],
    ["its answer is refused", (call) => messageOf(sectionsAnswer(call.ids), "refusal")],
    ["its answer is cut short", cutShort],
    ["its answer does not pass", () => ROOT_ONLY],
  ];
  for (const [name, fault] of faults) {
    it(`when ${name}`, async () => {
      respond = undivided(fault);
      const out = await run();
      expect(out).toMatchObject({ ok: true, refilled: 0, secondPass: 0, sections: 5 });
      expect([asked(0, 130), asked(130, 170)].map((c) => c.length), "each refill is asked for once").toEqual([1, 1]);
      expect(calls.filter((c) => c.root)).toHaveLength(1);
      if (!out.ok) return;
      const kept = out.proposal.children!.slice(0, 2);
      expect(kept.map((s) => [at.get(s.range[0]), at.get(s.range[1]), s.children])).toEqual([[0, 129, undefined], [130, 299, undefined]]);
      expect(builds(out)).toBe(true);
      /* Two slices, two refills and the root, each counted; each answer that came back was paid for. */
      expect(out.spend.calls).toBe(5);
      expect(out.spend.usage.input_tokens).toBe(answered * USAGE.input_tokens);
    });
  }

  it("when it runs past its own time cap, and the root is still asked", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = undivided(hang);
    const going = run();
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    const out = await going;
    expect(out).toMatchObject({ ok: true, refilled: 0, sections: 5 });
    expect(asked(0, 130)[0]!.signal.aborted).toBe(true);
    expect(out.spend.calls).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("and a good refill arriving after its cap is saved, and not used in this run", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    const store = checkpoints();
    respond = undivided(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (is(call, 0, 130)) vi.setSystemTime(Date.now() + SLICE_CALL_CAP_MS);
      return sectionsAnswer(call.ids, 50);
    });
    const going = run({ checkpoints: store });
    await vi.advanceTimersByTimeAsync(10);
    const out = await going;
    /* The clock passed both refills' caps while they were out, so neither is used. */
    expect(out).toMatchObject({ ok: true, refilled: 0, sections: 5 });
    /* Two slices, both refills and the root. */
    expect(store.entries.size).toBe(5);
    expect(out.spend.usage.input_tokens).toBe(5 * USAGE.input_tokens);
  });
});

describe("a slice whose answer is refused or cut short is asked for in two halves", () => {
  for (const stop of ["refusal", "max_tokens"]) {
    it(`(${stop}) and both halves' sections are used, with a seam at the cut`, async () => {
      const store = checkpoints();
      respond = (call) => (is(call, 0, 300) ? messageOf(sectionsAnswer(call.ids), stop) : good(call));
      const out = await run({ checkpoints: store });
      expect(out).toMatchObject({ ok: true, secondPass: 0, reasked: 0 });
      expect([asked(0, 300), asked(0, 150), asked(150, 150), asked(300, 300)].map((c) => c.length)).toEqual([1, 1, 1, 1]);
      expect(out.ok && out.seams.map((id) => at.get(id)).sort((a, b) => a! - b!)).toEqual([150, 300]);
      expect(builds(out)).toBe(true);
      /* The refused answer was paid for too: five calls with the root. */
      expect(out.spend.calls).toBe(5);
      expect(out.spend.usage).toEqual({ input_tokens: 5 * USAGE.input_tokens, output_tokens: 5 * USAGE.output_tokens });
      /* A later run reads the halves back and never asks for the refused whole. */
      calls = [];
      const again = await run({ checkpoints: store });
      expect(again).toMatchObject({ ok: true, spend: { calls: 0 } });
      expect(calls).toHaveLength(0);
      expect(again.ok && out.ok && again.seams).toEqual(out.ok && out.seams);
    });
  }

  it("and a seam that is missing from the final build is still caught", async () => {
    respond = (call) => (is(call, 0, 300) ? cutShort(call) : good(call));
    const out = await run();
    if (!out.ok) throw new Error("expected a proposal");
    const tree = buildTree(out.proposal, {}, body, SLUG);
    expect(seamsHeld(tree, out.sections, out.seams)).toBe(true);
    expect(seamsHeld(tree, out.sections, [...out.seams, body[151]!.id])).toBe(false);
  });

  it("with one bad half the run fails, and the next run asks for the halves and never the whole", async () => {
    const store = checkpoints();
    respond = (call) => {
      if (is(call, 0, 300)) return cutShort(call);
      if (is(call, 150, 150)) return ROOT_ONLY;
      return good(call);
    };
    const out = await run({ checkpoints: store });
    expect(out).toMatchObject({ ok: false, failure: "slice-failed", secondPass: 1 });
    /* The whole once; the good half once; the bad half in each pass; no root. */
    expect([asked(0, 300), asked(0, 150), asked(150, 150), asked(300, 300)].map((c) => c.length)).toEqual([1, 1, 2, 1]);
    expect(calls.some((c) => c.root)).toBe(false);
    expect(out.spend.calls).toBe(5);
    expect(out.spend.usage.input_tokens).toBe(5 * USAGE.input_tokens);

    calls = [];
    respond = (call) => {
      if (is(call, 0, 300)) throw new Error("the refused slice was asked for again");
      return good(call);
    };
    const next = await run({ checkpoints: store });
    expect(next).toMatchObject({ ok: true, secondPass: 0 });
    expect(calls.map((c) => (c.root ? "root" : [at.get(c.ids[0]!), c.ids.length]))).toEqual([[150, 150], "root"]);
    expect(builds(next)).toBe(true);
  });

  it("but not under the minimum size, where it is the failure it was", async () => {
    const small = paragraphs(12);
    respond = (call) => (!call.root && call.ids[0] === small[0]!.id ? cutShort(call) : sectionsAnswer(call.ids, 3));
    const store = checkpoints();
    const out = await run({ body: small, checkpoints: store });
    expect(out).toMatchObject({ ok: false, failure: "slice-failed", secondPass: 0 });
    /* No halves, and no second ask of a request that would be cut short again. */
    expect(calls).toHaveLength(2);
    expect(out.spend.calls).toBe(2);
    expect(store.entries.size, "only the good slice is stored: nothing says to halve a slice this small").toBe(1);
  });

  it("a half is not cut in two again", async () => {
    respond = (call) => (is(call, 0, 300) || is(call, 0, 150) ? cutShort(call) : good(call));
    const out = await run();
    expect(out).toMatchObject({ ok: false, failure: "slice-failed" });
    expect(calls.filter((c) => !c.root && c.ids.length < 150)).toHaveLength(0);
    expect(asked(0, 150), "a half cut short is not asked for again either").toHaveLength(1);
  });

  it("a timeout during the halving starts nothing further and is out of time", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = (call) => {
      if (is(call, 0, 300)) return cutShort(call);
      if (is(call, 0, 150)) return hang(call);
      return good(call);
    };
    const going = run();
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time", secondPass: 0 });
    expect(asked(150, 150), "the second half was started after the first ran out of time").toHaveLength(0);
    expect(calls).toHaveLength(3);
    expect(out.spend.calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a first half is started only if the second half and the root would still fit after it", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = (call) => (is(call, 0, 300) ? cutShort(call) : good(call));
    /* Room for one slice call and the root, and not for two. */
    const out = await run({ deadline: Date.now() + SLICE_CALL_CAP_MS + ROOT_CALL_CAP_MS });
    expect(out).toMatchObject({ ok: false, failure: "out-of-time" });
    expect(calls).toHaveLength(2);
  });
});

describe("a slice that failed is asked for once more before the run gives up", () => {
  it("and one that fails once gives a finished tree, with exactly one extra call", async () => {
    let failed = 0;
    respond = counting((call) => {
      if (is(call, 0, 300) && failed++ === 0) throw new Error("the call did not come back");
      return good(call);
    });
    const out = await run();
    expect(out).toMatchObject({ ok: true, secondPass: 1, reasked: 0 });
    expect([asked(0, 300), asked(300, 300)].map((c) => c.length), "a slice in hand is not asked for again").toEqual([2, 1]);
    expect(calls).toHaveLength(4);
    expect(out.spend.calls).toBe(4);
    expect(out.spend.usage.input_tokens).toBe(3 * USAGE.input_tokens);
    expect(builds(out)).toBe(true);
  });

  it("and one whose answer failed twice is asked a third time, once", async () => {
    respond = (call) => (is(call, 0, 300) && asked(0, 300).length <= 2 ? ROOT_ONLY : good(call));
    const out = await run();
    expect(out).toMatchObject({ ok: true, secondPass: 1, reasked: 1 });
    expect(asked(0, 300)).toHaveLength(3);
    expect(out.spend.calls).toBe(5);
  });

  it("and the tree says so, through `generateStructure`", async () => {
    const long = paragraphs(3000);
    let failed = 0;
    respond = (call) => {
      if (!call.root && call.ids[0] === long[0]!.id && failed++ === 0) throw new Error("the call did not come back");
      return call.root ? ROOT_ANSWER : sectionsAnswer(call.ids);
    };
    const out = await generateStructure({ power: "standard", blocks: long, slug: SLUG, articleTitle: "A long piece", checkpoints: checkpoints() });
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 1, rootAskedTwice: false });
    expect(out.wholeDocumentCalls).toBe(5);
  }, 60_000);

  it("and one that fails in both passes is the failure", async () => {
    respond = (call) => {
      if (is(call, 0, 300)) throw new Error("the call did not come back");
      return good(call);
    };
    const out = await run();
    expect(out).toMatchObject({ ok: false, failure: "slice-failed", secondPass: 1 });
    expect([asked(0, 300), asked(300, 300)].map((c) => c.length)).toEqual([2, 1]);
    expect(calls.some((c) => c.root)).toBe(false);
    expect(out.spend.calls).toBe(3);
    expect(out.spend.usage.input_tokens).toBe(USAGE.input_tokens);
  });

  it("counts every transport attempt of the second ask", async () => {
    respond = (call) => {
      if (is(call, 0, 300)) {
        call.attempts = 3;
        if (asked(0, 300).length === 1) throw new Error("three attempts, none came back");
      }
      return good(call);
    };
    const out = await run();
    expect(out).toMatchObject({ ok: true, secondPass: 1 });
    expect(out.spend.calls).toBe(3 + 3 + 1 + 1);
  });

  it("is skipped, not started and killed, when its cap would not fit before the deadline", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = async (call) => {
      if (is(call, 0, 300)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        throw new Error("the call did not come back");
      }
      return good(call);
    };
    /* Room for a slice call and the root at the start, and not a second later. */
    const going = run({ deadline: Date.now() + SLICE_CALL_CAP_MS + ROOT_CALL_CAP_MS + 500 });
    await vi.advanceTimersByTimeAsync(1000);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time", secondPass: 0 });
    expect(calls).toHaveLength(2);
    expect(out.spend.calls).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is not run at all once a first-pass call has run out of time", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = (call) => {
      if (is(call, 0, 300)) throw new Error("the call did not come back");
      if (is(call, 300, 300)) return hang(call);
      return good(call);
    };
    const going = run();
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time", secondPass: 0 });
    expect(calls).toHaveLength(2);
  });

  it("counts only slices admitted in the second pass when a final failure stops queued peers", async () => {
    const blocks = paragraphs(1000);
    const tree = buildTree({
      title: "Ten parts", gist: "The document has ten parts.", range: [blocks[0]!.id, blocks.at(-1)!.id],
      children: Array.from({ length: 10 }, (_, i) => ({
        title: `Part ${i}`, gist: "This part develops an argument.",
        range: [blocks[i * 100]!.id, blocks[i * 100 + 99]!.id] as [string, string],
      })),
    }, {}, blocks, SLUG);
    respond = () => { throw new Error("the call did not come back"); };
    const out = await run({ body: blocks, bounded: tree, deps: { ...deps, request: (on) => {
      if (on.length > 100) throw new Error("too long for this test's call");
      return deps.request(on);
    } } });
    expect(out).toMatchObject({ ok: false, failure: "slice-failed", slices: 10, secondPass: 8 });
    expect(calls, "ten first-pass calls and eight second-pass calls; queued peers never start").toHaveLength(18);
    expect(out.spend.calls).toBe(18);
  });

  it("a good answer that arrives after a peer has failed for good is still saved, and waited for", async () => {
    const store = checkpoints();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    respond = async (call) => {
      if (is(call, 0, 300)) throw new Error("the call did not come back");
      /* B fails its first pass on two answers that do not pass; its second-pass answer is good and slow. */
      if (asked(300, 300).length <= 2) return ROOT_ONLY;
      await gate;
      return good(call);
    };
    let returned = false;
    const going = run({ checkpoints: store }).then((out) => { returned = true; return out; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect([asked(0, 300), asked(300, 300)].map((c) => c.length)).toEqual([2, 3]);
    expect(returned, "returned while a paid call was still out").toBe(false);
    expect(store.entries.size).toBe(0);
    release();
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "slice-failed", secondPass: 2 });
    expect(store.entries.size, "the late good answer was not kept").toBe(1);
    expect(out.spend.calls).toBe(5);
  });

  it("a reader's Stop during the second pass throws, and nothing further is asked", async () => {
    const stop = new AbortController();
    respond = (call) => {
      if (!is(call, 0, 300)) return good(call);
      if (asked(0, 300).length === 1) throw new Error("the call did not come back");
      return hang(call);
    };
    const going = run({ signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls).toHaveLength(3);
    stop.abort();
    await expect(going).rejects.toThrow();
    expect(calls).toHaveLength(3);
    expect(calls.some((c) => c.root)).toBe(false);
  });

  it("a reader's Stop during the first pass is not answered with a second pass", async () => {
    const stop = new AbortController();
    respond = (call) => (is(call, 0, 300) ? hang(call) : good(call));
    const going = run({ signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop.abort();
    await expect(going).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });
});

describe("a failed root call is asked for once more in the same run", () => {
  const roots = (): Call[] => calls.filter((c) => c.root);
  /** A root answer that parses and does not pass: its gist is empty. */
  const BAD_ROOT = JSON.stringify({ gist: "", question: "Ownership — why does it keep failing?" });
  const slicesOnce = (): void =>
    expect([asked(0, 300), asked(300, 300)].map((c) => c.length), "a slice in hand is not asked for again").toEqual([1, 1]);

  it("and one that does not come back once gives a finished tree, with exactly one extra call", async () => {
    const store = checkpoints();
    respond = counting((call) => {
      if (call.root && roots().length === 1) throw new Error("the root call did not come back");
      return good(call);
    });
    const out = await run({ checkpoints: store });
    expect(out).toMatchObject({ ok: true, rootAskedTwice: true, secondPass: 0, reasked: 0 });
    expect(roots()).toHaveLength(2);
    slicesOnce();
    expect(calls).toHaveLength(4);
    expect(out.spend.calls).toBe(4);
    /* The call that did not come back has no usage to read; the three that did are counted. */
    expect(out.spend.usage.input_tokens).toBe(3 * USAGE.input_tokens);
    expect(builds(out)).toBe(true);
    /* The second answer is the one stored: a later run buys nothing. */
    calls = [];
    expect(await run({ checkpoints: store })).toMatchObject({ ok: true, rootAskedTwice: false, spend: { calls: 0 } });
    expect(calls).toHaveLength(0);
  });

  it("and one whose answer did not pass twice is asked a third time, once, and every answer is paid for", async () => {
    respond = counting((call) => (call.root && roots().length <= 2 ? BAD_ROOT : good(call)));
    const out = await run();
    expect(out).toMatchObject({ ok: true, rootAskedTwice: true, reasked: 1 });
    expect(roots()).toHaveLength(3);
    slicesOnce();
    expect(out.spend.calls).toBe(5);
    expect(out.spend.usage).toEqual({ input_tokens: 5 * USAGE.input_tokens, output_tokens: 5 * USAGE.output_tokens });
  });

  it("and one that fails on its second chance too is the failure, with no fourth call", async () => {
    respond = counting((call) => (call.root ? BAD_ROOT : good(call)));
    const bad = await run();
    expect(bad).toMatchObject({ ok: false, failure: "root-call-failed", rootAskedTwice: true, reasked: 1 });
    expect(roots(), "two with the re-ask, and the second chance is one call").toHaveLength(3);
    expect(bad.spend.usage.input_tokens).toBe(5 * USAGE.input_tokens);

    calls = [];
    respond = (call) => {
      if (call.root) throw new Error("the root call did not come back");
      return good(call);
    };
    const gone = await run();
    expect(gone).toMatchObject({ ok: false, failure: "root-call-failed", rootAskedTwice: true });
    expect(roots()).toHaveLength(2);
    slicesOnce();
    expect(gone.spend.calls).toBe(4);
  });

  it("counts every transport attempt of both root asks", async () => {
    respond = (call) => {
      if (call.root) {
        call.attempts = 3;
        if (roots().length === 1) throw new Error("three attempts, none came back");
      }
      return good(call);
    };
    const out = await run();
    expect(out).toMatchObject({ ok: true, rootAskedTwice: true });
    expect(out.spend.calls).toBe(1 + 1 + 3 + 3);
  });

  for (const stop of ["refusal", "max_tokens"]) {
    it(`(${stop}) a refused or cut-short root answer is not asked for again`, async () => {
      respond = counting((call) => (call.root ? messageOf(ROOT_ANSWER, stop) : good(call)));
      const store = checkpoints();
      const out = await run({ checkpoints: store });
      expect(out).toMatchObject({ ok: false, failure: "root-call-failed", rootAskedTwice: false });
      expect(roots()).toHaveLength(1);
      /* Two slices and the root, once each. A fourth would be a second ask
         begun and then stopped by the run having ended, which looks the same
         from the calls alone. */
      expect(store.calls.reads, "a second ask of the root was begun").toBe(3);
      expect(out.spend.usage.input_tokens, "the refused answer was paid for").toBe(3 * USAGE.input_tokens);
    });
  }

  it("a root call that runs past its cap is out of time, and is not asked for again", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    respond = (call) => (call.root ? hang(call) : good(call));
    const going = run();
    await vi.advanceTimersByTimeAsync(ROOT_CALL_CAP_MS);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time", rootAskedTwice: false });
    expect(roots()).toHaveLength(1);
    expect(roots()[0]!.signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("is skipped, not started and killed, when its cap would not fit before the deadline", async () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    /* Every call ends inside its own cap: the slices after 200 s, the root's first ask after 50 s. */
    respond = async (call) => {
      await new Promise((resolve) => setTimeout(resolve, call.root ? 50_000 : 200_000));
      if (call.root) throw new Error("the root call did not come back");
      return good(call);
    };
    /* Room for the slices and then the root's cap, with 100 s over when the
       root is first asked and 50 s when it has failed: less than its cap. */
    const going = run({ deadline: Date.now() + SLICE_CALL_CAP_MS + ROOT_CALL_CAP_MS + 500 });
    await vi.advanceTimersByTimeAsync(250_000);
    const out = await going;
    expect(out).toMatchObject({ ok: false, failure: "out-of-time", rootAskedTwice: false });
    expect(roots()).toHaveLength(1);
    expect(out.spend.calls).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a reader's Stop during the first root call throws, and no second is started", async () => {
    const stop = new AbortController();
    respond = (call) => (call.root ? hang(call) : good(call));
    const going = run({ signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(roots()).toHaveLength(1);
    stop.abort();
    await expect(going).rejects.toThrow();
    expect(roots()).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("a reader's Stop between the two root asks throws, and no second is started", async () => {
    const stop = new AbortController();
    respond = (call) => {
      if (!call.root) return good(call);
      stop.abort();
      throw new Error("the root call did not come back");
    };
    await expect(run({ signal: stop.signal })).rejects.toThrow();
    expect(roots()).toHaveLength(1);
  });

  it("and the tree says so, through `generateStructure`", async () => {
    const long = paragraphs(3000);
    let rootCalls = 0;
    respond = (call) => {
      if (!call.root) return sectionsAnswer(call.ids);
      if (rootCalls++ === 0) throw new Error("the root call did not come back");
      return ROOT_ANSWER;
    };
    const out = await generateStructure({ power: "standard", blocks: long, slug: SLUG, articleTitle: "A long piece", checkpoints: checkpoints() });
    expect(out.source).toEqual({ by: "slices", slices: 3, refilled: 0, reasked: 0, secondPass: 0, rootAskedTwice: true });
    expect(out.wholeDocumentCalls).toBe(5);
  }, 60_000);
});
