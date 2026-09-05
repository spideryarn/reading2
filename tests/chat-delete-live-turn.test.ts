// @vitest-environment jsdom
/**
 * **Deleting a conversation while an answer is streaming into it.**
 *
 * Nothing in `tests/` covered this until 2026-08-28 — not the reducer suite,
 * not the characterisation net — and a browser pass reported the delete button
 * doing nothing under exactly these conditions. That pass ran against a working
 * tree three agents were editing at once, with HMR failing and the dev server
 * dying under it, so it is weak evidence about the code; the gap in the tests
 * was real either way, and this is it.
 *
 * Three things have to hold at once, and only the first is obvious:
 *
 * - the DELETE actually leaves the tab. A conversation vanishing from the
 *   screen is not evidence the server heard about it — that is the whole shape
 *   of docs/postmortems/260828b-cancel-before-begin.md, where the screen was right and
 *   the request was never sent;
 * - it goes and **stays** gone, however the still-open stream ends. The turn is
 *   still running, and its frames go on arriving for as long as the server keeps
 *   writing;
 * - a second press changes neither. The button is armed rather than instant
 *   (`ArmedDelete` in ChatPanel.tsx), so two presses in a row is what a reader
 *   who is not sure it worked will do.
 *
 * Same harness as tests/chat-unmounted-turn.test.ts: React's own `act` and
 * `createRoot`, `apiFetch` stubbed, and the turn's stream driven frame by frame
 * by the test so that "while it is streaming" is a real state rather than a
 * hopeful comment.
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
const THREAD = "spya-th01";

const stored: ChatThread = {
  id: THREAD,
  kind: "chat",
  title: "one the reader is in the middle of",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    { id: "msg-q", role: "user", text: "why?", createdAt: "2026-08-27T10:00:00.000Z", status: "done" },
    {
      id: "msg-a",
      role: "assistant",
      text: "because.",
      createdAt: "2026-08-27T10:00:01.000Z",
      status: "done",
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A controllable SSE body: `frame` pushes one event, at the test's moment. */
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

/** Every request that was not the list fetch or the turn, in order. */
let sent: { method: string; url: string }[] = [];

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  sent = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** A turn streaming into the stored conversation, one word in. */
async function streaming(): Promise<ReturnType<typeof controllableStream>> {
  const turn = controllableStream();
  answer = (url, init) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return Promise.resolve(json({ threads: [stored] }));
    if (method === "DELETE") {
      sent.push({ method, url });
      return Promise.resolve(json({}));
    }
    if (method === "POST" && url === `/api/chat/${SLUG}`) {
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    }
    sent.push({ method, url });
    return Promise.resolve(json({}));
  };
  await mount();

  act(() => {
    api().send(THREAD, "and what about this?", null, { useProfile: false });
  });
  act(() => {
    turn.frame("begin", {
      threadId: THREAD,
      title: stored.title,
      messageId: "srv-answer-1",
      questionId: "srv-question-1",
      attempt: "att-1",
    });
  });
  act(() => {
    turn.frame("delta", { text: "Half an " });
  });
  await settle();
  expect(threadIn(THREAD)?.messages.at(-1)).toMatchObject({ text: "Half an ", status: "pending" });
  return turn;
}

describe("deleting a conversation an answer is streaming into", () => {
  it("sends the DELETE, and the stream cannot put the conversation back", async () => {
    const turn = await streaming();

    await act(async () => {
      api().remove(THREAD);
    });

    /* **The request left the tab.** Asserted before anything about the screen,
       because the screen being right while the request was never sent is the
       exact failure docs/postmortems/260828b-cancel-before-begin.md is about. */
    expect(sent, "no DELETE went out").toEqual([
      { method: "DELETE", url: `/api/chat/${SLUG}/${THREAD}` },
    ]);
    expect(threadIn(THREAD), "the conversation was still on screen").toBeUndefined();

    /* And the turn is still running. Its frames go on arriving for as long as
       the server keeps writing, and not one of them may put the conversation
       back: the tombstone is `final`, and a tombstoned conversation is
       projected away whatever is laid over it. */
    act(() => {
      turn.frame("delta", { text: "hour ago." });
    });
    act(() => {
      turn.frame("done", {
        text: "Half an hour ago.",
        citations: [],
        searches: 0,
        model: "m",
      });
    });
    await settle();

    expect(threadIn(THREAD), "a frame put a deleted conversation back").toBeUndefined();
    expect(api().error, "the delete reported a failure it did not have").toBeNull();
  });

  /**
   * The button is armed rather than instant, so two presses is what a reader
   * who is not sure it worked will do — and it is what the browser pass did.
   */
  it("stays gone when the reader presses delete twice", async () => {
    await streaming();

    await act(async () => {
      api().remove(THREAD);
    });
    await act(async () => {
      api().remove(THREAD);
    });
    await settle();

    expect(threadIn(THREAD), "a second delete brought the conversation back").toBeUndefined();
    expect(sent.every((r) => r.method === "DELETE")).toBe(true);
    expect(sent.length, "the second press sent nothing at all").toBeGreaterThanOrEqual(1);
    expect(api().error).toBeNull();
  });

  /**
   * **`discard` refuses where `remove` does not, and that difference is on
   * purpose.**
   *
   * `thread.discarded` is the local forget for a conversation nobody has said
   * anything in — no request, no confirmation, nothing to lose — and it refuses
   * while a turn is drawing into the conversation, because a retry or an edit
   * writes nothing to `base` and a conversation being rewritten can therefore
   * look empty while the reader is watching it. `remove` is the real delete and
   * must never refuse: a delete that quietly does nothing is the same
   * silent-success shape as the cancel bug.
   *
   * The panel cannot confuse them. `onDelete` — both the list's row button and
   * `ArmedDelete` inside a conversation — always calls `remove`. `onDiscard` is
   * called from exactly one place, `leave()` in ChatPanel.tsx, and only when the
   * conversation **on screen** has no messages and no unsent draft; a turn
   * drawing into it puts rows on screen, so that test is false while anything is
   * streaming.
   *
   * What this pins is the reachable half: the reader's delete goes to the server
   * whatever else is happening, and the local forget cannot take a conversation
   * with anything in it off the screen. The other half — the discard refusing
   * *because of the turn*, which needs a conversation with no stored messages at
   * all — is pinned in tests/chat-reduce.test.ts, where that state can be built.
   */
  it("refuses the local discard on the same conversation, and still deletes", async () => {
    await streaming();

    act(() => {
      api().discard(THREAD);
    });
    expect(threadIn(THREAD), "a live conversation was discarded locally").toBeDefined();
    expect(sent, "the local discard sent a request").toEqual([]);

    await act(async () => {
      api().remove(THREAD);
    });
    expect(sent).toEqual([{ method: "DELETE", url: `/api/chat/${SLUG}/${THREAD}` }]);
    expect(threadIn(THREAD)).toBeUndefined();
  });
});

/**
 * **And the window before the server has named the conversation at all**, which
 * is the same button one beat earlier and a different bug.
 *
 * A brand-new conversation is called something this tab invented. `beginTurn`
 * writes it to disk and the `begin` frame is the server saying so, so until that
 * frame a DELETE or a PATCH names a conversation the server has never heard of —
 * and `deleteThread` and `renameThread` in src/chat.ts are a `filter` and a `map`
 * over the stored list, so the request changes nothing and answers `200`. The
 * reader is told it worked and the conversation comes back on their next reload.
 *
 * The request is therefore **held** until the frame — see `Held` in
 * src/web/chat/model.ts. Asserted here at the hook, on what left the tab, for the
 * reason docs/postmortems/260828b-cancel-before-begin.md gives: a conversation vanishing
 * from the screen is not evidence the server heard.
 */
describe("mutating a conversation before the server has named it", () => {
  /** A send into a conversation this tab invented, with no frame back yet. */
  async function opening(): Promise<{
    id: string;
    turn: ReturnType<typeof controllableStream>;
  }> {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET" && url === `/api/chat/${SLUG}`) {
        return Promise.resolve(json({ threads: [] }));
      }
      if (method === "POST" && url === `/api/chat/${SLUG}`) {
        return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
      }
      sent.push({ method, url });
      return Promise.resolve(json({}));
    };
    await mount();
    let id = "";
    act(() => {
      id = api().send(null, "why?", null, { useProfile: false });
    });
    await settle();
    return { id, turn };
  }

  it("sends no DELETE until the frame, then exactly one, under the server's name", async () => {
    const { id, turn } = await opening();

    await act(async () => {
      api().remove(id);
    });
    await settle();
    expect(sent, "a DELETE named a conversation the server has never had").toEqual([]);
    /* The reader sees it go all the same — the tombstone does not wait for the
       server, which is why holding the request costs them nothing. */
    expect(threadIn(id), "the conversation was still on screen").toBeUndefined();

    act(() => {
      turn.frame("begin", {
        threadId: "spya-real1",
        title: "why?",
        messageId: "srv-a",
        questionId: "srv-q",
        attempt: "att-1",
      });
    });
    await settle();

    expect(sent, "the DELETE was never sent at all").toEqual([
      { method: "DELETE", url: `/api/chat/${SLUG}/spya-real1` },
    ]);
    expect(threadIn("spya-real1"), "the conversation came back under the server's name")
      .toBeUndefined();
    expect(api().error).toBeNull();
  });

  /**
   * The same for a rename, plus the half the reader can see: the `begin` frame's
   * title is the server's slice of the question, and it must not land over the
   * name the reader typed while the answer was starting.
   */
  it("holds the rename, keeps the reader's title, and sends it once", async () => {
    const { id, turn } = await opening();

    await act(async () => {
      api().rename(id, "mine");
    });
    await settle();
    expect(sent, "a PATCH named a conversation the server has never had").toEqual([]);
    expect(threadIn(id)?.title).toBe("mine");

    act(() => {
      turn.frame("begin", {
        threadId: "spya-real1",
        title: "why?",
        messageId: "srv-a",
        questionId: "srv-q",
        attempt: "att-1",
      });
    });
    await settle();

    expect(sent, "the rename was never sent under a name the server could match").toEqual([
      { method: "PATCH", url: `/api/chat/${SLUG}/spya-real1` },
    ]);
    expect(threadIn("spya-real1")?.title, "the begin frame overwrote the reader's own name").toBe(
      "mine",
    );
  });
});
