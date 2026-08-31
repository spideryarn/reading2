// @vitest-environment jsdom
/**
 * **What the reader is left with when a cancel lands before the row is named.**
 *
 * The window is real and it is common — the `begin` frame is emitted
 * immediately after the server writes the conversation, so "no frame yet"
 * mostly means "not written yet". What used to happen in it was written up in
 * docs/postmortems/260828b-cancel-before-begin.md: one `/cancel` went out at once,
 * naming a row this client had invented, and `cancelChat` had two answers for
 * it and both were wrong for the reader.
 *
 * - **The conversation is not on disk yet → `200 { cancelled: true }`**, from
 *   the deliberate `if (!thread)` branch. The client was told it worked.
 *   Nothing aborted, `beginTurn` wrote the conversation a moment later, the
 *   answer ran to completion, and the reader was told they had discarded
 *   something that is still there. The quiet one, and the common one.
 * - **On disk, frame still in flight → `409` on the tail id.**
 *   `askToCancel`'s catch reads any refusal as "the premise was wrong": the
 *   tombstone came off, the conversation came back with an error under it, and
 *   the frames started landing in it again. The reader watched the answer they
 *   cancelled carry on typing.
 *
 * **Stage 2 closes the window rather than picking between those two answers**,
 * and that is why this file changed on 2026-08-28. The two rules, from
 * docs/plans/260828v-chat-operation-model.md: send **once**, when there is an id the
 * server can match; and never read "the server could not match that id" as a
 * refusal *or* as a success, because case one comes back `200`. Both are
 * satisfied by the same move — the turn is an operation now, so the client can
 * ask whether the row has a server name yet, and there is no request to
 * misread until it does.
 *
 * So the two tests below are the same two server answers, asked of the fixed
 * client. The first is now unreachable from this window at all — that is the
 * assertion — and the second has become an honest refusal that means what it
 * says. Neither file was edited to make the stage pass: the old assertions are
 * quoted in each note, and what they described is a bug this stage fixes.
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

describe("a cancel pressed before the row has a name the server would know", () => {
  /**
   * **The `200 { cancelled: true }` case is now out of reach**, and that is the
   * whole of the fix for it.
   *
   * It used to be the common one and the worse one: the request went out while
   * the conversation was still unwritten, `cancelChat` could not find the thread
   * and said "already gone", nothing was aborted, and the answer ran to
   * completion into a conversation the reader believed they had discarded. The
   * old assertions here were `expect(posts).toHaveLength(1)` with the
   * provisional id in it, and `expect(api().error).toBeNull()` — a clean-looking
   * cancel over a conversation that is still there.
   *
   * Now nothing is sent until the `begin` frame, and the `begin` frame is the
   * server saying it has written the conversation. So the request that does go
   * out cannot reach the `!thread` branch by way of this window: it names a
   * thread and a row the server minted a moment earlier.
   */
  it("sends nothing while the server could only answer `already gone`", async () => {
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

    /* The reader's half is unchanged and is not what was ever wrong: the
       conversation leaves the screen the instant they press the button, by
       tombstone, and nothing claims a failure. */
    expect(threadIn(threadId)).toBeUndefined();
    expect(api().error).toBeNull();
    /* **And the server has not been asked anything it could only answer
       wrongly.** This is the assertion that changed. */
    expect(posts, "a cancel went out that the server could only mis-answer").toHaveLength(0);

    /* And now the server names the row — which is the moment it has finished
       writing the conversation, and therefore the first moment there is
       anything real to cancel. */
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

    /* Exactly one request, naming what the server named. `alreadyGone()` still
       answers it here — this stub cannot tell the two ids apart — and that no
       longer matters: a `200 { cancelled: true }` for a row the server minted
       means the conversation really is gone, which is the case the route's
       comment is about. The reader's screen and the server now agree. */
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
    expect(posts.some((p) => p.body.messageId === provisional)).toBe(false);
    expect(threadIn(threadId)).toBeUndefined();
    expect(api().error).toBeNull();
  });

  /**
   * **The 409 case, which is now an honest refusal.**
   *
   * It used to fire on a premise that was never wrong: the client named its own
   * invented id, the route compared it to the tail and refused, and
   * `askToCancel` read that as "another tab moved this on" — so the tombstone
   * came off, the conversation came back with an error under it, and the
   * frames started landing in it again. The reader watched the answer they
   * cancelled carry on typing.
   *
   * The request now names the tail the server itself named a moment earlier, so
   * a 409 means what the route says it means: somebody else really has moved
   * this conversation on. Putting it back is then the right answer rather than
   * an accident, and the assertions below are the same ones — what changed is
   * that they are now describing the intended behaviour rather than a bug.
   */
  it("brings the conversation back when the server refuses a cancel it could match", async () => {
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

    /* Nothing has been asked yet, so nothing has been refused: the conversation
       is off the screen and there is no error under it. */
    expect(posts).toHaveLength(0);
    expect(threadIn(threadId)).toBeUndefined();
    expect(api().error).toBeNull();

    /* The frame arrives — the wish fires, naming the server's row and tail —
       and the server refuses anyway, which now means one thing: somebody else
       moved this conversation on. */
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

    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.expectedTailId).toBe("srv-answer-1");
    /* So it is put back, with a line saying why — the reader must not be left
       believing they discarded a conversation that is still there. */
    expect(threadIn(threadId), "the refused cancel did not put it back").toBeDefined();
    expect(api().error).toMatch(/Couldn't discard that conversation/);

    /* And the answer carries on arriving into it, which is right: the server
       refused to stop it, so it really is still being written. */
    act(() => {
      turn.frame("delta", { text: "Because " });
    });
    await settle();

    expect(threadIn(threadId)?.messages.at(-1)?.text).toBe("Because ");
    // One request, and nothing tries again. This is where the reader is left.
    expect(posts).toHaveLength(1);
  });
});
