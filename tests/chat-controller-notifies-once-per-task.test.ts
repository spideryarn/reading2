/**
 * **The chat store tells its listeners at most twice per browser task, and
 * always tells them the latest.**
 *
 * The contract behind the #185 fix, without React:
 * docs/plans/260915a-question-press-answer-does-not-loop.md § The state machine,
 * exactly. A change with no window open is told at once (leading); a change
 * inside an open window only marks the store dirty, and the window's
 * `setTimeout(0)` tells everyone once with the latest snapshot (trailing) and
 * opens the next window.
 *
 * Every assertion is an exact count, not "at most" — zero notifications
 * satisfies "at most one", and a store that never told anybody would pass.
 *
 * The two ways a naïve version leaves a subscriber stale for ever are pinned
 * here too, from GPT Sol's plan review: R1 (a listener that arrives while a
 * window is open is still told) and R2 (one throwing listener neither silences
 * the others nor wedges the gate).
 */
import { describe, expect, it } from "vitest";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { TurnSink } from "../src/web/chat/effects.js";
import { asOpId } from "../src/web/chat/model.js";
import type { ChatMessage } from "../src/types.js";

const SLUG = "a-notify-article";
const THREAD = "spya-ntf4th";
const REPLY = "spya-ntf4rp";

/** Cross one task boundary. The window's own timer was queued first, so it runs first. */
const task = () => new Promise<void>((go) => setTimeout(go, 0));
const micro = async (n = 8) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

/** A controller with one turn open and every window it opened closed again. */
async function opened(): Promise<{ c: ChatController; sink: TurnSink }> {
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
    settledAnswer: async () => null,
    stopAnswer: async () => ({ ok: true }),
    cancelThread: async () => ({ ok: true }),
  };
  const c = new ChatController(SLUG, effects);
  const at = "2026-09-15T11:00:00.000Z";
  const reply: ChatMessage = { id: REPLY, role: "assistant", text: "", createdAt: at, status: "pending" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-ntf4op"),
      kind: "turn",
      shape: "send",
      threadId: THREAD,
      replyId: REPLY,
      reply,
      question: { id: "spya-ntf4qn", role: "user", text: "how?", createdAt: at, status: "done" },
      editing: null,
      opening: { id: THREAD, title: "how?", createdAt: at, updatedAt: at, kind: "chat", messages: [] },
      title: null,
      at,
      began: false,
      attempt: null,
    },
    payload: {},
  });
  const s = sink as TurnSink | null;
  if (!s) throw new Error("the turn did not open its stream");
  s.began({ threadId: THREAD, title: "how?", messageId: REPLY });
  await task();
  await task();
  return { c, sink: s };
}

/** The answer's text in the controller's own projection. */
function text(c: ChatController): string {
  return c.threads.find((t) => t.id === THREAD)?.messages.find((m) => m.id === REPLY)?.text ?? "";
}

describe("when the chat store tells its listeners", () => {
  it("tells them once at once, then once more at the task boundary with the latest", async () => {
    const { c, sink } = await opened();
    const seen: string[] = [];
    c.subscribe(() => seen.push(text(c)));

    sink.delta("a");
    expect(seen, "the leading change is told at once").toEqual(["a"]);
    expect(text(c)).toBe("a");

    sink.delta("b");
    expect(text(c), "the state is current after every dispatch").toBe("ab");
    await micro();
    sink.delta("c");
    expect(text(c)).toBe("abc");
    await micro();
    expect(seen, "nothing more before a task boundary").toEqual(["a"]);

    await task();
    expect(seen, "exactly one trailing notification, seeing the latest").toEqual(["a", "abc"]);

    await task();
    expect(seen, "a window with nothing new in it closes quietly").toEqual(["a", "abc"]);

    sink.delta("d");
    expect(seen, "with every window closed, the next change leads again").toEqual(["a", "abc", "abcd"]);
  });

  it("tells a change made from inside the trailing listener once, in the next window", async () => {
    const { c, sink } = await opened();
    const seen: string[] = [];
    c.subscribe(() => {
      seen.push(text(c));
      if (seen.length === 2) sink.delta("x");
    });

    sink.delta("a");
    sink.delta("b");
    expect(seen).toEqual(["a"]);

    await task();
    expect(seen, "the trailing call's own change is not told re-entrantly").toEqual(["a", "ab"]);
    expect(text(c)).toBe("abx");

    await task();
    expect(seen, "it is told once, in the next window").toEqual(["a", "ab", "abx"]);

    await task();
    expect(seen).toEqual(["a", "ab", "abx"]);
  });

  it("folds a change made from inside the leading listener into the current window", async () => {
    const { c, sink } = await opened();
    const seen: string[] = [];
    c.subscribe(() => {
      seen.push(text(c));
      if (seen.length === 1) sink.delta("y");
    });

    sink.delta("a");
    expect(seen, "not told re-entrantly").toEqual(["a"]);
    expect(text(c)).toBe("ay");

    await task();
    expect(seen, "joined the current window's trailing flush").toEqual(["a", "ay"]);

    await task();
    expect(seen).toEqual(["a", "ay"]);
  });

  it("tells a listener that arrived while a window was open (R1)", async () => {
    const { c, sink } = await opened();
    const first: string[] = [];
    const second: string[] = [];
    const leave = c.subscribe(() => first.push(text(c)));

    sink.delta("A");
    sink.delta("B");
    expect(first).toEqual(["A"]);

    leave();
    c.subscribe(() => second.push(text(c)));
    sink.delta("C");
    expect(second, "suppressed by the open window").toEqual([]);

    await task();
    expect(first, "the one who left is not told").toEqual(["A"]);
    expect(second, "the replacement is told, and sees the latest").toEqual(["ABC"]);
  });

  it("opens nothing when the window closes with nobody listening", async () => {
    const { c, sink } = await opened();
    sink.delta("a");
    sink.delta("b");
    await task();

    const seen: string[] = [];
    c.subscribe(() => seen.push(text(c)));
    sink.delta("c");
    expect(seen, "the reset left no window open, so this leads").toEqual(["abc"]);
  });

  it("tells everyone even when one listener throws, and keeps telling them (R2)", async () => {
    const { c, sink } = await opened();
    let throws = true;
    const others: string[] = [];
    c.subscribe(() => {
      if (throws) {
        throws = false;
        throw new Error("a listener fell over");
      }
    });
    c.subscribe(() => others.push(text(c)));

    expect(() => sink.delta("a"), "the first listener's throw is rethrown").toThrow("a listener fell over");
    expect(others, "after every listener has been told").toEqual(["a"]);
    expect(text(c)).toBe("a");

    sink.delta("b");
    expect(others, "the throw did not leave the gate open").toEqual(["a"]);

    await task();
    expect(others, "the throw did not wedge the window").toEqual(["a", "ab"]);

    await task();
    sink.delta("c");
    expect(others, "a later change still notifies").toEqual(["a", "ab", "abc"]);
  });
});
