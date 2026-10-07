// @vitest-environment jsdom
/**
 * **The guide's conversation hears its answer finish, and lets that answer act**
 * — plan
 * docs/plans/261007p-the-guide-acts-without-a-press-and-opens-every-new-article.md,
 * Item 1. ChatPanel.tsx § `Conversation`: it subscribes to `onAnswered` only
 * when it is the guide and on screen, and hands a fresh `GuideAct` to the one
 * answer the event names.
 *
 * The real `Conversation`, inside the real `ChatCommands` provider, with a fake
 * `onAnswered` that the test fires by hand — the event itself is
 * tests/guide-acts-controller.test.ts, and the chip's half is
 * tests/guide-acts-chips.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, ChatThread, ThreadKind } from "../src/types.js";
import type { Answered } from "../src/web/chat/controller.js";
import type { ActionOutcome } from "../src/web/command-match.js";
import type { CommandExecutor, ModeTarget } from "../src/web/command-proposal.js";

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

const { Conversation } = await import("../src/web/ChatPanel.js");
const { ChatCommands } = await import("../src/web/CommandChip.js");

const AT = "2026-10-07T09:00:00.000Z";
const THREAD = "spya-gdeact";
const QUESTION = "spya-gdeaqn";
const REPLY = "spya-gdearp";
const ANSWER_TEXT = "I've opened Structure for you.\n\n[cmd:mode:mode%3Astructure]";
const CLOSE: ActionOutcome = { kind: "close" };

const MODES = new Map<string, ModeTarget>([
  ["mode:structure", { key: "mode:structure", label: "Structure", description: "Its shape.", generates: false }],
  ["mode:glossary", { key: "mode:glossary", label: "Glossary", description: "Its terms.", generates: true }],
]);

function reply(over: Partial<ChatMessage> = {}): ChatMessage {
  return { id: REPLY, role: "assistant", text: ANSWER_TEXT, createdAt: AT, status: "done", ...over };
}

function thread(kind: ThreadKind, answer: ChatMessage = reply()): ChatThread {
  return {
    id: THREAD,
    kind,
    title: "Guide",
    createdAt: AT,
    updatedAt: AT,
    messages: [{ id: QUESTION, role: "user", text: "Where do I start?", createdAt: AT, status: "done" }, answer],
  };
}

/** A stand-in for `useChat`'s `onAnswered`: keeps its listeners for the test to fire. */
function answeredHub() {
  const listeners = new Set<(a: Answered) => void>();
  return {
    subscribe: (listener: (a: Answered) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    fire(a: Omit<Answered, "startedThreadId" | "opensFree"> & { opensFree?: ReadonlySet<string> }) {
      act(() => {
        for (const l of [...listeners]) l({ opensFree: new Set(), ...a, startedThreadId: a.threadId });
      });
    },
    get size() {
      return listeners.size;
    },
  };
}

let host: HTMLDivElement;
let root: Root;
let mode: ReturnType<typeof vi.fn<(p: { key: string }) => ActionOutcome>>;
let executor: CommandExecutor;

function paint(t: ChatThread, hub: ReturnType<typeof answeredHub>, over: { visible?: boolean } = {}): void {
  act(() => {
    root.render(
      <ChatCommands executor={executor}>{createElement(Conversation, {
          slug: "a-piece",
          thread: t,
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
          kind: t.kind,
          visible: over.visible ?? true,
          onAnswered: hub.subscribe,
        })}</ChatCommands>,
    );
  });
}

const chips = (): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>("button.cmd-chip")];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mode = vi.fn((_p: { key: string }) => CLOSE);
  executor = { runners: { mode }, sources: { modes: MODES }, openModeUnarmed: mode };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the guide's conversation", () => {
  it("lets its just-finished answer open the mode its chip names, once", () => {
    const hub = answeredHub();
    const t = thread("guide");
    paint(t, hub);
    expect(chips(), "the answer's token is drawn as a chip").toHaveLength(1);
    expect(mode, "a transcript on screen runs nothing by itself").not.toHaveBeenCalled();
    hub.fire({ threadId: THREAD, message: reply() });
    expect(mode).toHaveBeenCalledTimes(1);
    /* The answer re-renders (a later notification) and nothing runs again. */
    paint({ ...t, messages: [...t.messages] }, hub);
    expect(mode).toHaveBeenCalledTimes(1);
  });

  it("acts again for the next answer, and only once for it", () => {
    const hub = answeredHub();
    paint(thread("guide"), hub);
    hub.fire({ threadId: THREAD, message: reply() });
    hub.fire({ threadId: THREAD, message: reply() });
    expect(mode).toHaveBeenCalledTimes(2);
  });

  it("does not act for a stopped answer", () => {
    const hub = answeredHub();
    const stopped = reply({ stopped: true });
    paint(thread("guide", stopped), hub);
    hub.fire({ threadId: THREAD, message: stopped });
    expect(mode).not.toHaveBeenCalled();
  });

  it("does not act for an answer in another conversation", () => {
    const hub = answeredHub();
    paint(thread("guide"), hub);
    hub.fire({ threadId: "spya-othert", message: reply() });
    expect(mode).not.toHaveBeenCalled();
  });

  it("does not act for a transcript drawn with a finished answer and no event", () => {
    const hub = answeredHub();
    paint(thread("guide"), hub);
    paint(thread("guide"), hub);
    expect(chips()).toHaveLength(1);
    expect(mode).not.toHaveBeenCalled();
  });

  it("does not listen, or act, while it is not on screen", () => {
    const hub = answeredHub();
    paint(thread("guide"), hub, { visible: false });
    expect(hub.size).toBe(0);
    hub.fire({ threadId: THREAD, message: reply() });
    expect(mode).not.toHaveBeenCalled();
  });

  it("does not act later when a chip disabled at completion becomes enabled", () => {
    const hub = answeredHub();
    const enabled = executor;
    executor = { ...enabled, runners: {} };
    paint(thread("guide"), hub);
    hub.fire({ threadId: THREAD, message: reply() });
    expect(chips()[0]?.disabled).toBe(true);
    expect(mode).not.toHaveBeenCalled();
    executor = enabled;
    paint(thread("guide"), hub);
    expect(chips()[0]?.disabled).toBe(false);
    expect(mode).not.toHaveBeenCalled();
  });
});

describe("any other conversation", () => {
  it("does not act on an ordinary chat's finished answer", () => {
    const hub = answeredHub();
    paint(thread("chat"), hub);
    expect(chips(), "chat draws the same chip").toHaveLength(1);
    expect(hub.size, "chat does not listen").toBe(0);
    hub.fire({ threadId: THREAD, message: reply() });
    expect(mode).not.toHaveBeenCalled();
  });
});

/* Plan 261008a: the server's snapshot reaches the act through `Answered`. */
describe("a guide answer that opens a mode already made", () => {
  const glossaryReply = reply({ text: "I've opened the Glossary for you.\n\n[cmd:mode:mode%3Aglossary]" });

  it("opens the Glossary when the server said it was made for this turn", () => {
    const hub = answeredHub();
    paint(thread("guide", glossaryReply), hub);
    hub.fire({ threadId: THREAD, message: glossaryReply, opensFree: new Set(["mode:glossary"]) });
    expect(mode).toHaveBeenCalledTimes(1);
    expect(mode.mock.calls[0]?.[0].key).toBe("mode:glossary");
  });

  it("leaves it a button when the server did not", () => {
    const hub = answeredHub();
    paint(thread("guide", glossaryReply), hub);
    hub.fire({ threadId: THREAD, message: glossaryReply });
    expect(chips()).toHaveLength(1);
    expect(mode).not.toHaveBeenCalled();
  });
});
