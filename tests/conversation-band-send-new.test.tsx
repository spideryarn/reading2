// @vitest-environment jsdom
/**
 * **The one line between the panel and the hook.**
 *
 * `tests/chat-list-composer.test.tsx` pins the panel's half of the box under
 * the conversation list: which call the reader's question goes down, and when
 * the box is offered at all. `tests/use-chat-recovery.test.ts` pins the hook's
 * half, that `send(null, …)` mints a conversation rather than joining one. What
 * neither can reach is the line in `ConversationBand` that connects them —
 * `onSendNew` — and that line is exactly where the first version of this
 * feature was wrong: it passed `thread`, the id in `?thread=`, so a reader who
 * opened a bookmarked conversation and typed into the box while the list was
 * still loading had their question **appended to that conversation**, under a
 * placeholder promising a new one.
 *
 * Both sides green and the value between them never exercised is the classic
 * gap, so this test drives the real component with the real hook and reads the
 * one thing that says which conversation the question went to: the `threadId`
 * in the request body.
 *
 * `ChatPanel` is stubbed — it is what the other file tests, it fetches a
 * profile on mount, and what is wanted here is the props it is handed.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

/** The props the band last handed down. */
let panel: Record<string, unknown> | undefined;

vi.mock("../src/web/ChatPanel.js", () => ({
  ChatPanel: (props: Record<string, unknown>) => {
    panel = props;
    return null;
  },
}));

/** Every request the band's hook made, in order. */
const calls: { url: string; method: string; body: unknown }[] = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return {
    ...real,
    apiFetch: (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        url: String(url),
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (method === "POST") return Promise.resolve(stream());
      return Promise.resolve(
        new Response(JSON.stringify({ threads: [STORED] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  };
});

const { ConversationBand } = await import("../src/web/App.js");

const SLUG = "a-piece";

/** A conversation the reader arrived with, and the one `?thread=` names. */
const STORED: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    { id: "m1", role: "user", text: "An earlier question", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    { id: "m2", role: "assistant", text: "An earlier answer", createdAt: "2026-08-27T10:00:01.000Z", status: "done" },
  ],
};

/** An answer that says nothing and does not close. The reply is not the point. */
function stream(): Response {
  const body = new ReadableStream<Uint8Array>({ start() {} });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

let host: HTMLDivElement;
let root: Root;

/* nuqs only sees history writes it did not make once this is on, and main.tsx
   turns it on for the same reason. */
enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  panel = undefined;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The band, in chat mode, with `?thread=` saying what the URL says. */
async function mount(thread: string | null): Promise<void> {
  history.replaceState(null, "", thread ? `/a-piece?mode=chat&thread=${thread}` : "/a-piece?mode=chat");
  await act(async () => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(ConversationBand, {
          slug: SLUG,
          blocks: new Map<string, string>(),
          onJump: () => {},
          kind: "chat" as const,
          onMode: () => {},
        }),
      ),
    );
  });
  await settle();
}

/** The thread id every POST since the last check went to. */
function sentTo(): string[] {
  return calls.filter((c) => c.method === "POST").map((c) => (c.body as { threadId: string }).threadId);
}

/** And what it asked. */
function asked(): string[] {
  return calls.filter((c) => c.method === "POST").map((c) => (c.body as { question: string }).question);
}

describe("the band's onSendNew", () => {
  it("sends to a conversation of its own, not the one the URL names", async () => {
    await mount(STORED.id);
    const send = panel?.onSendNew as (q: string, p?: boolean) => void;
    expect(typeof send).toBe("function");

    await act(async () => {
      send("Something else entirely", false);
    });
    await settle();

    expect(sentTo()).toHaveLength(1);
    expect(sentTo()[0]).not.toBe(STORED.id);
    /* And the question arrived intact. Both this file and
       tests/chat-list-composer.test.tsx would stay green for a band that
       trimmed, truncated or dropped it on the way past — GPT Sol, 2026-08-28. */
    expect(asked()).toEqual(["Something else entirely"]);
    /* And it really did start one — the stored conversation still has the two
       messages it arrived with, rather than a third. */
    const threads = panel?.threads as ChatThread[];
    expect(threads.find((t) => t.id === STORED.id)?.messages).toHaveLength(2);
    expect(threads.find((t) => t.id === sentTo()[0])?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  /* And the URL follows it, or a reload lands on the conversation the reader
     has just left rather than the one they just started. */
  it("moves ?thread= to the conversation it started", async () => {
    await mount(STORED.id);
    const send = panel?.onSendNew as (q: string, p?: boolean) => void;
    await act(async () => {
      send("Something else entirely", false);
    });
    await settle();

    expect(panel?.threadId).toBe(sentTo()[0]);
    /* nuqs writes the address on a throttle of its own rather than on the
       render, so a `setTimeout(0)` flush does not see it. Waited for rather
       than slept through: a fixed delay bakes nuqs's current 50ms into this
       file, and would go quietly green-then-flaky if it ever changed. */
    await vi.waitFor(() => {
      expect(new URLSearchParams(location.search).get("thread")).toBe(sentTo()[0]);
    });
  });

  /* The composer takes the caret when the nonce rises, and a reader who typed
     to start a conversation should still have one in the box that replaces the
     box they typed into. */
  it("raises the focus nonce, so the caret carries into the new conversation", async () => {
    await mount(STORED.id);
    const before = panel?.focusNonce as number;
    const send = panel?.onSendNew as (q: string, p?: boolean) => void;
    await act(async () => {
      send("Something else entirely", false);
    });
    await settle();

    expect(panel?.focusNonce).toBe(before + 1);
  });
});
