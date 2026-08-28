// @vitest-environment jsdom
/**
 * **What the reader actually does: presses the button, and the panel closes.**
 *
 * Every other chat test in this repo mounts the hook and keeps it mounted for
 * the whole test. That is not the lifecycle production has. `ChatDialog`'s
 * cancel button calls `cancelAndDiscard` and then `onClose()` on the very next
 * line (src/web/ChatDialog.tsx), so the dialog unmounts in the same tick — and
 * the `begin` frame that the wish is waiting for arrives afterwards, into a hook
 * that is gone.
 *
 * GPT Sol found the bug that hides there (docs/plans/chat-operation-model-stage2-review-sol.md,
 * finding 1): the wish was consumed by `controller.onNamed`, a callback the hook
 * installed in an effect and *cleared in that effect's cleanup*. Unmount, and
 * nothing was left to send the `/cancel`. The server finished the answer, stored
 * the conversation, and it came back on the reader's next reload — while the
 * screen, and every test, said it had gone.
 *
 * So this file is the lifecycle rather than one bug: **mount, act, unmount, then
 * let the world answer.** The stream is driven by the test, so the frames can be
 * pushed at any point on either side of the unmount, and the assertions are on
 * the *requests* that left the tab, because after unmount there is no screen
 * left to ask. That is the same reason tests/chat-intent-paths.test.ts asserts on
 * `posts` — docs/postmortems/cancel-before-begin.md § what would have caught this.
 *
 * The controller survives the unmount on purpose and that is what makes the fix
 * possible: the in-flight stream still holds it, so the reducer still runs, and
 * the command the reducer emits is performed by the controller rather than by
 * anything React owns.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  end(): void;
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
    end() {
      ctrl.close();
    },
  };
}

let container: HTMLDivElement;
let root: Root;
let mounted = false;
let chat: ReturnType<typeof useChat> | undefined;

function Harness() {
  chat = useChat(SLUG);
  return null;
}

/** The hook, insisting it is still mounted. */
function api(): ReturnType<typeof useChat> {
  if (!mounted || !chat) throw new Error("the hook is not mounted");
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
  mounted = true;
  await settle();
}

/**
 * **The whole point of this file.** The reader's panel closes; React tears the
 * hook down, runs every effect cleanup, and drops its reference to the
 * controller. Anything still in flight has to finish the job on its own.
 */
async function unmount(): Promise<void> {
  await act(async () => root.unmount());
  mounted = false;
  await settle();
}

/** Every POST this test has seen, in order, by full URL. */
let posts: { url: string; body: Record<string, unknown> }[] = [];

function recordPost(url: string, init: RequestInit | undefined): void {
  posts.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
}

/** The ordinary answers: an empty list, a stream for the turn, 200 for a wish. */
function serve(turn: { stream: ReadableStream<Uint8Array> }): void {
  answer = (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return Promise.resolve(json({ threads: [] }));
    if (url.endsWith("/stop") || url.endsWith("/cancel")) {
      recordPost(url, init);
      return Promise.resolve(json({ stopped: true, cancelled: true }));
    }
    return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
  };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  posts = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(async () => {
  if (mounted) await unmount();
  container.remove();
});

describe("a cancel pressed before the begin frame, with the dialog then closed", () => {
  /**
   * **The production sequence, in order, and the one no test had.**
   *
   * `ChatDialog.tsx:245` — `cancelAndDiscard(...)`, `onDropped(...)`,
   * `onClose()`. The dialog goes. Then the server names the row.
   */
  it("still sends exactly one /cancel after the hook has gone", async () => {
    const turn = controllableStream();
    serve(turn);
    await mount();

    let threadId = "";
    act(() => {
      threadId = api().send(null, "why?", null, false);
    });
    const provisional = api()
      .threads.find((t) => t.id === threadId)
      ?.messages.find((m) => m.role === "assistant")?.id;
    expect(provisional).toBeTruthy();

    act(() => {
      api().cancelAndDiscard(threadId, provisional as string);
    });
    expect(posts, "a cancel went out before the server could name the row").toHaveLength(0);

    // The dialog closes. This is the line every other test does not have.
    await unmount();

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

    expect(posts, "the cancel was lost when the dialog closed").toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/cancel`);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
    expect(posts[0]?.body.expectedTailId).toBe("srv-answer-1");
  });

  /**
   * The same for a stop, which reaches the window a different way — the composer
   * stays mounted, but a reader who presses Escape and then navigates away in
   * the same beat is the same lifecycle.
   */
  it("still sends exactly one /stop after the hook has gone", async () => {
    const turn = controllableStream();
    serve(turn);
    await mount();

    let threadId = "";
    act(() => {
      threadId = api().send(null, "why?", null, false);
    });
    const provisional = api()
      .threads.find((t) => t.id === threadId)
      ?.messages.find((m) => m.role === "assistant")?.id;

    act(() => {
      api().stop(threadId, provisional as string);
    });
    expect(posts).toHaveLength(0);

    await unmount();

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

    expect(posts, "the stop was lost when the composer went").toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/stop`);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
  });

  /**
   * **And the control**, without which the two above would pass on a client that
   * fires a `/cancel` at every `begin` frame it ever sees. A turn nobody pressed
   * anything on sends nothing, mounted or not.
   */
  it("sends nothing at begin when the reader pressed nothing", async () => {
    const turn = controllableStream();
    serve(turn);
    await mount();

    let threadId = "";
    act(() => {
      threadId = api().send(null, "why?", null, false);
    });
    await unmount();

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

    expect(posts).toHaveLength(0);
  });
});
