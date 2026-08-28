// @vitest-environment jsdom
/**
 * **Two things rename a conversation, and the last one to happen must win.**
 *
 * The reader can rename from the list, and they can rename by rewriting the
 * conversation's *first question* — `editTurn` on the server applies the same
 * rule, and `edit` in useChat.ts mirrors it: `title: index === 0 ? …`. So an
 * edit is a title write that is not a rename operation, and there is no reason
 * a reader cannot do one and then the other.
 *
 * `6f35022` made the second of those lose. A rename operation held the new
 * title and drew it over `base` until the PATCH answered, then committed it —
 * so an edit landing in the gap wrote a title into `base` that was drawn over
 * while the request was out and overwritten when it came back. Rename from the
 * list, open the conversation while the PATCH is slow, rewrite the first
 * question, and the title goes back to the one you replaced. Found by GPT Sol
 * reviewing stage 1 of docs/plans/chat-operation-model.md, 2026-08-28.
 *
 * **The dev assertion on `legacy.apply` cannot catch this**, and that is the
 * sharp part of Sol's finding: it refuses a legacy write while a
 * `TurnOperation` exists, and the live edit here is precisely a turn that has
 * *not* been migrated, so there is no operation to see. An assertion that can
 * only see what has already been moved cannot police what has not.
 *
 * The fix is to write an optimistic title into `base` at registration, the way
 * `put` did before the migration, and leave the operation to admit its own
 * outcome. An operation projects what can still be withdrawn; a rename's
 * optimistic change is deliberately never withdrawn — a failed rename stays on
 * screen — so there is nothing for it to draw.
 *
 * Same harness as tests/chat-write-paths.test.ts: React's own `act` and
 * `createRoot`, `apiFetch` stubbed with the real `readJson` behind it.
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

/** One turn, so that the question being rewritten is the thread's first. */
const STORED: ChatThread = {
  id: THREAD,
  kind: "chat",
  title: "the title it was stored under",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    {
      id: "q1",
      role: "user",
      text: "the first question",
      createdAt: "2026-08-27T10:00:00.000Z",
      status: "done",
    },
    {
      id: "a1",
      role: "assistant",
      text: "an answer.",
      createdAt: "2026-08-27T10:00:01.000Z",
      status: "done",
    },
  ],
};

const RENAMED = "Renamed from the list";
const REWRITTEN = "the first question, rewritten";

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

/** The one conversation's title, as the reader sees it. */
function title(): string | undefined {
  return chat?.threads.find((t) => t.id === THREAD)?.title;
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

describe("a rename and an edit of the first question", () => {
  /**
   * The reader's own order, honoured. The edit happens second, so its title is
   * the one they are looking at — before the rename's PATCH answers and after.
   *
   * The POST the edit fires is deliberately left hanging: the optimistic title
   * is written before the request leaves, and letting the server answer would
   * bring the `begin` frame's own title into a test that is not about that.
   */
  it("keeps the edit's title, even when the slow rename lands afterwards", async () => {
    const patch = deferred<Response>();
    const post = deferred<Response>();
    answer = (_url, init) => {
      if (init?.method === "PATCH") return patch.promise;
      if (init?.method === "POST") return post.promise;
      return Promise.resolve(json({ threads: [STORED] }));
    };
    await mount();
    expect(title()).toBe(STORED.title);

    await act(async () => {
      api().rename(THREAD, RENAMED);
    });
    await settle();
    // The premise: the rename is on screen and its request is still out.
    expect(title()).toBe(RENAMED);

    await act(async () => {
      api().edit(THREAD, "q1", REWRITTEN, null);
    });
    await settle();
    /* The reader rewrote the first question, which renames the conversation —
       the same rule `editTurn` applies on the server. */
    expect(title(), "the edit's title did not reach the screen").toBe(REWRITTEN);

    patch.resolve(json({ ok: true }));
    await settle();

    expect(title(), "the older rename came back over the edit").toBe(REWRITTEN);
  });

  /** And the same when the rename fails, which does not roll anything back. */
  it("keeps the edit's title when the rename's PATCH fails", async () => {
    const patch = deferred<Response>();
    const post = deferred<Response>();
    answer = (_url, init) => {
      if (init?.method === "PATCH") return patch.promise;
      if (init?.method === "POST") return post.promise;
      return Promise.resolve(json({ threads: [STORED] }));
    };
    await mount();

    await act(async () => {
      api().rename(THREAD, RENAMED);
    });
    await settle();
    await act(async () => {
      api().edit(THREAD, "q1", REWRITTEN, null);
    });
    await settle();
    expect(title()).toBe(REWRITTEN);

    patch.reject(new Error("the network is down"));
    await settle();

    expect(title(), "a failed rename put its title back over the edit").toBe(REWRITTEN);
    // It still says so, which is the behaviour a failed rename has always had.
    expect(api().error).not.toBeNull();
  });

  /**
   * The other order, which was never broken and is here so that a future change
   * has to face both: rename *after* the edit, and the rename wins.
   */
  it("keeps the rename's title when the rename came second", async () => {
    const patch = deferred<Response>();
    const post = deferred<Response>();
    answer = (_url, init) => {
      if (init?.method === "PATCH") return patch.promise;
      if (init?.method === "POST") return post.promise;
      return Promise.resolve(json({ threads: [STORED] }));
    };
    await mount();

    await act(async () => {
      api().edit(THREAD, "q1", REWRITTEN, null);
    });
    await settle();
    await act(async () => {
      api().rename(THREAD, RENAMED);
    });
    await settle();
    expect(title()).toBe(RENAMED);

    patch.resolve(json({ ok: true }));
    await settle();
    expect(title()).toBe(RENAMED);
  });
});
