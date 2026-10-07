// @vitest-environment jsdom
/**
 * **The guide acts on an answer streamed through the real controller** — plan
 * docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md,
 * Item 1. The other guide-acts tests fire `Answered` by hand into a
 * conversation already drawn with the finished answer. Here the answer arrives
 * the way it does in the app: a real `ChatController`, a parent that reads it
 * through `useSyncExternalStore` (as `useChat` does) and draws the real
 * `Conversation`, and frames from the stream — **not inside `act`**, because
 * `act` would flush the controller's deferred notification and the guide's
 * `setAct` together and hide any ordering between them.
 *
 * Two shapes of arrival: the `done` frame in a later task than the last delta
 * (the controller's notification window closed, so it tells React at once),
 * and the `done` frame in the same task as the last delta (window open, so
 * React hears of the finished answer only at the window's end).
 */
import { createElement, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "../src/types.js";
import { ChatController, type ChatEffects } from "../src/web/chat/controller.js";
import type { TurnSink } from "../src/web/chat/effects.js";
import { asOpId } from "../src/web/chat/model.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { ModeTarget } from "../src/web/command-proposal.js";

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async () =>
      new Response(JSON.stringify({ profile: null, purpose: null, purposeFailed: false }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    fetchOk: async () => new Response(null, { status: 204 }),
  };
});

const { ChatPanel, Conversation } = await import("../src/web/ChatPanel.js");
const { ChatCommands } = await import("../src/web/CommandChip.js");

const SLUG = "a-guided-article";
const THREAD = "spya-gdlvth";
const REPLY = "spya-gdlvrp";
const AT = "2026-10-07T11:00:00.000Z";
const CLOSE: ActionOutcome = { kind: "close" };
const MODES = new Map<string, ModeTarget>([
  ["mode:structure", { key: "mode:structure", label: "Structure", description: "Its shape.", generates: false }],
]);

const task = () => new Promise<void>((go) => setTimeout(go, 0));
const settle = async (n = 10) => {
  for (let i = 0; i < n; i++) await task();
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  root.unmount();
  host.remove();
  await settle(2);
});

function setUp(panel = false) {
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
    markHintOpened: async () => ({ ok: false, error: "not in this test" }),
  };
  const c = new ChatController(SLUG, effects);
  const mode = vi.fn((_p: { key: string }) => CLOSE);
  const executor = { runners: { mode }, sources: { modes: MODES }, openModeUnarmed: mode };
  let select: (id: string | null) => void = () => {};

  function Band() {
    const snap = useSyncExternalStore(c.subscribe, c.getSnapshot);
    const [selected, setSelected] = useState<string | null>(THREAD);
    useEffect(() => { select = setSelected; }, []);
    const thread = snap.threads[0];
    if (!thread) return null;
    if (panel) return <ChatCommands executor={executor}>{createElement(ChatPanel, {
        slug: SLUG,
        threads: [...snap.threads],
        threadId: selected,
        loaded: true,
        loadFailed: false,
        onThread: () => {},
        onJump: () => {},
        recovering: snap.recovering,
        blocks: new Map<string, string>(),
        onSend: () => {},
        onSendNew: () => {},
        onNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        canStartOver: false,
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        focusNonce: 0,
        error: null,
        kind: "chat",
        onAnswered: c.onAnswered,
      })}</ChatCommands>;
    return <ChatCommands executor={executor}>{createElement(Conversation, {
        slug: SLUG,
        thread,
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        onSend: () => {},
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        focusNonce: 0,
        focused: { current: 0 },
        draft: "",
        onDraft: () => {},
        kind: thread.kind,
        onAnswered: c.onAnswered,
      })}</ChatCommands>;
  }

  const reply: ChatMessage = { id: REPLY, role: "assistant", text: "", createdAt: AT, status: "pending" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-gdlvop"),
      kind: "turn",
      shape: "send",
      threadId: THREAD,
      replyId: REPLY,
      reply,
      question: { id: "spya-gdlvqn", role: "user", text: "Where do I start?", createdAt: AT, status: "done" },
      editing: null,
      opening: { id: THREAD, title: "Guide", createdAt: AT, updatedAt: AT, kind: "guide", messages: [] },
      title: null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: {},
  }, (id) => select(id));
  root.render(createElement(Band));
  const s = sink as TurnSink | null;
  if (!s) throw new Error("the turn did not open its stream");
  return { sink: s, mode, select: (id: string | null) => select(id) };
}

const LINES = ["I've opened Structure for you, so you can see how the parts fit.", "", "[cmd:mode:mode%3Astructure]"];
const TEXT = LINES.join("\n");
const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];

describe("a guide answer streamed through the controller", () => {
  it("acts through the real panel when a new guide is named and finishes in one buffered task", async () => {
    const { sink, mode } = setUp(true);
    await settle();
    sink.began({ threadId: "spya-gdsvth", title: "Guide", messageId: "spya-gdsvrp" });
    sink.delta(TEXT);
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips(), "the server-named conversation drew the finished answer").toHaveLength(1);
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it("acts through the real panel after the corrected thread id has committed", async () => {
    const { sink, mode } = setUp(true);
    await settle();
    sink.began({ threadId: "spya-gdsvth", title: "Guide", messageId: "spya-gdsvrp" });
    await settle();
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it("does not release a completion after leaving the guide and reopening it", async () => {
    const { sink, mode, select } = setUp(true);
    await settle();
    sink.began({ threadId: "spya-gdsvth", title: "Guide", messageId: "spya-gdsvrp" });
    await settle();
    select(null);
    await settle();
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    select("spya-gdsvth");
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).not.toHaveBeenCalled();
  });

  it("spends a completion in a hidden band and does not release it when shown", async () => {
    const { sink, mode } = setUp(true);
    await settle();
    host.style.display = "none";
    sink.began({ threadId: "spya-gdsvth", title: "Guide", messageId: "spya-gdsvrp" });
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).not.toHaveBeenCalled();
    host.style.display = "block";
    sink.delta("ignored after done");
    await settle();
    expect(mode).not.toHaveBeenCalled();
  });

  it("opens the mode when done arrives in a later task than the last delta", async () => {
    const { sink, mode } = setUp();
    await settle();
    sink.began({ threadId: THREAD, title: "Guide", messageId: REPLY });
    await settle();
    sink.delta(TEXT);
    await settle();
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it("opens the mode when done arrives in the same task as the last delta", async () => {
    const { sink, mode } = setUp();
    await settle();
    sink.began({ threadId: THREAD, title: "Guide", messageId: REPLY });
    await settle();
    /* A buffered tail: the last deltas and the done frame read in one go. */
    sink.delta(LINES[0] ?? "");
    sink.delta(`\n\n${LINES[2] ?? ""}`);
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it("opens the mode when done arrives after React drew the last delta, inside the controller's notification window", async () => {
    const { sink, mode } = setUp();
    await settle();
    sink.began({ threadId: THREAD, title: "Guide", messageId: REPLY });
    await settle();
    /* The last delta tells React at once and opens the window; React draws it
       (a Sync render, in a microtask) with the answer still pending, so its
       last line — the token — is held back. The done frame then arrives before
       the window's timer: the controller marks itself dirty and tells React of
       the finished answer only when the window closes. */
    sink.delta(TEXT);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(chips(), "the token on the unsettled last line is not drawn yet").toHaveLength(0);
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    expect(chips()).toHaveLength(1);
    expect(mode).toHaveBeenCalledTimes(1);
  });
});
