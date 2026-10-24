/**
 * **A citation's *Does it say that?* as a thread origin, without a database**
 * — plan docs/plans/261024m-citation-card-streams-a-note-on-what-this-paragraph-cites-the-work-for.md,
 * stage 1. The pure halves: the identity (`sameOrigin`), its columns both ways,
 * `withTurn`'s refusal of a second chat for one work and paragraph,
 * `withEdit`'s refusal of the first question, what the server rebuilds the
 * question from (`citeCheckQuestion`), and the allowance an automatic start
 * takes (`admitCiteCheck`). The route, the store and the database are
 * tests/chat-origin-route.test.ts § a citation's Does it say that?.
 */
import { describe, expect, it } from "vitest";

import { titleFromOrigin } from "../src/chat-title.js";
import { askDoesItSayThatAboutBlock } from "../src/chat-question.js";
import { ChatConflict, CiteCheckExists, withEdit, withTurn } from "../src/chat.js";
import {
  admitCiteCheck,
  CITE_CHECK_RATE_POLICY,
  CiteCheckCapped,
  citeCheckQuestion,
  CiteCheckStale,
  settleCiteCheckLease,
} from "../src/cite-check.js";
import { CITE_CHECK_DAY, CITE_CHECK_HOUR } from "../src/messages.js";
import type { AllowanceTaken, RateBucket } from "../src/store/contracts.js";
import { originColumns, originFromColumns } from "../src/thread-origin.js";
import type { Bibliography, CitedWork, CiteCheckOrigin, ThreadOrigin } from "../src/types.js";
import { sameOrigin } from "../src/types.js";
import { SOURCE_CITE_CHECK, threadSource } from "../src/web/thread-source.js";

const ID = "spya-rgn222";
const OTHER_ID = "spya-rgn333";
const AT = "2026-10-24T10:00:00.000Z";
const WORK = "spya-wrk222";
const BLOCK = "spya-bbbbbb";
const OTHER_BLOCK = "spya-cccccc";
const CHECK: CiteCheckOrigin = { mode: "cite-check", itemId: WORK, blockId: BLOCK, quote: "Attention Is All You Need" };

describe("the cite-check identity", () => {
  it("is the work and the paragraph, and not the title snapshot", () => {
    expect(sameOrigin(CHECK, { ...CHECK, quote: "Attention, reworded" })).toBe(true);
    expect(sameOrigin(CHECK, { ...CHECK, blockId: OTHER_BLOCK })).toBe(false);
    expect(sameOrigin(CHECK, { ...CHECK, itemId: "spya-wrk333" })).toBe(false);
    /* The work's own *Ask in chat* shares the id and is another conversation. */
    expect(sameOrigin(CHECK, { mode: "bibliography", itemId: WORK, quote: CHECK.quote })).toBe(false);
    expect(sameOrigin({ mode: "bibliography", itemId: WORK, quote: CHECK.quote }, CHECK)).toBe(false);
  });

  it("round-trips through the seven columns, and a half row reads as no origin", () => {
    const columns = originColumns(CHECK);
    expect(columns).toEqual({
      originMode: "cite-check",
      originItemId: WORK,
      originBlockId: BLOCK,
      originQuote: CHECK.quote,
      originLens: null,
      originBatchId: null,
      originAttemptId: null,
    });
    expect(originFromColumns(columns)).toEqual({ origin: CHECK });
    expect(originFromColumns({ ...columns, originBlockId: null })).toEqual({});
    expect(originFromColumns({ ...columns, originItemId: null })).toEqual({});
    expect(originFromColumns({ ...columns, originLens: "an angle" })).toEqual({});
  });

  it("is titled after the work and labelled as a citation's check in Chat's list", () => {
    expect(titleFromOrigin(CHECK)).toBe("Does it say that? Attention Is All You Need");
    expect(threadSource({ kind: "chat", origin: CHECK, anchor: { blockId: BLOCK } })).toMatchObject({
      from: "sources",
      label: SOURCE_CITE_CHECK,
      quote: CHECK.quote,
    });
  });
});

describe("withTurn and a cite-check", () => {
  const question = "About block bbbbbb:\n\nDoes this work say…";

  it("refuses a second chat for one work and paragraph, with the first one's id", () => {
    const first = withTurn([], { threadId: ID, question, origin: CHECK, anchor: { blockId: BLOCK } }, AT);
    let thrown: unknown;
    try {
      withTurn(first.threads, { threadId: OTHER_ID, question, origin: { ...CHECK }, anchor: { blockId: BLOCK } }, AT);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CiteCheckExists);
    expect(thrown).toBeInstanceOf(ChatConflict);
    expect((thrown as CiteCheckExists).threadId).toBe(first.thread.id);
    expect((thrown as CiteCheckExists).status).toBe(409);
  });

  it("refuses the same first turn resent under the same id, rather than paying for a second question", () => {
    const first = withTurn([], { threadId: ID, question, origin: CHECK, anchor: { blockId: BLOCK } }, AT);
    expect(() =>
      withTurn(first.threads, { threadId: ID, question, origin: CHECK, anchor: { blockId: BLOCK } }, AT),
    ).toThrow(CiteCheckExists);
  });

  it("lets the same work in another paragraph start its own, and a follow-up carry none", () => {
    const first = withTurn([], { threadId: ID, question, origin: CHECK, anchor: { blockId: BLOCK } }, AT);
    const other: ThreadOrigin = { ...CHECK, blockId: OTHER_BLOCK };
    const second = withTurn(first.threads, { threadId: OTHER_ID, question, origin: other }, AT);
    expect(second.threads).toHaveLength(2);
    const follow = withTurn(second.threads, { threadId: ID, question: "And the abstract?" }, AT);
    expect(follow.thread.messages).toHaveLength(4);
    expect(follow.thread.origin).toEqual(CHECK);
  });

  it("refuses an edit of the first question and allows one of a later question", () => {
    const first = withTurn([], { threadId: ID, question, origin: CHECK, anchor: { blockId: BLOCK } }, AT);
    const firstQuestion = first.user.id;
    const done = first.threads.map((t) => ({
      ...t,
      messages: t.messages.map((m) => (m.status === "pending" ? { ...m, status: "done" as const, text: "yes" } : m)),
    }));
    expect(() => withEdit(done, first.thread.id, firstQuestion, "Something else?", AT)).toThrow(ChatConflict);
    const follow = withTurn(done, { threadId: ID, question: "And the abstract?" }, AT);
    expect(() => withEdit(follow.threads, ID, follow.user.id, "And the conclusion?", AT)).not.toThrow();
  });

  it("still lets a bibliography item's first question be edited", () => {
    const item: ThreadOrigin = { mode: "bibliography", itemId: WORK, quote: CHECK.quote };
    const first = withTurn([], { threadId: ID, question: "About this work…", origin: item }, AT);
    expect(() => withEdit(first.threads, ID, first.user.id, "About it again", AT)).not.toThrow();
  });
});

function work(over: Partial<CitedWork> = {}): CitedWork {
  return {
    id: WORK,
    key: `work:${WORK}`,
    title: "Attention Is All You Need",
    authors: "Vaswani et al.",
    year: "2017",
    why: "The architecture the piece builds on.",
    mentions: [],
    citedAt: [BLOCK],
    firstCited: BLOCK,
    citedInBody: true,
    url: "https://arxiv.org/abs/1706.03762",
    linkFrom: "arxiv",
    ...over,
  };
}

function found(citations: CitedWork[], stale = false): { bibliography: Bibliography; stale: boolean } {
  return {
    bibliography: {
      version: "citations/7",
      generator: "test",
      slug: "x",
      sourceHash: "h",
      citations,
      capped: false,
      generatedAt: AT,
      elapsedMs: 1,
    },
    stale,
  };
}

const BLOCKS = [{ id: BLOCK }, { id: OTHER_BLOCK }];

describe("citeCheckQuestion: what the server rebuilds the first question from", () => {
  it("is the press's own question for the stored work and the block", () => {
    expect(citeCheckQuestion(found([work()]), BLOCKS, CHECK)).toBe(askDoesItSayThatAboutBlock(work(), BLOCK));
  });

  it("refuses a title snapshot that does not name the stored work", () => {
    expect(() =>
      citeCheckQuestion(found([work()]), BLOCKS, { ...CHECK, quote: "Something the client made up" }),
    ).toThrow(CiteCheckStale);
  });

  it.each<[string, ReturnType<typeof found> | null, readonly { id: string }[]]>([
    ["no list at all", null, BLOCKS],
    ["a stale list", found([work()], true), BLOCKS],
    ["a list without the work", found([work({ id: "spya-wrk333" })]), BLOCKS],
    ["a block the article no longer has", found([work()]), [{ id: OTHER_BLOCK }]],
    ["a block that does not cite the work", found([work({ citedAt: [OTHER_BLOCK] })]), BLOCKS],
  ])("refuses %s as stale", (_name, list, blocks) => {
    expect(() => citeCheckQuestion(list, blocks, CHECK)).toThrow(CiteCheckStale);
  });
});

/** An allowance that answers what it is told to and records every call. */
function allowance(answer: AllowanceTaken) {
  const calls: string[] = [];
  return {
    calls,
    async take(bucket: RateBucket) {
      calls.push(`take:${bucket}`);
      return answer;
    },
    async finish(id: string) {
      calls.push(`finish:${id}`);
    },
    async cancel(id: string) {
      calls.push(`cancel:${id}`);
    },
  };
}

describe("admitCiteCheck: the allowance an automatic start takes", () => {
  it("takes from its own bucket and frees the slot once, keeping the fill", async () => {
    const a = allowance({ kind: "allowed", id: "lease-1" });
    const lease = await admitCiteCheck(a);
    await lease.release();
    await lease.release();
    await lease.refund();
    expect(a.calls).toEqual(["take:cite-check", "finish:lease-1"]);
  });

  it("refunds a refused turn once, deleting the fill", async () => {
    const a = allowance({ kind: "allowed", id: "lease-2" });
    const lease = await admitCiteCheck(a);
    await lease.refund();
    await lease.release();
    expect(a.calls).toEqual(["take:cite-check", "cancel:lease-2"]);
  });

  it("refunds a turn that failed before its model call, and keeps one that reached it", async () => {
    const before = allowance({ kind: "allowed", id: "lease-before-model" });
    const beforeLease = await admitCiteCheck(before);
    await settleCiteCheckLease(beforeLease, false);
    await settleCiteCheckLease(beforeLease, true);
    expect(before.calls).toEqual(["take:cite-check", "cancel:lease-before-model"]);

    const after = allowance({ kind: "allowed", id: "lease-after-model" });
    const afterLease = await admitCiteCheck(after);
    await settleCiteCheckLease(afterLease, true);
    await settleCiteCheckLease(afterLease, false);
    expect(after.calls).toEqual(["take:cite-check", "finish:lease-after-model"]);
  });

  it.each<[AllowanceTaken, string, number]>([
    [{ kind: "rate", reason: "hour" }, "hour", 429],
    [{ kind: "rate", reason: "day" }, "day", 429],
    [{ kind: "concurrency" }, "busy", 429],
    [{ kind: "global" }, "global", 503],
  ])("refuses %j as %s with a %i", async (answer, reason, status) => {
    const err = await admitCiteCheck(allowance(answer)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CiteCheckCapped);
    expect(err).toMatchObject({ reason, status });
  });

  it("says the policy's own numbers to the reader", () => {
    expect(CITE_CHECK_RATE_POLICY).toMatchObject({ fills: 8, concurrency: 2, daily: { fills: 20, globalFills: 100 } });
    expect(CITE_CHECK_HOUR).toContain(`${CITE_CHECK_RATE_POLICY.fills} automatic checks`);
    expect(CITE_CHECK_DAY).toContain(`${CITE_CHECK_RATE_POLICY.daily?.fills} automatic checks`);
  });
});
