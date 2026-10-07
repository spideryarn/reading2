/**
 * **The chat controller's `Answered` event** — plan
 * docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md,
 * Item 1 (GPT Sol's F2): the guide acts on an answer that has just finished
 * arriving in a turn this tab started, and on nothing else.
 *
 * So: one event per `done` frame, carrying the **server's** ids (the `begin`
 * frame renamed them); nothing for a listener that came later; nothing for an
 * answer found by recovery after a lost stream; nothing after unsubscribing.
 *
 * The controller is driven with fake effects, as
 * tests/chat-controller-notifies-once-per-task.test.ts does.
 */
import { describe, expect, it, vi } from "vitest";
import { type Answered, ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { TurnSink } from "../src/web/chat/effects.js";
import { asOpId } from "../src/web/chat/model.js";
import type { ChatMessage } from "../src/types.js";

const SLUG = "a-guided-article";
/* The ids the client guessed, and the ones the server's `begin` frame names. */
const LOCAL_THREAD = "spya-gdl1th";
const LOCAL_REPLY = "spya-gdl1rp";
const SERVER_THREAD = "spya-gds1th";
const SERVER_REPLY = "spya-gds1rp";
const AT = "2026-10-07T11:00:00.000Z";

const task = () => new Promise<void>((go) => setTimeout(go, 0));
const micro = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** A controller with one guide turn open and its `begin` frame received. */
async function opened(
  settledAnswer: ChatEffects["settledAnswer"] = async () => null,
): Promise<{ c: ChatController; sink: TurnSink; latestSink(): TurnSink }> {
  let sink: TurnSink | null = null;
  const effects: ChatEffects = {
    loadThreads: () => new Promise(() => {}),
    renameThread: async () => ({ ok: true }),
    deleteThread: async () => ({ ok: true }),
    runTurn: (_slug, _thread, _payload, s) => {
      sink = s;
      return new Promise(() => {});
    },
    appendSpoken: () => new Promise(() => {}),
    settledAnswer,
    stopAnswer: async () => ({ ok: true }),
    cancelThread: async () => ({ ok: true }),
    markHintOpened: async () => ({ ok: false, error: "not in this test" }),
  };
  const c = new ChatController(SLUG, effects);
  const reply: ChatMessage = { id: LOCAL_REPLY, role: "assistant", text: "", createdAt: AT, status: "pending" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-gdl1op"),
      kind: "turn",
      shape: "send",
      threadId: LOCAL_THREAD,
      replyId: LOCAL_REPLY,
      reply,
      question: { id: "spya-gdl1qn", role: "user", text: "where do I start?", createdAt: AT, status: "done" },
      editing: null,
      opening: { id: LOCAL_THREAD, title: "Guide", createdAt: AT, updatedAt: AT, kind: "guide", messages: [] },
      title: null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: {},
  });
  const s = sink as TurnSink | null;
  if (!s) throw new Error("the turn did not open its stream");
  s.began({ threadId: SERVER_THREAD, title: "Guide", messageId: SERVER_REPLY, questionId: "spya-gds1qn" });
  await task();
  return { c, sink: s, latestSink: () => {
    if (!sink) throw new Error("the turn did not open its stream");
    return sink;
  } };
}

const ANSWER = "I've opened Structure for you.\n\n[cmd:mode:mode%3Astructure]";

function replaceAnswer(c: ChatController, shape: "retry" | "edit") {
  const question = c.threads[0]?.messages[0];
  if (!question) throw new Error("there is no question to replace");
  const replyId = shape === "retry" ? SERVER_REPLY : "spya-gdedrp";
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId(`spya-gd-${shape}`), kind: "turn", shape,
      threadId: SERVER_THREAD, replyId,
      reply: { id: replyId, role: "assistant", text: "", createdAt: AT, status: "pending" },
      question: shape === "edit" ? { ...question, text: "Show the structure" } : null,
      editing: shape === "edit" ? question.id : null,
      opening: null, title: null, at: AT, began: false, attempt: null,
    },
    payload: {},
  });
  return replyId;
}

describe("the controller's Answered event", () => {
  it("tells a listener once when the stream ends with done, with the server's ids", async () => {
    const { c, sink } = await opened();
    const heard: Answered[] = [];
    c.onAnswered((a) => heard.push(a));
    sink.delta("I've opened");
    expect(heard, "a delta is not the answer finishing").toEqual([]);
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    expect(heard).toHaveLength(1);
    expect(heard[0]?.threadId).toBe(SERVER_THREAD);
    expect(heard[0]?.startedThreadId).toBe(LOCAL_THREAD);
    expect(heard[0]?.message.id).toBe(SERVER_REPLY);
    expect(heard[0]?.message.status).toBe("done");
    expect(heard[0]?.message.text).toBe(ANSWER);
    /* The row it names is the one on screen. */
    const row = c.threads.find((t) => t.id === SERVER_THREAD)?.messages.find((m) => m.id === SERVER_REPLY);
    expect(row).toBe(heard[0]?.message);
    /* A second done for the same turn is refused at the gate, and says nothing. */
    sink.done({ text: "again", citations: [], searches: 0, model: "m" });
    await task();
    expect(heard).toHaveLength(1);
  });

  it("tells every listener, each once", async () => {
    const { c, sink } = await opened();
    const one = vi.fn();
    const two = vi.fn();
    c.onAnswered(one);
    c.onAnswered(two);
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(1);
  });

  it("tells a listener added after the done nothing", async () => {
    const { c, sink } = await opened();
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    await task();
    const late = vi.fn();
    c.onAnswered(late);
    await task();
    expect(late).not.toHaveBeenCalled();
  });

  it("tells nothing when an answer is found by recovery after the stream was lost", async () => {
    let found!: (message: ChatMessage) => void;
    const asked = vi.fn();
    const { c, sink } = await opened(
      (_slug, threadId, messageId) =>
        new Promise((resolve) => {
          asked(threadId, messageId);
          found = resolve;
        }),
    );
    const heard = vi.fn();
    c.onAnswered(heard);
    sink.disconnected("connection lost");
    await micro();
    await task();
    expect(asked, "the recovery went looking").toHaveBeenCalledWith(SERVER_THREAD, SERVER_REPLY);
    found({ id: SERVER_REPLY, role: "assistant", text: ANSWER, status: "done", createdAt: AT });
    await micro();
    await task();
    /* The recovered answer is on screen — so the silence is the event's, not a
       recovery that did nothing. */
    const row = c.threads.find((t) => t.id === SERVER_THREAD)?.messages.find((m) => m.id === SERVER_REPLY);
    expect(row?.text).toBe(ANSWER);
    expect(row?.status).toBe("done");
    expect(heard).not.toHaveBeenCalled();
  });

  it("tells nothing for a turn that failed", async () => {
    const { c, sink } = await opened();
    const heard = vi.fn();
    c.onAnswered(heard);
    sink.failed("the model refused", "partial");
    await task();
    expect(heard).not.toHaveBeenCalled();
  });

  it("tells a listener that has unsubscribed nothing", async () => {
    const { c, sink } = await opened();
    const gone = vi.fn();
    const stays = vi.fn();
    const off = c.onAnswered(gone);
    c.onAnswered(stays);
    off();
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    expect(gone).not.toHaveBeenCalled();
    expect(stays, "the others still hear it").toHaveBeenCalledTimes(1);
  });

  it.each(["retry", "edit"] as const)("tells the committed answer for a successful %s", async (shape) => {
    const { c, sink, latestSink } = await opened();
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    const heard: Answered[] = [];
    c.onAnswered((a) => heard.push(a));
    const replyId = replaceAnswer(c, shape);
    const next = latestSink();
    next.began({ threadId: SERVER_THREAD, title: "Guide", messageId: replyId });
    next.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    expect(heard).toHaveLength(1);
    expect(heard[0]?.startedThreadId).toBe(SERVER_THREAD);
    expect(heard[0]?.message).toBe(c.threads[0]?.messages.at(-1));
  });

  it.each(["retry", "edit"] as const)("does not announce an old answer restored by a refused %s", async (shape) => {
    const { c, sink, latestSink } = await opened();
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    const heard = vi.fn();
    c.onAnswered(heard);
    replaceAnswer(c, shape);
    expect(c.threads[0]?.messages.at(-1)?.status).toBe("pending");
    latestSink().refused("try again");
    expect(c.threads[0]?.messages.at(-1)?.text).toBe(ANSWER);
    expect(c.threads[0]?.messages.at(-1)?.status).toBe("done");
    expect(heard).not.toHaveBeenCalled();
  });

  it("does not announce a done frame from a turn superseded by deletion", async () => {
    const { c, sink } = await opened();
    const heard = vi.fn();
    c.onAnswered(heard);
    c.dispatch({ type: "delete.started", op: { id: asOpId("spya-gddltd"), kind: "delete", threadId: SERVER_THREAD } });
    sink.done({ text: ANSWER, citations: [], searches: 0, model: "m" });
    expect(c.threads).toHaveLength(0);
    expect(heard).not.toHaveBeenCalled();
  });
});
