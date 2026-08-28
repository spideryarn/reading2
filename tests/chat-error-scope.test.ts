// @vitest-environment jsdom
/**
 * **How long a chat failure message is allowed to live.**
 *
 * `useChat` has one `error`, and everything that can go wrong in it writes
 * there: a load, a stop, a delete, a repair after a 409. Two things about that
 * string had never been pinned, and they are the same question asked twice —
 * *which article is this error about?*
 *
 * 1. **It outlived the article.** The mount effect clears the threads and the
 *    load phase when the slug changes and did not clear the error, so the same
 *    string survived into the next article.
 *
 *    **No reader has seen this**, and the honest version is worth having:
 *    `Reader` is keyed on the slug in App.tsx, and both mounts of `useChat` sit
 *    under it, so changing article remounts the hook and the error goes with
 *    it. What the fix buys is that the hook keeps its own promise — it takes a
 *    slug, and it resets what belonged to the last one — rather than depending
 *    on a caller two files away to remount it. GPT Sol made this correction on
 *    2026-08-28, having made the same one the day before about a different
 *    claim in the same file.
 *
 * 2. **An abandoned repair could write on the article the hook moved to.** The
 *    409 path in `run` fetches the server's copy of one conversation, and that
 *    fetch can still be out when the slug changes. `refreshThread` guards
 *    against it, and until this file nothing made that guard prove itself:
 *    deleting the line left every test in the repo green.
 *
 *    Two halves to it. The failure message is the easy one. The other is a
 *    write, because thread ids are **per article** — `chat_threads` is keyed
 *    `(article_id, id)`, and the schema says they are "not promised to be
 *    globally unique" — so the stale repair can find its id in the new slug's
 *    list and overwrite a different conversation with it. An earlier version of
 *    this file called that case unobservable, having assumed ids are global.
 *
 * **Both are hook-level, and neither is a race a reader can reach today** —
 * same as (1), and for the same reason: production remounts. These tests drive
 * `useChat` through a slug change directly because that is the contract the
 * guards are written against, and the only level at which they can be shown to
 * do anything. Every claim in this file about what a *reader* would see was
 * wrong the first time it was written, three times running, which is why this
 * paragraph is here.
 *
 * This is the same shape as the two stale-load guards in
 * tests/chat-arrival-race.test.ts and tests/load-failed-flags.test.ts: an
 * answer that is no longer wanted, arriving anyway, and writing.
 *
 * Same harness as those two — React's own `act` and `createRoot`, `apiFetch`
 * stubbed with the real `readJson` behind it — plus a settable slug, because
 * changing article is the whole subject and `Reader` keys on it in production.
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

const SLUG = "a-piece";
/** The article the hook is given next. */
const OTHER = "another-piece";

/** A conversation whose last answer failed, so `retry` has something to press. */
const BROKEN: ChatThread = {
  id: "spya-k3m9qt",
  kind: "chat",
  title: "An earlier conversation",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  messages: [
    {
      id: "msg-question",
      role: "user",
      text: "why?",
      createdAt: "2026-08-27T10:00:00.000Z",
      status: "done",
    },
    {
      id: "msg-reply",
      role: "assistant",
      text: "",
      createdAt: "2026-08-27T10:00:01.000Z",
      status: "error",
      error: "That did not work.",
    },
  ],
};

/**
 * The **other** article's conversation, carrying the same id.
 *
 * Not a contrivance. `chat_threads` is keyed `(article_id, id)` precisely
 * because "thread ids are minted per article by the same `mintId()` and are not
 * promised to be globally unique" — src/db/schema.ts. Two articles sharing one
 * is a collision or a `?thread=` somebody typed, and the storage layer has
 * already decided that client code may not assume it cannot happen.
 */
const ELSEWHERE: ChatThread = {
  ...BROKEN,
  title: "A conversation about the other piece",
  messages: [],
};

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;

function Harness({ slug }: { slug: string }) {
  chat = useChat(slug);
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

/** The server refusing a turn because the conversation has moved on. */
function conflict(): Response {
  return new Response(JSON.stringify({ error: "Someone else has moved this on." }), {
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

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

/**
 * Render at a slug. Not `StrictMode` here on purpose: this file is about
 * changing article, and the doubled mount would put a second load of the *same*
 * article in the way of the thing being watched.
 */
async function show(slug: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { slug }));
  });
  await settle();
}

/** Everything on screen, by id. */
function ids(): string[] {
  return (chat?.threads ?? []).map((t) => t.id);
}

/** Everything on screen, by title — the only way to tell these two apart. */
function titles(): string[] {
  return (chat?.threads ?? []).map((t) => t.title);
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

describe("a chat failure message", () => {
  it("is forgotten when the hook is given another article", async () => {
    answer = (url) =>
      url.includes(OTHER)
        ? Promise.resolve(json({ threads: [] }))
        : Promise.reject(new Error("the network is down"));

    await show(SLUG);
    /* The premise. Without this the test could pass by never having had an
       error to forget. */
    expect(api().error).not.toBeNull();
    expect(api().loadFailed).toBe(true);

    await show(OTHER);

    expect(api().error).toBeNull();
    expect(api().loadFailed).toBe(false);
  });

  it("cannot arrive from a repair left behind by the article before", async () => {
    const repair = deferred<Response>();
    let gets = 0;
    answer = (url, init) => {
      if (init?.method === "POST") return Promise.resolve(conflict());
      if (url.includes(OTHER)) return Promise.resolve(json({ threads: [] }));
      gets += 1;
      /* The first GET fills the list; the second is the 409's repair, and it is
         the one held open. */
      return gets === 1 ? Promise.resolve(json({ threads: [BROKEN] })) : repair.promise;
    };

    await show(SLUG);
    expect(ids()).toEqual([BROKEN.id]);

    await act(async () => {
      api().retry(BROKEN.id, "msg-reply");
    });
    await settle();

    /* Both halves of the premise: the retry was refused, and the repair it
       fired is genuinely still in flight. A test that reached the assertion
       without a repair outstanding would pass on any code at all. */
    expect(gets).toBe(2);
    expect(api().error).not.toBeNull();

    await show(OTHER);
    expect(api().error).toBeNull();

    repair.reject(new Error("and the repair never came back"));
    await settle();

    expect(api().error).toBeNull();
  });

  /**
   * And the half I had written off as unobservable, which is not.
   *
   * I claimed in the code that a stale repair could not *write* anything —
   * that the thread it wants to rewrite is not in the new article's list, so
   * both branches of its `setThreads` are no-ops. That is only true if a thread
   * id names one conversation everywhere, and it does not: the table is keyed
   * `(article_id, id)` on purpose. GPT Sol, reviewing this change, 2026-08-28.
   *
   * So the abandoned repair finds a thread with that id after all — a different
   * conversation, under the slug the hook now holds — and replaces it with one
   * from the slug it left. If the repair's answer had *dropped* the thread it
   * would delete this one instead, by the other branch.
   *
   * At the hook's level, not the reader's: see the note at the top of the file.
   */
  it("cannot replace the new article's conversation with the old one's", async () => {
    const repair = deferred<Response>();
    let asked = 0;
    answer = (url, init) => {
      if (init?.method === "POST") return Promise.resolve(conflict());
      if (url.includes(OTHER)) return Promise.resolve(json({ threads: [ELSEWHERE] }));
      asked += 1;
      return asked === 1 ? Promise.resolve(json({ threads: [BROKEN] })) : repair.promise;
    };

    await show(SLUG);
    expect(titles()).toEqual([BROKEN.title]);

    await act(async () => {
      api().retry(BROKEN.id, "msg-reply");
    });
    await settle();
    // The premise: the repair is genuinely out.
    expect(asked).toBe(2);

    await show(OTHER);
    expect(titles()).toEqual([ELSEWHERE.title]);

    /* The first article's copy, arriving late, under an id this article also
       uses. */
    repair.resolve(json({ threads: [BROKEN] }));
    await settle();

    expect(titles()).toEqual([ELSEWHERE.title]);
    expect(ids()).toEqual([ELSEWHERE.id]);
  });
});
