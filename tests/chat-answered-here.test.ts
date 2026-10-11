/**
 * **An answer is marked as watched here only when this tab's own stream
 * finishes it, under the id the server gave it** — src/web/chat/answered-here.ts,
 * plan docs/plans/261011s-the-guide-saves-your-reason-and-about-you-at-once-when-the-words-are-yours.md.
 * The guide's offer that saves without a press trusts this and nothing else.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { TurnSink } from "../src/web/chat/effects.js";
import { asOpId } from "../src/web/chat/model.js";
import { forgetAnsweredHere, takeAnsweredHere } from "../src/web/chat/answered-here.js";
import type { ChatMessage } from "../src/types.js";

const THREAD = "spya-ahr4th";
const MINTED = "spya-ahr4mn";
const SERVERS = "spya-ahr4sv";

function opened(payload: Record<string, unknown> = { kind: "guide", typed: true }): {
  controller: ChatController;
  sink: TurnSink;
} {
  let sink: TurnSink | null = null;
  const effects: ChatEffects = {
    loadThreads: () => new Promise(() => {}),
    renameThread: async () => ({ ok: true }),
    deleteThread: async () => ({ ok: true }),
    deleteFrom: async () => ({ ok: true }),
    runTurn: (_slug, _thread, _payload, s) => {
      sink = s;
      return new Promise(() => {});
    },
    appendSpoken: () => new Promise(() => {}),
    settledAnswer: async () => null,
    stopAnswer: async () => ({ ok: true }),
    cancelThread: async () => ({ ok: true }),
    markHintOpened: async () => ({ ok: false, error: "not in this test" }),
  };
  const c = new ChatController("an-answered-article", effects);
  const at = "2026-10-11T11:00:00.000Z";
  const reply: ChatMessage = { id: MINTED, role: "assistant", text: "", createdAt: at, status: "pending" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-ahr4op"),
      kind: "turn",
      shape: "send",
      threadId: THREAD,
      replyId: MINTED,
      reply,
      question: { id: "spya-ahr4qn", role: "user", text: "why?", createdAt: at, status: "done" },
      editing: null,
      opening: { id: THREAD, title: "why?", createdAt: at, updatedAt: at, kind: "guide", messages: [] },
      title: null,
      at,
      began: false,
      attempt: null,
    },
    payload,
  });
  const s = sink as TurnSink | null;
  if (!s) throw new Error("the turn did not open its stream");
  return { controller: c, sink: s };
}

beforeEach(() => forgetAnsweredHere());

describe("answered here", () => {
  it("is marked by the stream's done, under the server's id, once per key", () => {
    const { sink } = opened();
    sink.began({ threadId: THREAD, title: "why?", messageId: SERVERS });
    expect(takeAnsweredHere(SERVERS, "purpose"), "not before it is done").toBe(false);
    sink.done({ text: "Done", citations: [], searches: 0, model: "m" });
    expect(takeAnsweredHere(MINTED, "purpose"), "not under the id the tab made up").toBe(false);
    expect(takeAnsweredHere(SERVERS, "purpose")).toBe(true);
    expect(takeAnsweredHere(SERVERS, "purpose"), "only once").toBe(false);
    expect(takeAnsweredHere(SERVERS, "profile"), "each field its own go").toBe(true);
  });

  it("is not marked by a stream that fails", () => {
    const { sink } = opened();
    sink.began({ threadId: THREAD, title: "why?", messageId: SERVERS });
    sink.failed("it broke");
    expect(takeAnsweredHere(SERVERS, "purpose")).toBe(false);
  });

  it("is not marked before begin, on a disconnected turn, or for an untyped turn", () => {
    const beforeBegin = opened().sink;
    beforeBegin.done({ text: "Done", citations: [], searches: 0, model: "m" });
    expect(takeAnsweredHere(MINTED, "purpose")).toBe(false);

    const disconnected = opened().sink;
    disconnected.began({ threadId: THREAD, title: "why?", messageId: SERVERS });
    disconnected.disconnected("connection lost");
    disconnected.done({ text: "Done", citations: [], searches: 0, model: "m" });
    expect(takeAnsweredHere(SERVERS, "purpose")).toBe(false);

    const untyped = opened({ kind: "guide" }).sink;
    untyped.began({ threadId: THREAD, title: "why?", messageId: SERVERS });
    untyped.done({ text: "Done", citations: [], searches: 0, model: "m" });
    expect(takeAnsweredHere(SERVERS, "purpose")).toBe(false);
  });

  it("does not mark a turn superseded by deleting its conversation", () => {
    const { controller, sink } = opened();
    sink.began({ threadId: THREAD, title: "why?", messageId: SERVERS });
    controller.dispatch({
      type: "delete.started",
      op: { id: asOpId("spya-ahr4dl"), kind: "delete", threadId: THREAD },
    });
    sink.done({ text: "Done", citations: [], searches: 0, model: "m" });
    expect(takeAnsweredHere(SERVERS, "purpose")).toBe(false);
  });
});
