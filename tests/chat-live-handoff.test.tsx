// @vitest-environment jsdom
/**
 * **Send hands over from the live session, and waits.**
 *
 * One conversation, two input methods, one speaker at a time. A reader may hold
 * a draft while talking; pressing Send gracefully ends the conversation and only
 * then uses the typed path.
 *
 * **The wait is the whole test.** A typed turn claims the conversation's tail,
 * and the flush the hang-up starts is about to move it — so an unawaited
 * handoff turns the expected-tail guard into a 409 we inflicted on ourselves,
 * which the reader sees as their question being refused for no reason they
 * could act on. It is also invisible in development, where everything is fast
 * and the flush usually wins the race.
 *
 * The other half is that the Live button is offered **only where there is a
 * conversation to have** — the box under the thread list starts a new one, and
 * a session there would have nothing to be seeded from and no tail to claim.
 *
 * docs/plans/live-conversation-in-chat.md § 1d and § 4.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatMessage, ChatThread } from "../src/types.js";
import type { LiveApi } from "../src/web/live/useLiveConversation.js";

/* The profile hook fetches on mount, and this test is about a textarea. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { ChatPanel } = await import("../src/web/ChatPanel.js");

const AT = "2026-08-31T12:00:00.000Z";
const message = (id: string, role: ChatMessage["role"], text: string): ChatMessage => ({
  id,
  role,
  text,
  createdAt: AT,
  status: "done",
});

const THREAD: ChatThread = {
  kind: "chat",
  id: "spya-k3m9qt",
  title: "An earlier conversation",
  createdAt: AT,
  updatedAt: AT,
  messages: [message("spya-msgu01", "user", "typed"), message("spya-msga01", "assistant", "answered")],
};

/** What the panel did, in order. */
let events: string[] = [];
let host: HTMLDivElement;
let root: Root;

/** A live session that takes a controllable amount of time to hang up. */
function fakeLive(phase: LiveApi["phase"]): { api: LiveApi; finish: () => void } {
  let release!: () => void;
  const done = new Promise<void>((r) => {
    release = r;
  });
  const api = {
    phase,
    error: null,
    lines: [],
    pointers: [],
    tools: [],
    hearing: false,
    speaking: false,
    seen: {},
    placement: null,
    threadId: THREAD.id,
    start: () => {},
    stop: () => {
      events.push("stop");
      return done;
    },
    say: () => {},
  } satisfies LiveApi;
  return { api, finish: () => release() };
}

function paint(live?: LiveApi, threadId: string | null = THREAD.id): void {
  act(() => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
        loaded: true,
        loadFailed: false,
        threads: [THREAD],
        threadId,
        onThread: () => {},
        onSend: (q: string) => {
          events.push(`send:${q}`);
        },
        onNew: () => {},
        onSendNew: (q: string) => {
          events.push(`sendNew:${q}`);
        },
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
        ...(live ? { live, onStartLive: () => events.push("startLive") } : {}),
      }),
    );
  });
}

function box(): HTMLTextAreaElement {
  const el = host.querySelector<HTMLTextAreaElement>("textarea.chat-input");
  if (!el) throw new Error("no composer");
  return el;
}

/** Type, then press Enter — the way a reader actually sends. */
function ask(question: string): void {
  const el = box();
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(el, question);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
}

beforeEach(() => {
  events = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("Send while a live conversation is running", () => {
  it("does NOT send until the hang-up has finished", async () => {
    /* The bug this prevents is a 409 nobody could act on: the typed turn claims
       the conversation's tail while the flush is still moving it. It is also
       invisible in development, where the flush usually wins the race. */
    const { api, finish } = fakeLive("live");
    paint(api);
    ask("and what about the ending?");

    await act(async () => {
      await Promise.resolve();
    });
    expect(events, "the typed turn went before the flush had finished").toEqual(["stop"]);

    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(events).toEqual(["stop", "send:and what about the ending?"]);
  });

  it("sends straight away when there is no session to end", async () => {
    /* No pointless await on the ordinary path — every typed turn in the app
       goes through this line. */
    const { api } = fakeLive("idle");
    paint(api);
    ask("just typing");
    await act(async () => {
      await Promise.resolve();
    });
    expect(events).toEqual(["send:just typing"]);
  });

  it("does not wait on a session that already failed", async () => {
    /* `failed` is a session that never got going. Waiting for its hang-up would
       be waiting for a teardown that has already happened, and the reader's
       question would sit there. */
    const { api } = fakeLive("failed");
    paint(api);
    ask("carry on");
    await act(async () => {
      await Promise.resolve();
    });
    expect(events).toEqual(["send:carry on"]);
  });
});

describe("where the button is offered", () => {
  it("is in the composer of a conversation", () => {
    const { api } = fakeLive("idle");
    paint(api);
    expect(host.querySelector(".chat-live-btn")).not.toBeNull();
  });

  it("is NOT under the thread list, which starts a new conversation", () => {
    /* A live session is bound to one thread — seeded from it, appended to it —
       so a box whose whole job is to mint a *different* one has nothing to
       offer it. */
    const { api } = fakeLive("idle");
    paint(api, null);
    expect(host.querySelector("textarea.chat-input"), "no box to check").not.toBeNull();
    expect(host.querySelector(".chat-live-btn")).toBeNull();
  });

  it("is absent entirely when the panel was given no session", () => {
    /* `ChatDialog` mounts the same composer and owns no session. It must not
       render a dead button. */
    paint();
    expect(host.querySelector(".chat-live-btn")).toBeNull();
  });
});
