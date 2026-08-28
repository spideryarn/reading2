// @vitest-environment jsdom
/**
 * **What the reader is left with when a cancel lands before the row is named.**
 *
 * `tests/chat-intent-paths.test.ts` pins the *requests* in this window: one
 * `/cancel` goes out carrying an id the client invented, and no second one ever
 * follows, because the correction in `nameRow` reads `cancelWanted` after
 * `pendingId` has been reassigned to the server's id and so looks up an id
 * `cancelAndDiscard` never added. That branch is dead.
 *
 * This file asks the next question, which nothing answered: **the doomed
 * request is answered by a real route — so what does the reader see?** Both
 * answers below are read off `cancelChat` in src/routes.ts rather than guessed,
 * and which one the reader gets depends on whether `beginTurn` has written the
 * conversation yet at the moment the button is pressed. Both are reachable and
 * they are not the same failure:
 *
 * - **The server has not written it yet** — `cancelChat` cannot find the thread
 *   and returns `{ cancelled: true }` with a 200, deliberately: "a second tab,
 *   a double-press, or a reader who cancelled and reloaded". The client is told
 *   it worked. Nothing aborts the stream, `beginTurn` writes the conversation a
 *   moment later, and it is on disk with a finished answer in it. **The reader
 *   is told they discarded something that is still there.** This is the common
 *   case, because the `begin` frame is emitted immediately after that write, so
 *   "no frame yet" mostly means "not written yet".
 * - **The server has written it** but the frame has not arrived — the tail is
 *   the server's answer id and the client sent its own, so `tail?.id !==
 *   messageId` and the route throws **409, "That is not the answer at the end
 *   of this conversation"**. `askToCancel`'s catch treats a refusal as "the
 *   premise was wrong": it removes the tombstone, the conversation comes back
 *   on screen with its answer still streaming into it, and an error appears
 *   under it. The reader watches the thing they cancelled carry on typing.
 *
 * Neither is corrected afterwards, because the branch that would re-send is
 * dead. Written to answer team-lead's question before proposing a fix,
 * 2026-08-28. **These pin what the code does today**; the note above each says
 * whether that is defensible.
 *
 * Same harness as tests/chat-intent-paths.test.ts.
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

/**
 * What `cancelChat` returns for a thread it has never written.
 *
 * Not a guess: src/routes.ts, `if (!thread) return { cancelled: true }`, with
 * the comment saying why it is deliberately not an error.
 */
function alreadyGone(): Response {
  return json({ cancelled: true });
}

/**
 * And what it throws when the thread *is* there and the client named the wrong
 * tail — `httpError(409, "That is not the answer at the end of this
 * conversation")`, the second of its three refusals.
 */
function wrongTail(): Response {
  return json({ error: "That is not the answer at the end of this conversation" }, 409);
}

/** A controllable SSE body, so the test decides when `begin` arrives. */
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

let posts: { url: string; body: Record<string, unknown> }[] = [];

function recordPost(url: string, init: RequestInit | undefined): void {
  posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
}

/**
 * Send a question and cancel it before any frame has arrived — the window.
 *
 * The stream is already posed by the caller's `answer`; nothing is pushed into
 * it here, and that absence is the whole setup.
 */
async function sendAndCancel(): Promise<{ threadId: string; provisional: string }> {
  await mount();
  let threadId = "";
  act(() => {
    threadId = api().send(null, "why?", null, false);
  });
  const provisional = threadIn(threadId)?.messages.find((m) => m.role === "assistant")?.id;
  expect(provisional, "the optimistic answer row is missing").toBeTruthy();
  act(() => {
    api().cancelAndDiscard(threadId, provisional as string);
  });
  await settle();
  return { threadId, provisional: provisional as string };
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

describe("a cancel the server cannot match, because the row has no name yet", () => {
  /**
   * The common case, and the worse one: the reader is told it worked.
   *
   * Nothing on screen is wrong, which is exactly the problem — the conversation
   * the server goes on to write is never asked about again, and the only way
   * the reader finds out is the next time they load the article.
   */
  it("is answered `cancelled: true` for a conversation the server has not written yet", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [] }));
      if (url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(alreadyGone());
      }
      if (url.endsWith("/stop")) {
        recordPost(url, init);
        return Promise.resolve(json({ stopped: true }));
      }
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    const { threadId, provisional } = await sendAndCancel();

    // On screen it looks like a clean cancel, and it says nothing went wrong.
    expect(threadIn(threadId)).toBeUndefined();
    expect(api().error).toBeNull();

    /* And now the server names the row — which is the moment it has finished
       writing the conversation the reader believes they discarded. */
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

    /* **Nothing ever asks the server to remove what it actually wrote.** One
       request went out, naming a row the server had never heard of; the
       correction in `nameRow` is dead. `cancelChat` treats a thread it cannot
       find as already gone, so that request deleted nothing and aborted
       nothing — the answer runs to completion and the conversation is on disk.
       The reader sees it again on the next load. */
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.messageId).toBe(provisional);
    expect(posts.some((p) => p.body.messageId === "srv-answer-1")).toBe(false);
    // Still gone from this screen, and still no word of any of it.
    expect(threadIn(threadId)).toBeUndefined();
    expect(api().error).toBeNull();
  });

  /**
   * The narrower case, and the one the team lead asked about: written already,
   * frame not yet here, so the route refuses on the tail id.
   *
   * Here the reader is told something, and what they are told is wrong in the
   * other direction — the cancel *is* refused, so the conversation comes back,
   * with an error under it and an answer still arriving into it.
   */
  it("brings the conversation back with an error under it when the server refuses on the tail", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [] }));
      if (url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(wrongTail());
      }
      if (url.endsWith("/stop")) {
        recordPost(url, init);
        return Promise.resolve(json({ stopped: true }));
      }
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    const { threadId } = await sendAndCancel();

    /* The conversation the reader cancelled is back, because `askToCancel`
       reads a refusal as "the premise was wrong" — which is right when the
       server refused a *real* cancel, and wrong here, where the request never
       named anything the server could act on. */
    expect(threadIn(threadId), "the cancelled conversation did not come back").toBeDefined();
    expect(api().error).toMatch(/Couldn't discard that conversation/);

    /* And the answer carries on arriving into it: the stream was never
       stopped, and the row is no longer tombstoned, so frames land. */
    act(() => {
      turn.frame("begin", {
        threadId,
        title: "why?",
        messageId: "srv-answer-1",
        questionId: "srv-question-1",
        attempt: "att-1",
      });
      turn.frame("delta", { text: "Because " });
    });
    await settle();

    expect(threadIn(threadId)?.messages.at(-1)?.text).toBe("Because ");
    // And nothing tries again, so this is where the reader is left.
    expect(posts).toHaveLength(1);
  });
});
