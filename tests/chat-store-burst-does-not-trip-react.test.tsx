// @vitest-environment jsdom
/**
 * **A burst of chat frames must not trip React's nested-update counter.**
 *
 * The class behind Greg's #185 of 2026-09-12, without the App around it:
 * docs/postmortems/260915a-a-store-notified-per-frame-turns-a-buffered-stream-into-an-update-loop.md.
 *
 * A real `ChatController`, one `useSyncExternalStore` subscriber drawing the
 * answer, and a sibling whose effect answers each change it sees with a
 * new-value `setState` — the ordinary shape of any effect that reacts to the
 * chat. React counts a commit as nested when it leaves Sync or Default work
 * behind, and that effect leaves some after every one. So while the frames
 * arrive already buffered, every read resolving as a microtask and React's
 * scheduler never getting a macrotask, a store that forces a Sync commit per
 * frame passes fifty and the next dispatch throws.
 *
 * **One update scheduled before the burst is not enough, and that is React's
 * doing.** React 19 renders pending Default work together with Sync work
 * (`getHighestPriorityLanes` takes `lanes & 42`), so a single early update is
 * used up by the first commit and never counts again. It takes an update
 * re-armed per commit to climb, which is what `ChatPanel`'s `setAway(false)`
 * did in the report.
 *
 * No `ChatPanel`, deliberately: its scroll effect is one way to re-arm the
 * counter and this test must stay red without it, which the whole-App test in
 * tests/question-press-answer-does-not-loop.test.tsx cannot promise.
 *
 * Not in `act`, and that is the point — `act` drains each frame's work before
 * the next, which is exactly why no earlier chat test saw this. It never asks
 * *which* frame throws; that is React's number, not ours.
 */
import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { TurnSink } from "../src/web/chat/effects.js";
import { asOpId } from "../src/web/chat/model.js";
import type { ChatMessage } from "../src/types.js";

const SLUG = "a-burst-article";
const THREAD = "spya-bst7th";
const REPLY = "spya-bst7rp";
const FRAMES = 180;
const WORD = "word ";

/** A macrotask, so React's scheduler gets its turn. */
const task = () => new Promise<void>((go) => setTimeout(go, 0));

/** Every frame already waiting, so each `read()` resolves as a microtask. */
async function* buffered(n: number): AsyncGenerator<string> {
  const stream = new ReadableStream<string>({
    start(c) {
      for (let i = 0; i < n; i++) c.enqueue(WORD);
      c.close();
    },
  });
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

let host: HTMLDivElement;
let root: Root;
let sink: TurnSink | null;

function controller(): ChatController {
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
  return new ChatController(SLUG, effects);
}

function start(c: ChatController): void {
  const at = "2026-09-15T10:00:00.000Z";
  const reply: ChatMessage = { id: REPLY, role: "assistant", text: "", createdAt: at, status: "pending" };
  const question: ChatMessage = { id: "spya-bst7qn", role: "user", text: "why?", createdAt: at, status: "done" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-bst7op"),
      kind: "turn",
      shape: "send",
      threadId: THREAD,
      replyId: REPLY,
      reply,
      question,
      editing: null,
      opening: { id: THREAD, title: "why?", createdAt: at, updatedAt: at, kind: "chat", messages: [] },
      title: null,
      at,
      began: false,
      attempt: null,
    },
    payload: {},
  });
}

/** The one subscriber: the answer's text, as React last drew it. */
function Answer({ c }: { c: ChatController }) {
  const { threads } = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const text = threads.find((t) => t.id === THREAD)?.messages.find((m) => m.id === REPLY)?.text ?? "";
  return createElement("p", { "data-answer": "" }, text);
}

/**
 * A sibling on the same root that reacts to the chat with a new-value update —
 * the pending Default work, re-armed at the end of every commit it sees.
 */
function Sibling({ c }: { c: ChatController }) {
  const { threads } = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const [, setSeen] = useState(threads);
  useEffect(() => {
    setSeen(threads);
  }, [threads]);
  return null;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  sink = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  root.unmount();
  host.remove();
  await task();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("the chat store under a buffered burst", () => {
  it("draws the whole answer, and React never refuses an update", async () => {
    const c = controller();
    root.render(createElement("div", null, createElement(Answer, { c }), createElement(Sibling, { c })));
    for (let i = 0; i < 4; i++) await task();
    start(c);
    for (let i = 0; i < 4; i++) await task();
    expect(sink, "the turn must have opened its stream").not.toBeNull();
    sink?.began({ threadId: THREAD, title: "why?", messageId: REPLY });
    for (let i = 0; i < 4; i++) await task();

    let thrown: string | null = null;
    try {
      for await (const text of buffered(FRAMES)) sink?.delta(text);
    } catch (e) {
      thrown = (e as Error).message;
    }
    for (let i = 0; i < 6; i++) await task();

    expect(thrown, "no dispatch may throw").toBeNull();
    const drawn = host.querySelector("[data-answer]")?.textContent ?? "";
    expect(drawn).toBe(WORD.repeat(FRAMES));
    expect(c.threads.find((t) => t.id === THREAD)?.messages.find((m) => m.id === REPLY)?.text).toBe(
      WORD.repeat(FRAMES),
    );
  });
});
