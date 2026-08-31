// @vitest-environment jsdom
/**
 * The stop/cancel-before-`begin` window, a refused cancel, and `onThreadId` —
 * the last four items on docs/plans/260828aa-chat-operation-model-acceptance.md, and
 * named by Sol as the ones that must be pinned before the stage that rewrites
 * `turn.began` and moves command delivery, because that stage *is* the
 * machinery holding these wishes.
 *
 * **The first two of these changed on 2026-08-28, deliberately, in stage 2 of
 * docs/plans/260828v-chat-operation-model.md.** They were written the day before as
 * characterisation tests, and what they characterised was two requests for one
 * stop — the first carrying an id the server had never heard of — and one for a
 * cancel, likewise doomed, never corrected. Stage 2 represents the turn, so the
 * client can finally ask the question those requests were guessing at: *does
 * this row have a server name yet?* The rule now is **send once, when there is
 * an id the server can match**, and both assertions moved with it. What the old
 * ones said, and why the old behaviour was worse than a wasted request, is in
 * docs/postmortems/260828b-cancel-before-begin.md and in the note on each test below.
 *
 * The other two pin what the code does and did not change.
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
  it("sends nothing until the row has a server name, and then exactly one /stop", async () => {
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

    /* **Nothing has gone out**, and this is the assertion that changed.

       It used to be one request, right here, carrying the provisional id — a
       name this client invented, which reaches a real route and comes back
       `{ stopped: false }`. Nothing was stopped and the button reported that it
       had, which is the exact shape docs/reusable/silent-success.md is about.
       The turn is an operation now, so `stop` can ask whether the row has a
       server name yet; it has not, so the wish waits. */
    expect(posts, "a stop went out before the server could name the row").toHaveLength(0);

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

    // And now exactly one, carrying the server's id and the attempt it named —
    // which is what the acceptance item asks for and what the two requests
    // between them never managed.
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/stop`);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
    // The provisional id never left the tab.
    expect(posts.some((p) => p.body.messageId === provisional)).toBe(false);
  });

  /**
   * And the ordinary case, unchanged: a stop pressed on a row the server has
   * already named goes out at once, because there is nothing to wait for.
   *
   * Here so that the fix above cannot be "never send a stop", which the test
   * before it would not notice.
   */
  it("still posts at once when the row already has a server name", async () => {
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

    act(() => {
      api().stop(threadId, "srv-answer-1");
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
  });
});

describe("a cancel pressed before the begin frame", () => {
  /* The name used to say "and again after begin", which was the opposite of
     what the body asserted: there was no second cancel, and that was the
     finding — docs/postmortems/260828b-cancel-before-begin.md. Stage 2 makes there be
     exactly one, and puts it on the far side of the frame. */
  it("sends nothing until the row has a server name, and then exactly one /cancel and no /stop", async () => {
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

    /* **Nothing has gone out, and the conversation has already gone from the
       screen.** Those two are separate promises and only the first changed: the
       reader pressed a destructive button and it takes effect at once, by
       tombstone, whatever the server ends up saying.

       The request that used to go out here named the provisional id, and
       `cancelChat` has two answers for that and both are wrong for the reader —
       `200 { cancelled: true }` for a conversation it has not written yet, and
       a 409 on the tail for one it has. See
       tests/chat-cancel-before-begin.test.ts. */
    expect(posts, "a cancel went out before the server could name the row").toHaveLength(0);
    expect(threadIn(threadId), "the conversation is still on screen").toBeUndefined();

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

    /* One `/cancel`, on the far side of the frame, naming what the server
       named — the row, the attempt, and the tail it believes is last, which is
       the same row. Every one of those is an id the server minted, so both of
       its answers now mean what they say. */
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${threadId}/cancel`);
    expect(posts[0]?.body.messageId).toBe("srv-answer-1");
    expect(posts[0]?.body.attempt).toBe("att-1");
    expect(posts[0]?.body.expectedTailId).toBe("srv-answer-1");
    expect(posts.some((p) => p.body.messageId === provisional)).toBe(false);

    // The one thing that held before and still holds: stop and cancel never
    // both fire on the same row. No request to /stop at any point.
    expect(posts.some((p) => p.url.endsWith("/stop"))).toBe(false);
  });
});

/**
 * **`began` is not a sound predicate for a retry**, which is GPT Sol's finding 2
 * on stage 2 (docs/plans/260828v-chat-operation-model-stage2-review-sol.md).
 *
 * A retry writes into the answer row it is replacing, and that row already has
 * the server's own name — it came back in a load. But the retry's *operation*
 * starts `began: false` like every other turn, so asking "has the server named
 * this row?" through the operation gave the wrong answer twice:
 *
 * - a **cancel** waited for a frame it did not need, when it could have named
 *   the stored row immediately;
 * - a **stop** waited, and if that retry died before its `begin` frame the wish
 *   was never consumed — it sat in the hook under a row id a *later* retry
 *   reuses, and fired at that one's `begin` frame instead.
 */
describe("a retry, whose row the server has already named", () => {
  const stored: ChatThread = {
    id: "spya-th03",
    kind: "chat",
    title: "a stored conversation",
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

  it("cancels at once rather than waiting for a frame it does not need", async () => {
    const turn = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [stored] }));
      if (url.endsWith("/stop") || url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(json({ cancelled: true }));
      }
      return Promise.resolve({ ok: true, body: turn.stream } as unknown as Response);
    };
    await mount();

    act(() => {
      api().retry(stored.id, "msg-a");
    });
    // No `begin` frame yet — and none is needed. `msg-a` is the server's own
    // name for this row, so the destructive request can be matched today.
    act(() => {
      api().cancelAndDiscard(stored.id, "msg-a");
    });

    expect(posts, "the cancel waited for a name the row already had").toHaveLength(1);
    expect(posts[0]?.url).toBe(`/api/chat/${SLUG}/${stored.id}/cancel`);
    expect(posts[0]?.body.messageId).toBe("msg-a");
    expect(posts[0]?.body.expectedTailId).toBe("msg-a");
  });

  /**
   * **A wish that outlives the turn it was waiting on stops the wrong answer.**
   *
   * Retry, press stop before the frame, watch that retry fail. Retry again. The
   * second attempt's `begin` frame carries the same row id — a retry reuses the
   * row — so the stranded wish matches it and stops an answer the reader has
   * just asked for.
   */
  it("does not let a stop stranded by a failed retry stop the next one", async () => {
    let attempt = 0;
    const second = controllableStream();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [stored] }));
      if (url.endsWith("/stop") || url.endsWith("/cancel")) {
        recordPost(url, init);
        return Promise.resolve(json({ stopped: true }));
      }
      attempt += 1;
      if (attempt === 1) return Promise.resolve(json({ error: "the model is busy" }, 503));
      return Promise.resolve({ ok: true, body: second.stream } as unknown as Response);
    };
    await mount();

    act(() => {
      api().retry(stored.id, "msg-a");
    });
    act(() => {
      api().stop(stored.id, "msg-a");
    });
    // Nothing yet: the attempt has no name, so there is nothing to stop.
    expect(posts).toHaveLength(0);

    // That attempt dies before it is ever named.
    await settle();
    expect(threadIn(stored.id)?.messages.at(-1)).toMatchObject({ status: "error" });

    // The reader tries again, and this one starts properly.
    act(() => {
      api().retry(stored.id, "msg-a");
    });
    act(() => {
      second.frame("begin", {
        threadId: stored.id,
        title: stored.title,
        messageId: "msg-a",
        attempt: "att-2",
      });
    });
    await settle();

    expect(posts, "a stop left over from a dead retry stopped the next answer").toHaveLength(0);
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

/**
 * **A tombstone remembers who laid it, and a delete's is never lifted.**
 *
 * The sequence is three ordinary actions in a row: cancel the first answer of a
 * conversation, then delete the conversation while that cancel is still out,
 * then the cancel comes back refused. `askToCancel`'s catch lifts the tombstone
 * — which is right for its *own* tombstone and was, until 2026-08-28, applied to
 * whichever tombstone happened to be on that conversation. The delete's. So a
 * conversation the reader had deleted came back on screen, and the delete
 * request had already succeeded, so it is not on the server either.
 *
 * Deletions are supposed to win over every projection; here one lost to an
 * unrelated request failing. Found written down in
 * docs/plans/260828v-chat-operation-model.md's stage 2, and fixed there by giving each
 * tombstone the name of who put it down and a `final` flag the delete sets.
 */
describe("a cancel that fails after the reader has deleted the conversation", () => {
  const stored: ChatThread = {
    id: "spya-th02",
    kind: "chat",
    title: "one the reader is finished with",
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

  it("does not take the delete's tombstone off with its own", async () => {
    let refuse!: (r: Response) => void;
    const cancel = new Promise<Response>((r) => {
      refuse = r;
    });
    cancel.catch(() => {});
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return Promise.resolve(json({ threads: [stored] }));
      if (url.endsWith("/cancel")) {
        recordPost(url, init);
        return cancel;
      }
      if (method === "DELETE") return Promise.resolve(json({}));
      throw new Error(`unexpected request: ${method} ${url}`);
    };
    await mount();
    expect(threadIn(stored.id)).toBeDefined();

    /* The row is already named — it came from the server — so this cancel goes
       out at once, which is what leaves it in flight for the delete to overtake. */
    act(() => {
      api().cancelAndDiscard(stored.id, "msg-a");
    });
    expect(posts).toHaveLength(1);

    // And the reader deletes the conversation outright while it is still out.
    await act(async () => {
      api().remove(stored.id);
    });
    await settle();
    expect(threadIn(stored.id)).toBeUndefined();

    // Now the cancel is refused. Its own tombstone is long gone under the
    // delete's, and the delete's is not its to lift.
    refuse(json({ error: "This conversation has moved on since you looked" }, 409));
    await settle();

    expect(threadIn(stored.id), "a deleted conversation came back").toBeUndefined();
    /* **And it says nothing either**, which is GPT Sol's finding 4 on stage 2.
       Provenance keeps the conversation deleted; the obsolete cancel still wrote
       "Couldn't discard that conversation…" over a delete that had succeeded,
       because its failure was dispatched from a `catch` in the hook with no
       operation behind it and therefore no gate in front of it. The delete
       supersedes everything for that conversation, this cancel included, and a
       superseded operation's failure has nothing to say. */
    expect(api().error, "an obsolete cancel reported over a successful delete").toBeNull();
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
