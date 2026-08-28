// @vitest-environment jsdom
/**
 * Characterisation tests for the stop/cancel-before-`begin` window, a refused
 * cancel, and `onThreadId` — the last four items on
 * docs/plans/chat-operation-model-acceptance.md, and named by Sol as the ones
 * that must be pinned before the stage that rewrites `turn.began` and moves
 * command delivery, because that stage *is* the machinery holding these
 * wishes.
 *
 * **These pin what the code does today, not what it should do.** Where that is
 * debatable, the note says so rather than asserting a preference.
 *
 * Same harness as tests/chat-error-scope.test.ts: React's own `act` and
 * `createRoot`, no testing library, `apiFetch` stubbed with the real `readJson`
 * and `failure` behind it. Streams are driven with an explicit controller, so
 * a test can call `stop` or `cancelAndDiscard` before pushing the `begin`
 * frame and see what went out in between.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatThread } from "../src/types.js";

/** What the next request answers with. Posed per test, by method and URL. */
let answer: (url: string, init?: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...real, apiFetch: (url: string, init?: RequestInit) => answer(String(url), init) };
});

const { useChat } = await import("../src/web/useChat.js");

const SLUG = "an-article";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A controllable SSE body: `frame` pushes one event, at whatever moment the test chooses. */
function controllableStream(): {
  stream: ReadableStream<Uint8Array>;
  frame(event: string, data: unknown): void;
} {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    frame(event, data) {
      ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;

function Harness() {
  chat = useChat(SLUG);
  return null;
}

/** The hook, insisting it is mounted. */
function api(): ReturnType<typeof useChat> {
  if (!chat) throw new Error("the hook is not mounted");
  return chat;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
}

function threadIn(id: string): ChatThread | undefined {
  return chat?.threads.find((t) => t.id === id);
}

/** Every POST this test has seen, in order, by full URL. */
let posts: { url: string; body: Record<string, unknown> }[] = [];

function recordPost(url: string, init: RequestInit | undefined): void {
  posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  posts = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("a stop pressed before the begin frame", () => {
  it("posts /stop with whatever id it is given immediately, and again with the server's id and attempt once begin names the row", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [] }));
      if (url.endsWith("/stop") || url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(json({ stopped: true }));
      }
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    await mount();

    let threadId = "";
    act(() => {
      threadId = api().send(null, "why?", null, false);
    });
    const provisional = threadIn(threadId)?.messages.find((m) => m.role === "assistant")?.id;
    expect(provisional).toBeTruthy();

    act(() => {
      api().stop(threadId, provisional as string);
    });

    // Before `begin`: this file's own docstring on `stopWanted` says a stop
    // here is "remembered and sent as soon as there is an id to send it
    // with", read as if only one request goes out. What actually happens is
    // this: `stop` posts immediately, with whatever id it was given — the
    // provisional one, which the server has never heard of.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/stop`);
    expect(posts[0]?.body.messageId).toBe(provisional);
    expect(posts[0]?.body.attempt).toBeUndefined();

    act(() => {
      turn.frame("begin", {
        threadId,
        title: "why?",
        messageId: "srv-answer-1",
        questionId: "srv-question-1",
        attempt: "att-1",
      });
    });
    await settle();

    // A second /stop goes out, this time with the server's id and attempt —
    // the wish recorded in `stopWanted` is still there and `nameRow` honours
    // it. Two requests total, not the one the acceptance item names.
    expect(posts).toHaveLength(2);
    expect(posts[1]?.url).toBe(`/api/chat/${SLUG}/${threadId}/stop`);
    expect(posts[1]?.body.messageId).toBe("srv-answer-1");
    expect(posts[1]?.body.attempt).toBe("att-1");
  });
});

describe("a cancel pressed before the begin frame", () => {
  it("posts /cancel immediately and again after begin, and never posts /stop", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [] }));
      if (url.endsWith("/stop") || url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(json({ stopped: true }));
      }
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    await mount();

    let threadId = "";
    act(() => {
      threadId = api().send(null, "why?", null, false);
    });
    const provisional = threadIn(threadId)?.messages.find((m) => m.role === "assistant")?.id;
    expect(provisional).toBeTruthy();

    act(() => {
      api().cancelAndDiscard(threadId, provisional as string);
    });

    // Same shape as `stop`: an immediate post with the provisional id, not
    // the "cannot have sent anything real yet" the comment on `nameRow`
    // claims of it — a request does go out, it is just doomed to be refused
    // or ignored, because the server has never heard of that id.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/cancel`);
    expect(posts[0]?.body.messageId).toBe(provisional);
    expect(posts[0]?.body.expectedTailId).toBe(provisional);

    act(() => {
      turn.frame("begin", {
        threadId,
        title: "why?",
        messageId: "srv-answer-1",
        questionId: "srv-question-1",
        attempt: "att-1",
      });
    });
    await settle();

    /* No second /cancel — unlike `stop`. In `nameRow`, `pendingId` is
       reassigned to `begun.messageId` *before* the cancel check runs, but
       *after* the stop check runs (see the ordering in useChat.ts). So
       `cancelWanted.current.delete(pendingId)` is deleting the server's id,
       which was never added — `cancelAndDiscard` only ever added the
       provisional one. The wish is never found, never re-sent, and the
       correction `stop` gets never happens here: only the first, doomed
       request — the one the server has never heard of — ever goes out. A
       cancel pressed in this window has removed the conversation from every
       screen but very possibly never told the server to stop the answer.
       Characterised as-is; this reads like a real bug, not an intended
       asymmetry with `stop`. */
    expect(posts).toHaveLength(1);

    // The one thing that does hold: stop and cancel never both fire on the
    // same row. No request to /stop at any point.
    expect(posts.some((p) => p.url.endsWith("/stop"))).toBe(false);
  });
});

describe("a refused cancel", () => {
  const stored: ChatThread = {
    id: "spya-th01",
    kind: "chat",
    title: "an earlier conversation",
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    messages: [
      { id: "msg-q", role: "user", text: "why?", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
      {
        id: "msg-a",
        role: "assistant",
        text: "Half an ",
        createdAt: "2026-08-27T10:00:01.000Z",
        status: "pending",
      },
    ],
  };

  it("puts the conversation back, and says so in error", async () => {
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [stored] }));
      if (url.endsWith("/cancel")) {
        return Promise.resolve(json({ error: "Someone else has moved this on." }, 409));
      }
      throw new Error(`unexpected request: ${method} ${url}`);
    };
    await mount();
    expect(threadIn(stored.id)).toBeDefined();

    // Synchronous, not `await act(async () => ...)`: the mocked 409 resolves
    // on the next microtask, and an async act call flushes those before
    // returning — which would hide the removed state this line checks for.
    act(() => {
      api().cancelAndDiscard(stored.id, "msg-a");
    });
    // Removed immediately, before the 409 is known.
    expect(threadIn(stored.id)).toBeUndefined();

    await settle();

    expect(threadIn(stored.id)?.id).toBe(stored.id);
    expect(api().error).toContain("discard");
  });
});

describe("onThreadId", () => {
  it("fires when the begin frame carries a different thread id than the one sent", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [] }));
      if (url.endsWith("/stop") || url.endsWith("/cancel")) return Promise.resolve(json({ stopped: true }));
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    await mount();

    const overruled: string[] = [];
    let sent = "";
    act(() => {
      sent = api().send(null, "why?", null, false, (id) => overruled.push(id));
    });
    expect(overruled).toEqual([]);

    act(() => {
      turn.frame("begin", {
        threadId: "srv-different-thread",
        title: "why?",
        messageId: "srv-answer-1",
        questionId: "srv-question-1",
      });
    });
    await settle();

    expect(sent).not.toBe("srv-different-thread");
    expect(overruled).toEqual(["srv-different-thread"]);
  });
});
