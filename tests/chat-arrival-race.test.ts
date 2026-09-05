// @vitest-environment jsdom
/**
 * **What the arriving list of conversations is allowed to overwrite.**
 *
 * `useChat` asks the server for this article's conversations once, on mount,
 * and until 2026-08-28 the answer was written straight over whatever was on
 * screen — `setThreads(fresh)`. On the ordinary path there is nothing on screen
 * to lose, which is why it looked safe for months. But the fetch takes as long
 * as the reader's connection makes it take, and everything they can do in that
 * window lands in a list the response is about to replace:
 *
 * - press `+` and get a conversation, and it is **gone** when the list lands;
 * - type a question into it and send, and the conversation is gone while its
 *   request carries on — every later frame of the answer then patches a row
 *   that is not there, so the answer arrives nowhere and the reader is looking
 *   at a list with no sign they ever asked anything;
 * - delete a conversation, and the older snapshot **puts it back**.
 *
 * And a fourth, which is not about the reader at all: under `StrictMode` React
 * runs the mount effect twice, so two requests for one article are in flight at
 * once and the *earlier* one can answer last. Its older snapshot then lands on
 * top of the newer one. `tests/load-failed-flags.test.ts` fixed the same shape
 * for the `loadFailed` flag; this is the threads themselves.
 *
 * So the arriving list now merges instead of replacing, and a superseded load
 * cannot land at all. The four tests below are those four cases, and each was
 * watched failing against the old `setThreads(fresh)` first.
 *
 * Same harness as tests/load-failed-flags.test.ts: React's own `act` and
 * `createRoot`, `apiFetch` stubbed and the real `readJson` behind it.
 */
import { act, createElement, StrictMode } from "react";
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

const SLUG = "a-piece";

/** A conversation the server already had when the reader arrived. */
const STORED: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [],
};

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

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: Error): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  /* A rejection nobody has attached a handler to yet is an unhandled rejection
     in Node, and these are handed out before the hook has asked for them. */
  promise.catch(() => {});
  return { promise, resolve, reject };
}

/**
 * A live answer: the server names the two rows and says one word, and then
 * keeps the connection open.
 *
 * Left open on purpose. The case being tested is an answer still arriving when
 * the list lands, and a stream that had already closed would have finished
 * writing before the race could happen.
 */
function streaming(threadId: string, close = false): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", {
        threadId,
        title: "why?",
        messageId: "msg-reply",
        questionId: "msg-question",
        attempt: "att-1",
      });
      frame("delta", { text: "Because " });
      if (close) {
        frame("done", {
          text: "Because ",
          citations: [],
          searches: 0,
          model: "anthropic/claude-sonnet-5",
        });
        c.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function mount(strict = false): Promise<void> {
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness));
  });
  await settle();
}

/** Everything on screen, by id. */
function ids(): string[] {
  return (chat?.threads ?? []).map((t) => t.id);
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("the list arriving", () => {
  /* The cheapest way in, and the one the `+` button gives anyone on a slow
     connection: a conversation that exists only in this tab. */
  it("keeps a conversation the reader started while it was still in flight", async () => {
    const list = deferred<Response>();
    answer = () => list.promise;
    await mount();

    let made = "";
    await act(async () => {
      made = api().begin("chat");
    });
    expect(ids()).toEqual([made]);

    list.resolve(json({ threads: [STORED] }));
    await settle();

    expect(ids().sort()).toEqual([STORED.id, made].sort());
  });

  /**
   * The one the reader actually notices. The question is on screen, its request
   * is out, and the arriving snapshot — taken before any of that — took the
   * whole conversation with it.
   *
   * The assertion is on the *answer*, not just on the thread being present,
   * because the snapshot could equally well have contained an older copy of the
   * conversation: the server writes the question down as the stream begins, so
   * a list fetched a moment later has the thread with one message in it and no
   * answer. Overwriting with that loses the row every later frame is aimed at.
   */
  it("does not take away a question the reader sent while it was still in flight", async () => {
    const list = deferred<Response>();
    let sentTo = "";
    answer = (_url, init) => {
      if (init?.method === "POST") {
        sentTo = JSON.parse(String(init.body)).threadId;
        return Promise.resolve(streaming(sentTo));
      }
      return list.promise;
    };
    await mount();

    let made = "";
    await act(async () => {
      made = api().send(null, "why?", null, { useProfile: false });
    });
    await settle();
    expect(sentTo).toBe(made);

    /* What the server would say if asked now: it has the question written down
       and no answer yet. */
    const half: ChatThread = {
      ...STORED,
      id: made,
      title: "why?",
      messages: [
        {
          id: "msg-question",
          role: "user",
          text: "why?",
          createdAt: "2026-08-27T10:05:00.000Z",
          status: "done",
        },
      ],
    };
    list.resolve(json({ threads: [STORED, half] }));
    await settle();

    const open = api().threads.find((t) => t.id === made);
    expect(open?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(open?.messages[1]?.text).toBe("Because ");
  });

  /* Deletions win, which `put` has always said and the arriving list did not. */
  it("does not put back a conversation the reader deleted while it was in flight", async () => {
    const list = deferred<Response>();
    answer = (_url, init) => {
      if (init?.method === "POST") return Promise.resolve(streaming(JSON.parse(String(init.body)).threadId));
      if (init?.method === "DELETE") return Promise.resolve(json({ ok: true }));
      return list.promise;
    };
    await mount();

    let made = "";
    await act(async () => {
      made = api().send(null, "why?", null, { useProfile: false });
    });
    await settle();
    await act(async () => {
      api().remove(made);
    });
    expect(ids()).toEqual([]);

    /* The server heard about it — the send wrote it down — so a list fetched
       before the delete has it. */
    list.resolve(json({ threads: [STORED, { ...STORED, id: made, title: "why?" }] }));
    await settle();

    expect(ids()).toEqual([STORED.id]);
  });

  /**
   * The same, after the answer has **finished**.
   *
   * This is the one that decides the shape of the rule. A narrower version —
   * protect a conversation only while a send is *still running* — passes every
   * test above and fails this one, because the send is over by the time the
   * list lands and the count is back to zero. The snapshot is still stale: the
   * server read its storage while the answer was half written, and the response
   * has been crawling back over the reader's slow connection ever since. Take
   * the server's copy there and the answer the reader watched arrive is
   * replaced by the question alone.
   *
   * So the rule is "a row already on screen wins", with no timing in it.
   */
  it("does not take away an answer that finished while it was still in flight", async () => {
    const list = deferred<Response>();
    answer = (_url, init) => {
      if (init?.method === "POST") {
        return Promise.resolve(streaming(JSON.parse(String(init.body)).threadId, true));
      }
      return list.promise;
    };
    await mount();

    let made = "";
    await act(async () => {
      made = api().send(null, "why?", null, { useProfile: false });
    });
    await settle();
    /* The stream really did end — otherwise this is the previous test again. */
    expect(api().threads.find((t) => t.id === made)?.messages[1]?.status).toBe("done");

    const half: ChatThread = {
      ...STORED,
      id: made,
      title: "why?",
      messages: [
        {
          id: "msg-question",
          role: "user",
          text: "why?",
          createdAt: "2026-08-27T10:05:00.000Z",
          status: "done",
        },
      ],
    };
    list.resolve(json({ threads: [STORED, half] }));
    await settle();

    const open = api().threads.find((t) => t.id === made);
    expect(open?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(open?.messages[1]?.text).toBe("Because ");
  });

  /**
   * Not about the reader at all: two requests for one article, which
   * `StrictMode` starts on every mount in development and which production
   * reaches by leaving an article and coming straight back — `showing.current`
   * tells **articles** apart, and both of these are the same article.
   *
   * The earlier one answering **first**, with the older snapshot. Nothing on
   * screen yet, so "a row already on screen wins" has nothing to defend with:
   * the stale copy goes in, and when the later response arrives with the fuller
   * one it is *that* which loses, because by then the stale copy is what is on
   * screen. The conversation is stuck a message short until the next reload.
   *
   * So a load that a later one has superseded may not write at all. This is the
   * one case merging cannot cover, and it is the whole reason the loads are
   * numbered.
   */
  it("lets a superseded load write nothing, even when it answers first", async () => {
    const stale: ChatThread = { ...STORED, messages: [] };
    const current: ChatThread = {
      ...STORED,
      messages: [
        {
          id: "m1",
          role: "user",
          text: "why?",
          createdAt: "2026-08-27T10:05:00.000Z",
          status: "done",
        },
        {
          id: "m2",
          role: "assistant",
          text: "Because.",
          createdAt: "2026-08-27T10:05:01.000Z",
          status: "done",
        },
      ],
    };
    const first = deferred<Response>();
    const second = deferred<Response>();
    let call = 0;
    answer = () => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    };

    await mount(true);
    /* If React ever stops double-running the effect the rest of this proves
       nothing, so it is asserted rather than assumed. */
    expect(call).toBe(2);

    first.resolve(json({ threads: [stale] }));
    await settle();
    expect(ids()).toEqual([]);

    second.resolve(json({ threads: [current] }));
    await settle();
    expect(api().threads[0]?.messages).toHaveLength(2);
  });

  /**
   * And the failure path, which the writes' guard does not reach.
   *
   * `tests/load-failed-flags.test.ts` fixed this shape once already, for the
   * `loadFailed` flag: a superseded load failing *after* the current one
   * succeeded said the list could not be loaded while the list was on screen.
   * The same request has a second way of saying so — `error`, which the panel
   * renders above the conversations — and the `catch` was still guarded on the
   * slug alone. GPT Sol, 2026-08-28.
   */
  it("says nothing when a superseded load fails after the current one worked", async () => {
    const first = deferred<Response>();
    let call = 0;
    answer = () => {
      call += 1;
      return call === 1 ? first.promise : Promise.resolve(json({ threads: [STORED] }));
    };

    await mount(true);
    expect(call).toBe(2);
    expect(ids()).toEqual([STORED.id]);

    await act(async () => {
      first.reject(new Error("the abandoned one, failing late"));
      await settle();
    });

    expect(api().error).toBeNull();
    expect(ids()).toEqual([STORED.id]);
  });

  /* And the other order, which merging happens to cover as well — the fuller
     list is already on screen when the stale one lands, so the row on screen
     wins. Kept because it is the shape the bug was first noticed in, and
     because a future change to either half should have to face both orders. */
  it("ignores a superseded load that answers last", async () => {
    const stale: ChatThread = { ...STORED, messages: [] };
    const current: ChatThread = {
      ...STORED,
      messages: [
        {
          id: "m1",
          role: "user",
          text: "why?",
          createdAt: "2026-08-27T10:05:00.000Z",
          status: "done",
        },
        {
          id: "m2",
          role: "assistant",
          text: "Because.",
          createdAt: "2026-08-27T10:05:01.000Z",
          status: "done",
        },
      ],
    };
    const first = deferred<Response>();
    let call = 0;
    answer = () => {
      call += 1;
      return call === 1 ? first.promise : Promise.resolve(json({ threads: [current] }));
    };

    await mount(true);
    expect(call).toBe(2);
    expect(api().threads[0]?.messages).toHaveLength(2);

    first.resolve(json({ threads: [stale] }));
    await settle();

    expect(api().threads[0]?.messages).toHaveLength(2);
  });
});
