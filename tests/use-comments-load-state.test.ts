// @vitest-environment jsdom
/**
 * **`loaded` and `loadFailed` on `useComments`, against a real fetch.**
 *
 * The drawer's own tests pose these two flags directly, which proves the drawer
 * reads them and proves nothing at all about the hook that produces them. GPT
 * Sol said so reviewing the first version, 2026-08-27: *"They would not catch
 * `useComments` staying false after success/failure, a stale response winning,
 * or incorrect App wiring."* This is that test.
 *
 * The pair means:
 *
 * - `loaded` — **we have asked**, not it worked. True on the failure path too,
 *   or a drawer opened while the network is down waits for ever with a spinner
 *   turning beside an error message, one of them lying.
 * - `loadFailed` — **and it did not come back.** The half `loaded` cannot
 *   carry, and without it the panel drops out of the spinner into "Nothing
 *   asked yet", which is the original bug one beat later.
 *
 * Same harness as tests/use-chat-recovery.test.ts: React's own `act` and
 * `createRoot`, no testing library, a stubbed `fetch`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "../src/types.js";

/**
 * Only `apiFetch` is replaced; `readJson` is the real one.
 *
 * `apiFetch` reaches for a Supabase session, the offline cache and the online
 * banner before it ever makes a request, none of which this test is about — but
 * `readJson` is precisely the code that decides whether a reply is an answer or
 * a failure, so stubbing *that* would leave the state machine under test being
 * driven by the stub rather than by the hook. lib/api.ts § the rule about the
 * body.
 */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...real, apiFetch: (url: string) => answer(String(url)) };
});

const { useComments } = await import("../src/web/useComments.js");
type CommentsApi = ReturnType<typeof useComments>;

let container: HTMLDivElement;
let root: Root;
let latest: CommentsApi | undefined;

const COMMENT: Comment = {
  id: "cmt-1",
  blockId: "spya-k3m9qt",
  quote: "the sentence he asked about",
  start: 0,
  createdAt: "2026-08-27T10:00:00.000Z",
  status: "done",
  answer: "Because of the thing in the paragraph before.",
};

/**
 * What `GET /api/comments/:slug` does, per slug — posed by each test.
 *
 * A function returning a promise the test keeps hold of, so a request can be
 * left in flight while the article changes underneath it. That interleaving is
 * the one a flag like this gets wrong.
 */
let answer: (slug: string) => Promise<Response>;

function Harness({ slug }: { slug: string }) {
  latest = useComments(slug);
  return null;
}

/** Render, or re-render at a different article. */
async function show(slug: string): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, { slug }));
  });
}

/** Let the pending promises resolve into state. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A JSON reply, built the way the server builds one. */
function json(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), {
    status: ok ? 200 : 500,
    headers: { "content-type": "application/json" },
  });
}

/** A promise the test resolves by hand. */
function deferred<T>(): { promise: Promise<T>; resolve(v: T): void; reject(e: Error): void } {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  latest = undefined;
  answer = () => Promise.resolve(json({ comments: [] }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useComments, on the fetch that fills the list", () => {
  it("opts into whole-block anchors", async () => {
    const asked: string[] = [];
    answer = (url) => {
      asked.push(url);
      return Promise.resolve(json({ comments: [] }));
    };
    await show("a-piece");
    await settle();
    expect(asked).toEqual(["/api/comments/a-piece?anchors=whole-block"]);
  });

  it("starts not knowing", async () => {
    const held = deferred<Response>();
    answer = () => held.promise;
    await show("a-piece");
    expect(latest?.loaded).toBe(false);
    expect(latest?.loadFailed).toBe(false);
    held.resolve(json({ comments: [] }));
    await settle();
  });

  it("knows, and knows it worked, once an empty answer lands", async () => {
    answer = () => Promise.resolve(json({ comments: [] }));
    await show("a-piece");
    await settle();
    expect(latest?.loaded).toBe(true);
    expect(latest?.loadFailed).toBe(false);
    expect(latest?.comments).toEqual([]);
  });

  it("carries the comments through", async () => {
    answer = () => Promise.resolve(json({ comments: [COMMENT] }));
    await show("a-piece");
    await settle();
    expect(latest?.comments.map((c) => c.id)).toEqual(["cmt-1"]);
    expect(latest?.loadFailed).toBe(false);
  });

  /* `loaded` on the failure path is deliberate — see the docstring. What must
     not happen is `loadFailed` staying false, which is what turns "the server
     did not answer" into "you have asked nothing". */
  it("says both things when the request throws", async () => {
    answer = () => Promise.reject(new Error("network down"));
    await show("a-piece");
    await settle();
    expect(latest?.loaded).toBe(true);
    expect(latest?.loadFailed).toBe(true);
    /* In `loadError`, not `error`: `error` is the writes', and a write clears
       it — which is how a failed load used to vanish behind the next comment
       saved (plan 260908f § A). */
    expect(latest?.loadError).toContain("network down");
    expect(latest?.error).toBeNull();
  });

  /* A 200 carrying `{ error }` has no comments in it either. Reading "nothing
     asked yet" off that body is the same false claim as reading it off a
     dropped connection. */
  it("counts a body with an error in it as a failed load", async () => {
    answer = () => Promise.resolve(json({ error: "the store is not there" }));
    await show("a-piece");
    await settle();
    expect(latest?.loaded).toBe(true);
    expect(latest?.loadFailed).toBe(true);
  });

  /* Switching article puts the hook back to not-knowing. Leaving `loaded` true
     would show the previous article's emptiness as though it were this one's —
     the same bug wearing the flag that was supposed to stop it. */
  it("forgets what it knew when the article changes", async () => {
    answer = () => Promise.resolve(json({ comments: [COMMENT] }));
    await show("a-piece");
    await settle();
    expect(latest?.loaded).toBe(true);

    const held = deferred<Response>();
    answer = () => held.promise;
    await show("another-piece");
    expect(latest?.loaded).toBe(false);
    expect(latest?.comments).toEqual([]);
    held.resolve(json({ comments: [] }));
    await settle();
    expect(latest?.loaded).toBe(true);
  });

  /* The interleaving that a naive `live` flag gets wrong: the first article's
     request lands *after* the second article's has been issued. It must not
     mark the second one loaded, and it must not fail it either. */
  it("lets a late answer for the article you left do nothing at all", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    answer = (url) => (url.includes("a-piece") ? first.promise : second.promise);

    await show("a-piece");
    await show("another-piece");
    expect(latest?.loaded).toBe(false);

    // The one we walked away from, arriving late and failing.
    first.reject(new Error("too late, and broken"));
    await settle();
    expect(latest?.loaded).toBe(false);
    expect(latest?.loadFailed).toBe(false);

    second.resolve(json({ comments: [COMMENT] }));
    await settle();
    expect(latest?.loaded).toBe(true);
    expect(latest?.loadFailed).toBe(false);
    expect(latest?.comments.map((c) => c.id)).toEqual(["cmt-1"]);
  });
});
