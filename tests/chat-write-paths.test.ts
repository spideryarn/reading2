// @vitest-environment jsdom
/**
 * Characterisation tests for `rename` and `remove` in useChat.ts.
 *
 * Neither had a single test before this file — `grep -rn "\.rename(" tests/`
 * found nothing at all, and `.remove(` was only ever called against a fetch
 * stubbed to succeed. Written as a net before
 * docs/plans/chat-operation-model.md's stage 1 migrates both into operations,
 * so a regression during that migration goes red here instead of shipping.
 *
 * **These pin what the code does today, not what it should do.** Where that is
 * debatable, the note says so rather than asserting a preference.
 *
 * Same harness as tests/chat-error-scope.test.ts: React's own `act` and
 * `createRoot`, no testing library, `apiFetch` stubbed with the real `readJson`
 * and `failure` behind it.
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

const STORED: ChatThread = {
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
      text: "because.",
      createdAt: "2026-08-27T10:00:01.000Z",
      status: "done",
    },
  ],
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
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

/** Everything on screen, by id. */
function ids(): string[] {
  return (chat?.threads ?? []).map((t) => t.id);
}

/** Everything on screen, by title. */
function titles(): string[] {
  return (chat?.threads ?? []).map((t) => t.title);
}

/** Every PATCH or DELETE this test has seen, in order. */
let writes: { url: string; method: string; body: unknown }[] = [];

function recordWrite(url: string, init: RequestInit | undefined): void {
  writes.push({
    url,
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  writes = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("rename", () => {
  it("puts the new title on screen before the PATCH resolves, and sends the right request", async () => {
    const patch = deferred<Response>();
    answer = (url, init) => {
      if ((init?.method ?? "GET") === "GET") return Promise.resolve(json({ threads: [STORED] }));
      recordWrite(url, init);
      return patch.promise;
    };
    await mount();
    expect(titles()).toEqual([STORED.title]);

    await act(async () => {
      api().rename(STORED.id, "a better title");
    });

    // Before the PATCH has resolved.
    expect(titles()).toEqual(["a better title"]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("PATCH");
    expect(writes[0]?.url).toBe(`/api/chat/${SLUG}/${STORED.id}`);
    expect(writes[0]?.body).toEqual({ title: "a better title" });

    patch.resolve(json({}));
    await settle();
    expect(titles()).toEqual(["a better title"]);
  });

  /* Deliberate, and named as such by the docstring on `write` in useChat.ts:
     "the optimistic change stays on screen... the reader can reload to see the
     truth." Characterising it, not endorsing it — a reader has no way to tell
     a rename that stuck from one that silently didn't beyond that one line of
     `error`. */
  it("keeps the new title on screen when the PATCH fails, and says so in error", async () => {
    answer = (_url, init) =>
      (init?.method ?? "GET") === "GET"
        ? Promise.resolve(json({ threads: [STORED] }))
        : Promise.resolve(json({ error: "Server exploded." }, 500));
    await mount();
    expect(api().error).toBeNull();

    await act(async () => {
      api().rename(STORED.id, "a doomed title");
    });
    await settle();

    expect(titles()).toEqual(["a doomed title"]);
    expect(api().error).toContain("rename");
    expect(api().error).toContain("Server exploded.");
  });
});

describe("remove", () => {
  it("removes the conversation from screen immediately, and sends a DELETE", async () => {
    const del = deferred<Response>();
    answer = (url, init) => {
      if ((init?.method ?? "GET") === "GET") return Promise.resolve(json({ threads: [STORED] }));
      recordWrite(url, init);
      return del.promise;
    };
    await mount();
    expect(ids()).toEqual([STORED.id]);

    await act(async () => {
      api().remove(STORED.id);
    });

    // Before the DELETE has resolved.
    expect(ids()).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.method).toBe("DELETE");
    expect(writes[0]?.url).toBe(`/api/chat/${SLUG}/${STORED.id}`);

    del.resolve(json({}));
    await settle();
    expect(ids()).toEqual([]);
  });

  /* Same deliberate non-rollback as rename's failure above, and the same
     docstring covers both — `write` is shared. */
  it("stays gone when the DELETE fails, and says so in error", async () => {
    answer = (_url, init) =>
      (init?.method ?? "GET") === "GET"
        ? Promise.resolve(json({ threads: [STORED] }))
        : Promise.resolve(json({ error: "Server exploded." }, 500));
    await mount();

    await act(async () => {
      api().remove(STORED.id);
    });
    await settle();

    expect(ids()).toEqual([]);
    expect(api().error).toContain("delete");
    expect(api().error).toContain("Server exploded.");
  });

  /**
   * Deletions win, per `mergedArrival`'s own docstring — but that function has
   * never been exercised through `remove` starting *before* the very first
   * arrival load has landed, only through a thread `send` had just created
   * (tests/chat-arrival-race.test.ts). This is the plainer case: nothing has
   * ever been on screen, the reader deletes anyway, and the server's list —
   * which still has the conversation, because it existed before the delete
   * went out — lands after.
   */
  it("does not let a conversation come back once removed, even if the arrival load still has it", async () => {
    const list = deferred<Response>();
    answer = (url, init) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return list.promise;
      if (method === "DELETE") {
        recordWrite(url, init);
        return Promise.resolve(json({}));
      }
      throw new Error(`unexpected method: ${method}`);
    };
    await mount();
    // The arrival load is still out — nothing is on screen yet.
    expect(ids()).toEqual([]);

    await act(async () => {
      api().remove(STORED.id);
    });
    expect(writes).toHaveLength(1);

    // The server's copy, arriving late — it has the conversation, because the
    // delete request was still on its way when the server read its storage.
    list.resolve(json({ threads: [STORED] }));
    await settle();

    expect(ids()).toEqual([]);
  });
});
