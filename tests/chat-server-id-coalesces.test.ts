/**
 * **When the server answers a new conversation with the name of one this tab
 * already holds, the two become one.**
 *
 * Since plan 261001m an article has one Learn conversation, and a typed turn
 * into a second one (a stale tab, a bookmark) is appended to the first by the
 * server, whose `begin` frame then names it. The tab may already hold that
 * conversation in its list — so renaming the provisional thread in place would
 * leave two threads under one id, and the panel would find whichever came
 * first. GPT Sol's plan review, F3: merge the provisional thread's question and
 * reply onto the end of the existing one, and drop the provisional entry —
 * whichever order the two have in the array.
 *
 * And Start over's half of the reducer (F1): a delete asked to come back on
 * failure lifts its own tombstone when the server refuses.
 */
import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatThread } from "../src/types.js";
import { asOpId, initialState, isSettled, withServerIds } from "../src/web/chat/model.js";
import { project } from "../src/web/chat/project.js";
import { twice } from "./helpers/chat-reduce.js";

const AT = "2026-09-20T10:00:00.000Z";
const LATER = "2026-10-01T10:00:00.000Z";

function msg(id: string, role: "user" | "assistant", status: ChatMessage["status"] = "done"): ChatMessage {
  return { id, role, text: id, createdAt: AT, status };
}

const EXISTING: ChatThread = {
  id: "spya-rem001",
  kind: "learn",
  title: "The one Learn conversation",
  createdAt: AT,
  updatedAt: AT,
  messages: [msg("spya-q00001", "user"), msg("spya-a00001", "assistant")],
};

const PROVISIONAL: ChatThread = {
  id: "spya-prov01",
  kind: "learn",
  title: "What I took",
  createdAt: LATER,
  updatedAt: LATER,
  messages: [msg("spya-qtemp1", "user"), msg("spya-atemp1", "assistant", "pending")],
};

const BEGUN = {
  threadId: EXISTING.id,
  title: EXISTING.title,
  messageId: "spya-a00002",
  questionId: "spya-q00002",
};

describe("withServerIds folds a provisional thread into one the tab already holds", () => {
  for (const [name, order] of [
    ["existing first", [EXISTING, PROVISIONAL]],
    ["provisional first", [PROVISIONAL, EXISTING]],
  ] as const) {
    it(`appends the turn to the existing thread and drops the provisional one (${name})`, () => {
      const out = withServerIds(order, PROVISIONAL.id, "spya-atemp1", BEGUN, true);
      expect(out.map((t) => t.id)).toEqual([EXISTING.id]);
      const kept = out[0] as ChatThread;
      expect(kept.title).toBe(EXISTING.title);
      expect(kept.messages.map((m) => m.id)).toEqual([
        "spya-q00001",
        "spya-a00001",
        "spya-q00002",
        "spya-a00002",
      ]);
      expect(kept.messages.at(-1)?.status).toBe("pending");
      expect(kept.updatedAt).toBe(LATER);
    });
  }

  it("still renames in place when the server's id is new to this tab", () => {
    const out = withServerIds([EXISTING, PROVISIONAL], PROVISIONAL.id, "spya-atemp1", {
      ...BEGUN,
      threadId: "spya-new001",
      title: "Server title",
    }, true);
    expect(out.map((t) => t.id)).toEqual([EXISTING.id, "spya-new001"]);
    expect(out[1]?.title).toBe("Server title");
  });
});

describe("Start over's settled gate after server naming", () => {
  const LOAD = asOpId("spya-load09");
  const TURN = asOpId("spya-turn09");

  function loaded(...threads: ChatThread[]) {
    const started = twice(initialState("a-piece"), {
      type: "load.started",
      op: { id: LOAD, kind: "load" },
    }).state;
    return twice(started, { type: "load.succeeded", opId: LOAD, threads }).state;
  }

  it("keeps a coalesced turn unsettled under the server id until the turn finishes", () => {
    const opening = { ...PROVISIONAL, messages: [] };
    const question = PROVISIONAL.messages[0] as ChatMessage;
    const reply = PROVISIONAL.messages[1] as ChatMessage;
    const sent = twice(loaded(EXISTING), {
      type: "turn.started",
      op: {
        id: TURN,
        kind: "turn",
        shape: "send",
        threadId: PROVISIONAL.id,
        replyId: reply.id,
        reply,
        question,
        editing: null,
        opening,
        title: null,
        at: LATER,
        began: false,
        attempt: null,
      },
      payload: { question: question.text },
    }).state;
    const named = twice(sent, { type: "turn.began", opId: TURN, begun: BEGUN }).state;

    expect(named.base.map((t) => t.id)).toEqual([EXISTING.id]);
    expect(isSettled(named, EXISTING.id)).toBe(false);

    const done = twice(named, {
      type: "turn.done",
      opId: TURN,
      done: { text: "The stored answer." },
    }).state;
    expect(isSettled(done, EXISTING.id)).toBe(true);
  });

  it("treats a server-loaded pending row as named, then closes while this tab recovers it", () => {
    const pending = { ...EXISTING, messages: [EXISTING.messages[0]!, msg("spya-a00001", "assistant", "pending")] };
    const loadingAgain = twice(loaded(pending), {
      type: "load.started",
      op: { id: asOpId("spya-load10"), kind: "load" },
    }).state;

    /* A row's `pending` status says nothing about whether this tab owns its
       writer. Loads alone do not block a DELETE of the server-known id. */
    expect(isSettled(loadingAgain, EXISTING.id)).toBe(true);

    const recovering = twice(loadingAgain, {
      type: "recovery.started",
      op: {
        id: asOpId("spya-rec009"),
        kind: "recovery",
        threadId: EXISTING.id,
        messageId: "spya-a00001",
        until: Date.now() + 1_000,
        attempt: null,
      },
    }).state;
    expect(isSettled(recovering, EXISTING.id)).toBe(false);
  });
});

describe("a delete asked to restore on failure", () => {
  const DELETE = asOpId("spya-del001");
  const LOAD = asOpId("spya-load01");

  function loaded(...threads: ChatThread[]) {
    const started = twice(initialState("a-piece"), { type: "load.started", op: { id: LOAD, kind: "load" } }).state;
    return twice(started, { type: "load.succeeded", opId: LOAD, threads }).state;
  }

  it("puts the conversation back when the DELETE fails, and says so", () => {
    const removed = twice(loaded(EXISTING), {
      type: "delete.started",
      op: { id: DELETE, kind: "delete", threadId: EXISTING.id, restoreOnFailure: true },
    }).state;
    expect(project(removed)).toHaveLength(0);
    const failed = twice(removed, { type: "delete.failed", opId: DELETE, error: "a 500" }).state;
    expect(project(failed).map((t) => t.id)).toEqual([EXISTING.id]);
    expect(failed.error).toBe("Couldn't delete that conversation: a 500");
  });
});
