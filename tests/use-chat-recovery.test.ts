// @vitest-environment jsdom
/**
 * What the chat panel does when it loses the stream — see `recoverAnswer` in
 * src/web/useChat.ts and docs/plans/chat-mode.md.
 *
 * The thing worth testing here is not the failure, it is the **recovery**. The
 * server deliberately does not stop working when a reader's connection dies
 * (`stopChat` in src/routes.ts says why), so by the time the client has noticed
 * the silence the answer is usually already finished and on disk. Erroring the
 * row would make the reader pay twice for something they had already bought.
 *
 * Same harness as tests/use-search.test.ts: React's own `act` and `createRoot`,
 * no testing library, a stubbed `fetch`. Fake timers, because the clock being
 * tested is 45 seconds long.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChat,
  SERVER_TURN_MS,
  RECOVER_MARGIN_MS,
  OPEN_TIMEOUT_MS,
  type ChatApi,
} from "../src/web/useChat.js";
import { CHAT_TIMEOUT_MS } from "../src/converse.js";
import { CHAT_ORPHAN_GRACE_MS } from "../src/routes.js";
import type { ChatMessage, ChatThread } from "../src/types.js";

let container: HTMLDivElement;
let root: Root;
let latest: ChatApi | undefined;

const SLUG = "an-article";
const THREAD = "th-server";
const REPLY = "msg-server";
const QUESTION = "msg-question";

function Harness() {
  latest = useChat(SLUG);
  return null;
}

/** What `GET /api/chat/:slug` currently says. Rewritten mid-test. */
let stored: ChatThread[] = [];
/** Override the POST for one test: `"hang"`, or a body to return. */
let postBody: "hang" | (() => ReadableStream<Uint8Array>) | undefined;
/** Make every poll hang until its own clock aborts it. */
let hangGets = false;

/**
 * A request that never answers, and rejects when its signal fires — which is
 * what a real `fetch` does, and the only part of it these tests rely on.
 */
function never(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  });
}
/** Counted so a test can prove the recovery actually went and looked. */
let gets = 0;

/**
 * A stream that says `begin` and one word, and then never says anything again.
 *
 * Not closed, not errored — that is the whole point. A closed stream is the
 * case the panel already handled.
 */
function abandonedStream(_threadId: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      const frame = (event: string, data: unknown) =>
        c.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      frame("begin", {
        threadId: THREAD,
        title: "a question",
        messageId: REPLY,
        questionId: QUESTION,
        attempt: "att-1",
      });
      frame("delta", { text: "Half an " });
      // and then nothing, for ever
    },
  });
}

function reply(patch: Partial<ChatMessage>): ChatThread[] {
  return [
    {
      id: THREAD,
      title: "a question",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        {
          id: QUESTION,
          role: "user",
          text: "a question",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "done",
        },
        {
          id: REPLY,
          role: "assistant",
          text: "",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          ...patch,
        },
      ],
    },
  ];
}

/**
 * Move the clock, then let everything it started actually run.
 *
 * The second half is not optional and not paranoia: a `fetch` chain, a
 * `ReadableStream` reader and React's own scheduling each add microtask hops,
 * and `advanceTimersByTimeAsync` only awaits *between timers* — with none
 * pending it yields almost nothing. Eight rounds is comfortably more than the
 * deepest chain here.
 */
async function settle(ms = 0): Promise<void> {
  if (ms > 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/**
 * The last assistant row on screen, whatever it is called.
 *
 * `row()` below finds the row by the *server's* id, which is the right handle
 * once `begin` has arrived. These three tests are about the cases where it
 * never does, so the only name the row has is the one the client invented.
 */
function row2(): ChatMessage | undefined {
  const messages = latest?.threads.at(-1)?.messages ?? [];
  return messages.filter((m) => m.role === "assistant").at(-1);
}

/** The row the answer is streaming into, as the panel currently sees it. */
function row(): ChatMessage | undefined {
  return latest?.threads
    .find((t) => t.messages.some((m) => m.id === REPLY))
    ?.messages.find((m) => m.id === REPLY);
}

beforeEach(async () => {
  vi.useFakeTimers();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stored = [];
  gets = 0;
  postBody = undefined;
  hangGets = false;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (!init?.method || init.method === "GET") {
        gets++;
        if (hangGets) return never(init?.signal);
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ threads: stored })),
        } as unknown as Response);
      }
      if (init.method === "POST") {
        const body = JSON.parse((init.body as string) ?? "{}") as { threadId: string };
        if (postBody === "hang") return never(init.signal);
        return Promise.resolve({
          ok: true,
          body: postBody ? postBody() : abandonedStream(body.threadId),
        } as unknown as Response);
      }
      if (init.method === "DELETE") {
        return Promise.resolve({ ok: true, text: () => Promise.resolve("") } as unknown as Response);
      }
      throw new Error(`unexpected fetch: ${init.method}`);
    }),
  );

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await settle();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  latest = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the numbers", () => {
  /* A copied constant that drifts is a silent failure: watching would stop
     while the server was still legitimately writing, and the reader would be
     told their answer failed moments before it landed. The client cannot import
     src/converse.ts — see the note on SERVER_TURN_MS — but a test can. */
  it("watches for at least as long as the server will write", () => {
    expect(SERVER_TURN_MS).toBe(CHAT_TIMEOUT_MS);
  });

  /* And past the *other* server number, which is easier to forget: a row the
     server has abandoned only becomes an answer-shaped failure when a sweep
     gets to it, 150 seconds in. A client that stopped at 140 would write its
     own failure over a row that was ten seconds from settling. */
  it("watches past the sweep that settles an abandoned row", () => {
    expect(SERVER_TURN_MS + RECOVER_MARGIN_MS).toBeGreaterThanOrEqual(CHAT_ORPHAN_GRACE_MS);
  });
});

describe("a stream that goes quiet", () => {
  it("adopts the finished answer the server wrote while nobody was listening", async () => {
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();
    expect(row()?.status).toBe("pending");
    expect(row()?.text).toBe("Half an ");

    // The server finishes the answer. Nothing tells the client, because the
    // connection it would have been told on is gone.
    stored = reply({
      status: "done",
      text: "Half an answer, and then the rest of it.",
      citations: [],
      searches: 0,
      model: "test-model",
    });

    const before = gets;
    // Nothing yet: 59 seconds of silence is not proof of anything, and a tool
    // is allowed to run for 45 of them.
    await settle(59_000);
    expect(row()?.status).toBe("pending");
    expect(gets).toBe(before);

    await settle(2_000);
    expect(gets).toBeGreaterThan(before);
    expect(row()?.status).toBe("done");
    expect(row()?.text).toBe("Half an answer, and then the rest of it.");
    expect(row()?.error).toBeFalsy();
  });

  it("keeps looking, and takes the answer whenever it lands", async () => {
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();

    // Still writing when the client gives up on the stream, and for two more
    // looks after that.
    stored = reply({ status: "pending", text: "Half an " });
    await settle(61_000);
    expect(row()?.status).toBe("pending");
    await settle(6_200);
    expect(row()?.status).toBe("pending");

    stored = reply({ status: "done", text: "All of it.", citations: [], searches: 0, model: "m" });
    await settle(3_100);
    expect(row()?.status).toBe("done");
    expect(row()?.text).toBe("All of it.");
  });

  it("says it has lost the connection rather than going on claiming to think", async () => {
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();
    expect(latest?.recovering.size).toBe(0);

    stored = reply({ status: "pending", text: "Half an " });
    await settle(61_000);
    expect([...(latest?.recovering ?? [])]).toEqual([REPLY]);

    stored = reply({ status: "done", text: "All of it.", citations: [], searches: 0, model: "m" });
    await settle(3_100);
    expect(latest?.recovering.size).toBe(0);
  });

  /* The one thing the recovery must never do: adopt a row that is still
     `pending`. That would put a spinner on screen with no stream behind it and
     nothing left to end it — strictly worse than the failure it is avoiding. */
  it("gives up with a message the reader can act on, rather than a spinner", async () => {
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();

    stored = reply({ status: "pending", text: "Half an " });
    // Past the stall clock, then past the whole watch window.
    await settle(61_000);
    await settle(SERVER_TURN_MS + RECOVER_MARGIN_MS + 5_000);

    expect(row()?.status).toBe("error");
    expect(row()?.error).toContain("[ai-cut-off]");
    // What did arrive is kept.
    expect(row()?.text).toBe("Half an ");
    expect(latest?.recovering.size).toBe(0);
  });
});

/**
 * The case that was actually reported, and that an in-`run` recovery misses
 * entirely: the hook goes away and comes back.
 *
 * In development that is Vite Fast Refresh; in every build it is StrictMode's
 * simulated remount. The old hook's stream dies with it, and the new one loads
 * a `pending` row from the server with no stream and no clock — which spins for
 * ever unless something notices that the row is nobody's.
 */
describe("a pending answer nobody is streaming", () => {
  it("is picked up on a fresh mount and followed to its end", async () => {
    stored = reply({ status: "pending", text: "Half an " });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();

    expect(row()?.status).toBe("pending");
    expect([...(latest?.recovering ?? [])]).toEqual([REPLY]);

    stored = reply({ status: "done", text: "All of it.", citations: [], searches: 0, model: "m" });
    await settle(3_100);
    expect(row()?.status).toBe("done");
    expect(row()?.text).toBe("All of it.");
  });

  it("stops looking when the reader deletes the conversation", async () => {
    stored = reply({ status: "pending", text: "Half an " });
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(Harness));
    });
    await settle();
    expect(latest?.recovering.size).toBe(1);

    act(() => {
      latest?.remove(THREAD);
    });
    await settle(3_100);
    expect(latest?.threads.find((t) => t.id === THREAD)).toBeUndefined();
    await settle(SERVER_TURN_MS + 30_000);
    // Gone, and not resurrected by a late poll.
    expect(latest?.threads.find((t) => t.id === THREAD)).toBeUndefined();
  });
});

/**
 * The three ways a send can end with nothing to recover *to*, each of which
 * used to end somewhere worse than a plain failure.
 */
describe("when there is nothing on the server to find", () => {
  it("fails a send whose request is never answered at all", async () => {
    postBody = "hang";
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();
    expect(row2()?.status).toBe("pending");

    await settle(OPEN_TIMEOUT_MS + 1_000);
    expect(row2()?.status).toBe("error");
    expect(row2()?.error).toContain("[ai-no-response]");
    // And nothing is left watching a row the server was never told about.
    expect(latest?.recovering.size).toBe(0);
  });

  /* A stream that opens and closes with no frames in it. The row is named by
     nobody, so `pendingId` is a name this client invented — and a watch would
     spend the whole window asking the server about it and showing "connection
     lost" for something that could never be found. */
  it("fails a stream that closes before the server names the row", async () => {
    postBody = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.close();
        },
      });
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();
    await settle(1_000);

    expect(row2()?.status).toBe("error");
    expect(row2()?.error).toContain("[ai-cut-off]");
    expect(latest?.recovering.size).toBe(0);
  });
});

describe("a poll that hangs", () => {
  /* The recovery's own request has no timeout of its own — `fetch` has none —
     so one hung poll would stall the whole watch. A recovery that inherits the
     hang it is recovering from. */
  it("times out on its own clock and keeps looking", async () => {
    act(() => {
      latest?.send(null, "a question", null);
    });
    await settle();

    hangGets = true;
    await settle(61_000);
    const first = gets;
    expect(first).toBeGreaterThan(0);
    expect(row()?.status).toBe("pending");

    // Two poll timeouts and the gaps between them: the watch is still going,
    // and it is still asking.
    await settle(30_000);
    expect(gets).toBeGreaterThan(first);

    hangGets = false;
    stored = reply({ status: "done", text: "All of it.", citations: [], searches: 0, model: "m" });
    await settle(15_000);
    expect(row()?.status).toBe("done");
    expect(row()?.text).toBe("All of it.");
  });
});
