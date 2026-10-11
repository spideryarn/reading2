// @vitest-environment jsdom
/**
 * **The guide suggests a mode; it never opens one itself** — plan
 * docs/plans/261011m-guide-suggests-a-mode-with-a-button-a-bigger-chat-box-suggestions-centred.md,
 * stage 1, reversing item 1 of plan 261007p. Greg, 2026-10-11, `spya-gae0zv`:
 *
 * > I think instead it should suggest things, with a UI button for them to
 * > press that would take them to that mode, so that they're aware of what's
 * > happening.
 *
 * The case the act used to take: a guide answer whose chip only moves the
 * reader (Structure), streamed through a real `ChatController` into the real
 * `ChatPanel` and finished on screen. Until 261011m that chip pressed itself
 * when the answer finished; now the mode stays where it was and the chip is a
 * button that works when pressed. Frames arrive outside `act`, as in the app.
 */
import { act, createElement, useSyncExternalStore } from "react";
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

const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { ChatCommands } = await import("../src/web/CommandChip.js");

const SLUG = "a-guided-article";
const THREAD = "spya-gdsnth";
const REPLY = "spya-gdsnrp";
const AT = "2026-10-11T11:00:00.000Z";
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

function setUp() {
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
  const c = new ChatController(SLUG, effects);
  /* The reader's armed runner: the only way a chip opens a mode. */
  const mode = vi.fn((_p: { key: string }) => CLOSE);
  const executor = { runners: { mode }, sources: { modes: MODES } };

  function Band() {
    const snap = useSyncExternalStore(c.subscribe, c.getSnapshot);
    return <ChatCommands executor={executor}>{createElement(ChatPanel, {
        slug: SLUG,
        threads: [...snap.threads],
        threadId: THREAD,
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
        onDeleteFrom: undefined,
        onStop: () => {},
        focusNonce: 0,
        error: null,
        kind: "guide",
      })}</ChatCommands>;
  }

  const reply: ChatMessage = { id: REPLY, role: "assistant", text: "", createdAt: AT, status: "pending" };
  c.startTurn({
    type: "turn.started",
    op: {
      id: asOpId("spya-gdsnop"),
      kind: "turn",
      shape: "send",
      threadId: THREAD,
      replyId: REPLY,
      reply,
      question: { id: "spya-gdsnqn", role: "user", text: "Any suggestions?", createdAt: AT, status: "done" },
      editing: null,
      opening: { id: THREAD, title: "Guide", createdAt: AT, updatedAt: AT, kind: "guide", messages: [] },
      title: null,
      at: AT,
      began: false,
      attempt: null,
    },
    payload: {},
  }, () => {});
  root.render(createElement(Band));
  const s = sink as TurnSink | null;
  if (!s) throw new Error("the turn did not open its stream");
  return { sink: s, mode };
}

const TEXT = ["Structure would show you how the parts fit. Press it to open it.", "", "[cmd:mode:mode%3Astructure]"].join("\n");
const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];

describe("a guide answer that names a mode which only moves the reader", () => {
  it("finishes on screen without opening it, and opens it when the reader presses its button", async () => {
    const { sink, mode } = setUp();
    await settle();
    sink.began({ threadId: THREAD, title: "Guide", messageId: REPLY });
    await settle();
    sink.delta(TEXT);
    await settle();
    sink.done({ text: TEXT, citations: [], searches: 0, model: "m" });
    await settle();
    const drawn = chips();
    expect(drawn, "the finished answer drew its token as a chip").toHaveLength(1);
    expect(drawn[0]?.disabled, "and the chip can be pressed").toBe(false);
    expect(mode, "the mode is where it was: nothing opened by itself").not.toHaveBeenCalled();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    act(() => drawn[0]?.click());
    expect(mode).toHaveBeenCalledTimes(1);
    expect(mode.mock.calls[0]?.[0].key).toBe("mode:structure");
  });
});
