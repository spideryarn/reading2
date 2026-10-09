/**
 * **Deleting a question and what follows it — the browser's half.**
 *
 * Report spya-mx423m; docs/plans/261009o-delete-a-chat-question-and-what-follows.md.
 * The server's half is tests/chat-delete-from-route.test.ts. This one asks the
 * reducer what a press draws, what its answer writes down, and — over every
 * order, because the bugs this machine was built to remove were orderings —
 * that a deleted row never comes back while the delete stands, and that a row
 * this tab added since is never taken with it (GPT Sol, plan review F2 and F7).
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import type { ChatEvent, ChatInput, ChatState, OpId } from "../src/web/chat/model.js";
import { asOpId, initialState } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
import { inEveryOrder, twice } from "./helpers/chat-reduce.js";

const SLUG = "a-piece";
const THREAD = "spya-t1";
const LOAD = asOpId("spya-load01");
const PRUNE = asOpId("spya-prun01");
const SEND = asOpId("spya-send01");
const DELETE = asOpId("spya-del001");
const LATE_LOAD = asOpId("spya-load02");

const T0 = "2026-10-09T10:00:00.000Z";
const T1 = "2026-10-09T10:01:00.000Z";
const T2 = "2026-10-09T10:02:00.000Z";

function message(m: Partial<ChatMessage> & { id: string }): ChatMessage {
  return { role: "assistant", text: "", createdAt: T0, status: "done", ...m };
}

/** "Where should I start?" asked twice, then something else: three turns. */
function conversation(): ChatThread {
  return {
    id: THREAD,
    kind: "guide",
    title: "Where should I start?",
    createdAt: T0,
    updatedAt: T2,
    gist: "Where to start, twice.",
    messages: [
      message({ id: "q1", role: "user", text: "Where should I start?", createdAt: T0 }),
      message({ id: "a1", text: "§ 3.", createdAt: T0 }),
      message({ id: "q2", role: "user", text: "Where should I start?", createdAt: T1 }),
      message({ id: "a2", text: "As I said, § 3.", createdAt: T1 }),
      message({ id: "q3", role: "user", text: "And then?", createdAt: T2 }),
      message({ id: "a3", text: "§ 4.", createdAt: T2 }),
    ],
  };
}

const DOOMED = ["q2", "a2", "q3", "a3"];

function loaded(t: ChatThread = conversation()): ChatState {
  const started = twice(initialState(SLUG), { type: "load.started", op: { id: LOAD, kind: "load" } }).state;
  return twice(started, { type: "load.succeeded", opId: LOAD, threads: [t] }).state;
}

const pruning = (id: OpId = PRUNE, ids: string[] = DOOMED, messageId = ids[0] ?? "q2"): ChatInput => ({
  type: "prune.started",
  op: { id, kind: "prune", threadId: THREAD, messageId, ids },
});

/** A send registered after the press, whose rows go straight into `base`. */
const sending: ChatInput = {
  type: "turn.started",
  op: {
    id: SEND,
    kind: "turn",
    shape: "send",
    threadId: THREAD,
    replyId: "a-new",
    reply: message({ id: "a-new", status: "pending", createdAt: T2 }),
    question: message({ id: "q-new", role: "user", text: "One more?", createdAt: T2 }),
    editing: null,
    opening: null,
    title: null,
    at: T2,
    began: false,
    attempt: null,
  },
  payload: { question: "One more?" },
};

const shown = (state: ChatState) => project(state).find((t) => t.id === THREAD);
const shownIds = (state: ChatState) => shown(state)?.messages.map((m) => m.id);

describe("pressing the bin", () => {
  it("asks for one delete, naming the question and the tail the reader could see", () => {
    const out = twice(loaded(), pruning());
    expect(out.commands).toEqual([
      { type: "prune", opId: PRUNE, slug: SLUG, threadId: THREAD, messageId: "q2", expectedTailId: "a3" },
    ]);
  });

  it("takes the rows off the screen at once, and dates the conversation by the turn it now ends on", () => {
    const state = twice(loaded(), pruning()).state;
    expect(shownIds(state)).toEqual(["q1", "a1"]);
    expect(shown(state)?.updatedAt).toBe(T0);
    // Drawn, not written: `base` still has them, so a refusal can give them back.
    expect(state.base.find((t) => t.id === THREAD)?.messages).toHaveLength(6);
  });

  it("asks nothing for a press with no rows to delete", () => {
    const before = loaded();
    const out = twice(before, pruning(PRUNE, []));
    expect(out.commands).toEqual([]);
    expect(out.state).toBe(before);
  });

  it("asks nothing if the rendered button has gone stale and the thread is no longer settled", () => {
    const writing = twice(loaded(), sending).state;
    const whileWriting = twice(writing, pruning());
    expect(whileWriting.commands).toEqual([]);
    expect(whileWriting.state).toBe(writing);

    const firstPrune = twice(loaded(), pruning()).state;
    const secondPrune = twice(firstPrune, pruning(asOpId("spya-prun02")));
    expect(secondPrune.commands).toEqual([]);
    expect(secondPrune.state).toBe(firstPrune);

    const unnamed = twice(initialState(SLUG), { type: "thread.begun", thread: conversation() }).state;
    const beforeNaming = twice(unnamed, pruning());
    expect(beforeNaming.commands).toEqual([]);
    expect(beforeNaming.state).toBe(unnamed);
  });
});

describe("the answer", () => {
  it("success writes the delete down, and drops the gist the server dropped", () => {
    const state = twice(twice(loaded(), pruning()).state, { type: "prune.succeeded", opId: PRUNE }).state;
    const stored = state.base.find((t) => t.id === THREAD);
    expect(stored?.messages.map((m) => m.id)).toEqual(["q1", "a1"]);
    expect(stored?.updatedAt).toBe(T0);
    expect(stored).not.toHaveProperty("gist");
    expect(state.operations.size).toBe(0);
    expect(state.error).toBeNull();
  });

  it("a refusal puts every row back and says why", () => {
    const state = twice(twice(loaded(), pruning()).state, {
      type: "prune.failed",
      opId: PRUNE,
      error: "This conversation has moved on since you opened it. Reload before deleting.",
    }).state;
    expect(shownIds(state)).toEqual(conversation().messages.map((m) => m.id));
    expect(shown(state)?.gist).toBe("Where to start, twice.");
    expect(state.error).toMatch(/^Couldn't delete that: .*Reload before deleting/);
    expect(state.operations.size).toBe(0);
  });

  it("a delete of the whole conversation wins, whichever answers first", () => {
    const start = twice(loaded(), pruning()).state;
    const events: ChatEvent[] = [
      { type: "delete.started", op: { id: DELETE, kind: "delete", threadId: THREAD } },
      { type: "prune.succeeded", opId: PRUNE },
      { type: "delete.succeeded", opId: DELETE },
    ];
    let sawDelete = false;
    inEveryOrder(start, events, (state, story) => {
      if (story.includes("delete.started")) sawDelete = true;
      if (story.includes("delete.started")) {
        expect(shown(state), `the conversation came back after ${story}`).toBeUndefined();
      }
    });
    expect(sawDelete).toBe(true);
  });
});

describe("over every order", () => {
  /**
   * The press, then any arrangement of: the delete's success or failure, a send
   * the reader starts after it, and a list fetched before it that answers late.
   * While the delete stands the doomed rows are never on screen, and the send's
   * question always is once it has been asked — the case a whole-thread
   * snapshot on success would have broken (plan review F2).
   */
  for (const outcome of ["prune.succeeded", "prune.failed"] as const) {
    it(`a deleted row stays gone and a later send stays put, ending in ${outcome}`, () => {
      const start = twice(loaded(), pruning()).state;
      const answer: ChatEvent =
        outcome === "prune.succeeded"
          ? { type: "prune.succeeded", opId: PRUNE }
          : { type: "prune.failed", opId: PRUNE, error: "no" };
      const events: ChatEvent[] = [
        answer,
        sending,
        { type: "load.started", op: { id: LATE_LOAD, kind: "load" } },
        { type: "load.succeeded", opId: LATE_LOAD, threads: [conversation()] },
      ];
      inEveryOrder(start, events, (state, story) => {
        const ids = shownIds(state) ?? [];
        const refused = outcome === "prune.failed" && story.includes(outcome);
        if (!refused) {
          for (const id of DOOMED) expect(ids, `${id} came back after ${story}`).not.toContain(id);
        } else {
          expect(ids.slice(0, 6), `a refusal did not put the rows back after ${story}`).toEqual(
            conversation().messages.map((m) => m.id),
          );
        }
        if (story.includes("turn.started")) {
          expect(ids, `the later send went missing after ${story}`).toContain("q-new");
        }
      });
    });
  }
});
