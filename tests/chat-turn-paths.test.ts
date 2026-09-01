// @vitest-environment jsdom
/**
 * Characterisation tests for `retry` and `edit` in useChat.ts — acceptance net
 * for docs/plans/260828v-chat-operation-model.md's stage 2.
 *
 * Two items from the acceptance list
 * (docs/plans/260828aa-chat-operation-model-acceptance.md) had nothing pinning them:
 *
 * - `retry` is called in tests/chat-edit-guard.test.ts and
 *   tests/chat-error-scope.test.ts, but both only look at the POST body
 *   afterwards, never at the row on screen.
 * - The 409-puts-discarded-turns-back path is only exercised through `retry`
 *   in tests/chat-error-scope.test.ts. `.edit(` on the client hook is only
 *   called in tests/chat-edit-guard.test.ts, whose stub always answers
 *   `ok: true` — no test has ever given an edit a 409.
 *
 * **These pin what the code does today, not what it should do.**
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
const THREAD = "spya-th01";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** The server refusing a turn because the conversation has moved on. */
function conflict(message = "Someone else has moved this on."): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 409,
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

/** The thread the tests use, by id. */
function thread(): ChatThread | undefined {
  return chat?.threads.find((t) => t.id === THREAD);
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

describe("retry", () => {
  /** An errored Remember answer, with every field a retry has to clear. */
  const stored: ChatThread = {
    id: THREAD,
    kind: "review",
    title: "a review",
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    messages: [
      {
        id: "q1",
        role: "user",
        text: "what do you make of this?",
        createdAt: "2026-08-27T10:00:00.000Z",
        status: "done",
      },
      {
        id: "a1",
        role: "assistant",
        text: "That did not work.",
        createdAt: "2026-08-27T10:00:01.000Z",
        status: "error",
        error: "That did not work.",
        citations: [{ url: "https://example.com", title: "Example" }],
        searches: 2,
        tools: [
          {
            name: "search_library",
            label: "searched your library for “predictive processing”",
            detail: "3 passages in 2 articles",
            status: "done",
            ms: 120,
          },
        ],
        stance: "socratic",
      },
    ],
  };

  it("blanks the replaced answer's fields, carrying only stance across", async () => {
    const post = deferred<Response>();
    answer = (_url, init) =>
      (init?.method ?? "GET") === "GET" ? Promise.resolve(json({ threads: [stored] })) : post.promise;
    await mount();

    await act(async () => {
      api().retry(THREAD, "a1");
    });

    // Before the retry's POST has resolved.
    const row = thread()?.messages.find((m) => m.id === "a1");
    expect(row?.text).toBe("");
    expect(row?.status).toBe("pending");
    expect(row?.citations).toBeUndefined();
    expect(row?.searches).toBeUndefined();
    expect(row?.tools).toBeUndefined();
    expect(row?.error).toBeUndefined();
    expect(row?.stance).toBe("socratic");
  });
});

describe("a refused edit", () => {
  /** Two complete turns, so an edit of the first has something to discard. */
  const stored: ChatThread = {
    id: THREAD,
    title: "a question",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    kind: "chat",
    messages: [
      { id: "q1", role: "user", text: "first", createdAt: "2026-01-01T00:00:00.000Z", status: "done" },
      { id: "a1", role: "assistant", text: "one", createdAt: "2026-01-01T00:00:00.000Z", status: "done" },
      { id: "q2", role: "user", text: "second", createdAt: "2026-01-01T00:00:01.000Z", status: "done" },
      { id: "a2", role: "assistant", text: "two", createdAt: "2026-01-01T00:00:01.000Z", status: "done" },
    ],
  };

  it("puts the discarded turns back", async () => {
    // The server's copy of the thread never changes — the edit is refused, so
    // the repair's GET reports the same conversation both times.
    answer = (_url, init) =>
      (init?.method ?? "GET") === "GET" ? Promise.resolve(json({ threads: [stored] })) : Promise.resolve(conflict());
    await mount();
    expect(thread()?.messages.map((m) => m.id)).toEqual(["q1", "a1", "q2", "a2"]);

    act(() => {
      api().edit(THREAD, "q1", "first, rewritten", null);
    });
    // The optimistic rewrite: everything after q1 is gone.
    const discarded = thread()?.messages.map((m) => m.id);
    expect(discarded).not.toContain("q2");
    expect(discarded).not.toContain("a2");

    await settle();

    // The 409 repair has run: the server's copy is back, discarded turns and all.
    expect(thread()?.messages.map((m) => m.id)).toEqual(["q1", "a1", "q2", "a2"]);
    expect(thread()?.messages[0]?.text).toBe("first");
    expect(api().error).not.toBeNull();
  });
});
