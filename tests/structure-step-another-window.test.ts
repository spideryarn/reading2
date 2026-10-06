/**
 * **Slices that run out of time ask for another lease window when the queue
 * has one to give, and only then.** src/structure.ts § `generateStructure`,
 * src/another-window.ts.
 * docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md
 * § "Plan: the rest of stage 1a", stage C.
 *
 * This file is the step on its own, with the model faked at `streamMessage`
 * (tests/helpers/slice-model.ts) and no queue. What the queue does with the
 * throw is tests/job-hands-back-for-another-window.test.ts.
 *
 * Watched red on 2026-10-06, before the throw was written: the three cases
 * that expect a hand-back got a finished run instead
 * (`promise resolved "{ …(26) }" instead of rejecting`). And two mutations of
 * the condition since: handing back on any failure reddens the two cases under
 * "only running out of time hands back"; ignoring `anotherAvailable` reddens
 * "return the headings tree, as before, when the budget is spent".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MessagesBody } from "../src/messages-stream.js";
import type { Block } from "../src/types.js";
import { askedIds, isRootCall, messageOf, ROOT_ANSWER, sectionsAnswer } from "./helpers/slice-model.js";

interface Call {
  n: number;
  root: boolean;
  ids: string[];
  signal: AbortSignal | undefined;
}
let calls: Call[] = [];
let respond: (call: Call) => unknown = () => "";

vi.mock("../src/messages-stream.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/messages-stream.js")>()),
  streamMessage: (_task: string, params: MessagesBody, options: { signal?: AbortSignal }) => {
    const call: Call = { n: calls.length, root: isRootCall(params), ids: askedIds(params), signal: options.signal };
    calls.push(call);
    return {
      onText: () => {},
      attempts: () => 1,
      finalMessage: async () => {
        const out = await respond(call);
        return typeof out === "string" ? messageOf(out) : out;
      },
    };
  },
}));

const { generateStructure } = await import("../src/structure.js");
const { NeedsAnotherWindow } = await import("../src/another-window.js");
const { ROOT_CALL_CAP_MS, SLICE_CALL_CAP_MS, SLICES_FINISH_RESERVE_MS } = await import("../src/structure-slices.js");
const { memoryCheckpoints } = await import("./helpers/memory-checkpoints.js");
const { expectBoundedTree, paragraphs } = await import("./helpers/bounded-tree.js");

const SLUG = "another-window";
/** Headingless and past the one-answer ceiling, so the slices path runs, in three slices. */
const BLOCKS: Block[] = paragraphs(3000);
const INDEX = new Map(BLOCKS.map((b, i) => [b.id, i]));
const T0 = 1_800_000_000_000;
/** The least a step may have left for one slice call and the root call after it. */
const JUST_ENOUGH = SLICES_FINISH_RESERVE_MS + SLICE_CALL_CAP_MS + ROOT_CALL_CAP_MS;

const FIRST = { number: 1, anotherAvailable: true };
const LAST = { number: 3, anotherAvailable: false };

const fresh = () => memoryCheckpoints({ slug: SLUG, articleId: "a-1" });
const run = (over: Partial<Parameters<typeof generateStructure>[0]> = {}) =>
  generateStructure({
    power: "standard",
    blocks: BLOCKS,
    slug: SLUG,
    articleTitle: "A long piece",
    checkpoints: fresh(),
    ...over,
  });

const answers = (call: Call): string => (call.root ? ROOT_ANSWER : sectionsAnswer(call.ids));
/** A call that never answers until its signal aborts. */
const hang = (call: Call): Promise<never> =>
  new Promise((_, reject) => {
    call.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
/** Is this the slice that touches neither end of the document? */
const isMiddle = (call: Call): boolean =>
  !call.root && INDEX.get(call.ids[0]!)! > 0 && INDEX.get(call.ids.at(-1)!)! < BLOCKS.length - 1;
const OUT_OF_TIME = { by: "headings", reason: "answer-too-long", slicesFailed: "out-of-time" };

beforeEach(() => {
  calls = [];
  respond = answers;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("slices out of time, with a further window available", () => {
  it("hand back and return no tree, when no call could be started", async () => {
    vi.useFakeTimers({ now: T0 });
    await expect(
      run({ stepBudgetMs: JUST_ENOUGH - 1, window: FIRST }),
      "the step finished on the headings tree with a window still to use",
    ).rejects.toBeInstanceOf(NeedsAnotherWindow);
    expect(calls).toHaveLength(0);
  });

  it("hand back with the answers bought kept, and the next window buys only what is missing", async () => {
    vi.useFakeTimers({ now: T0 });
    const checkpoints = fresh();
    respond = (call) => (isMiddle(call) ? hang(call) : answers(call));
    let settled: unknown;
    const going = run({ stepBudgetMs: 700_000, deadlineAt: T0 + 740_000, window: FIRST, checkpoints }).then(
      (out) => (settled = out),
      (err: unknown) => (settled = err),
    );
    /* Not before the hanging call's cap has passed: every call started must
       have settled, or its spend is outside the step's ledger. */
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS - 1);
    expect(settled, "handed back while a call was still out").toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await going;
    expect(settled, "the step finished on the headings tree with a window still to use").toBeInstanceOf(
      NeedsAnotherWindow,
    );
    expect(calls.filter((c) => !c.root)).toHaveLength(3);
    expect(calls.filter((c) => c.root)).toHaveLength(0);

    /* The second window: the two good slices are read back, not bought. */
    calls = [];
    respond = answers;
    const out = await run({
      stepBudgetMs: 700_000,
      deadlineAt: Date.now() + 740_000,
      window: { number: 2, anotherAvailable: true },
      checkpoints,
    });
    expect(out.source).toMatchObject({ by: "slices", slices: 3 });
    expect(calls.filter((c) => !c.root).map(isMiddle), "a slice already bought was bought again").toEqual([true]);
    expect(calls.filter((c) => c.root)).toHaveLength(1);
    expect(out.wholeDocumentCalls).toBe(2);
  });

  it("a root call past its cap hands back too: it is `out-of-time`, not `root-call-failed`", async () => {
    vi.useFakeTimers({ now: T0 });
    respond = (call) => (call.root ? hang(call) : answers(call));
    let settled: unknown;
    const going = run({ stepBudgetMs: 700_000, deadlineAt: T0 + 740_000, window: FIRST }).then(
      (out) => (settled = out),
      (err: unknown) => (settled = err),
    );
    await vi.advanceTimersByTimeAsync(ROOT_CALL_CAP_MS);
    await going;
    expect(settled).toBeInstanceOf(NeedsAnotherWindow);
  });
});

describe("slices out of time, with no further window", () => {
  it("return the headings tree, as before, when the budget is spent", async () => {
    vi.useFakeTimers({ now: T0 });
    const out = await run({ stepBudgetMs: JUST_ENOUGH - 1, window: LAST });
    expect(out.source).toEqual(OUT_OF_TIME);
    expectBoundedTree(BLOCKS, out.parts.tree);
  });

  it("return the headings tree, as before, when nobody said anything about windows", async () => {
    vi.useFakeTimers({ now: T0 });
    const out = await run({ stepBudgetMs: JUST_ENOUGH - 1 });
    expect(out.source).toEqual(OUT_OF_TIME);
    expectBoundedTree(BLOCKS, out.parts.tree);
  });

  it("a direct call with no deadline or window gives the headings tree after a call passes its cap", async () => {
    vi.useFakeTimers({ now: T0 });
    respond = (call) => (isMiddle(call) ? hang(call) : answers(call));
    const going = run();
    await vi.advanceTimersByTimeAsync(SLICE_CALL_CAP_MS);
    expect((await going).source).toEqual(OUT_OF_TIME);
  });

  it("a direct call with no deadline or window still finishes in slices", async () => {
    expect((await run()).source).toMatchObject({ by: "slices", slices: 3 });
  });
});

describe("only running out of time hands back", () => {
  it("a slice that fails in both passes is the headings tree, window or not", async () => {
    respond = (call) => {
      if (isMiddle(call)) throw new Error("the middle slice failed");
      return answers(call);
    };
    const out = await run({ stepBudgetMs: 700_000, deadlineAt: Date.now() + 740_000, window: FIRST });
    expect(out.source, "a failure a second window would only repeat was handed back").toEqual({
      by: "headings",
      reason: "answer-too-long",
      slicesFailed: "slice-failed",
    });
  });

  it("a root call that fails twice is the headings tree, window or not", async () => {
    respond = (call) => {
      if (call.root) throw new Error("the root call failed");
      return answers(call);
    };
    const out = await run({ stepBudgetMs: 700_000, deadlineAt: Date.now() + 740_000, window: FIRST });
    expect(out.source, "a failure a second window would only repeat was handed back").toEqual({
      by: "headings",
      reason: "answer-too-long",
      slicesFailed: "root-call-failed",
    });
  });

  it("a finished run with a window available is a finished run", async () => {
    const out = await run({ stepBudgetMs: 700_000, deadlineAt: Date.now() + 740_000, window: FIRST });
    expect(out.source).toMatchObject({ by: "slices", slices: 3 });
  });

  it("a reader's Stop is a cancellation and not a hand-back", async () => {
    vi.useFakeTimers({ now: T0 });
    const stop = new AbortController();
    respond = (call) => hang(call);
    let settled: unknown;
    const going = run({ stepBudgetMs: 700_000, deadlineAt: T0 + 740_000, window: FIRST, signal: stop.signal }).then(
      (out) => (settled = out),
      (err: unknown) => (settled = err),
    );
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await going;
    expect(settled).toBeInstanceOf(Error);
    expect(settled, "a Stop was turned into a request for more time").not.toBeInstanceOf(NeedsAnotherWindow);
  });
});
