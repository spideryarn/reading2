// @vitest-environment jsdom
/**
 * **`loadFailed` on the two hooks the panel tests cannot reach.**
 *
 * `tests/use-comments-load-state.test.ts` does this for comments. GPT Sol asked
 * for the same on the other two, 2026-08-27, and it was right to: *"nothing
 * tests `useChat`'s boolean-returning `refresh`, StrictMode duplication,
 * `useSearch.loadFailed` … This is why finding 1 passes all current tests."*
 *
 * Finding 1 was this. `useChat`'s mount effect guarded its result with
 * `showing.current !== slug`, which distinguishes **articles**, not **runs of
 * the effect** — and under `StrictMode` React deliberately runs it twice for
 * the same article. So two fetches were in flight for one slug, and the first
 * one failing *after* the second one succeeded set `loadFailed` back to true.
 * The panel then said it could not load a list it was showing. The last test
 * here is that story.
 *
 * Same harness as tests/use-comments-load-state.test.ts: React's own `act` and
 * `createRoot`, `apiFetch` stubbed and the real `readJson` behind it.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the next `GET` answers with. Posed per test, by URL.
 *
 * A function rather than a value, so a test can hand out a promise it resolves
 * later — the only way to have two requests for one article in flight at once,
 * which is the case that was broken.
 */
let answer: (url: string) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  return { ...real, apiFetch: (url: string) => answer(String(url)) };
});

const { useChat } = await import("../src/web/useChat.js");
const { useSearch } = await import("../src/web/useSearch.js");

const SLUG = "a-piece";

let container: HTMLDivElement;
let root: Root;
let chat: ReturnType<typeof useChat> | undefined;
let search: ReturnType<typeof useSearch> | undefined;

function ChatHarness() {
  chat = useChat(SLUG);
  return null;
}
function SearchHarness() {
  search = useSearch(SLUG);
  return null;
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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mount(el: () => React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(el());
  });
  await settle();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  chat = undefined;
  search = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useChat", () => {
  it("says it worked when the list comes back", async () => {
    answer = () => Promise.resolve(json({ threads: [] }));
    await mount(() => createElement(ChatHarness));
    expect(chat?.loaded).toBe(true);
    expect(chat?.loadFailed).toBe(false);
  });

  it("says it failed when the request throws", async () => {
    answer = () => Promise.reject(new Error("network down"));
    await mount(() => createElement(ChatHarness));
    expect(chat?.loaded).toBe(true);
    expect(chat?.loadFailed).toBe(true);
  });

  /* `refresh` returns false for a body carrying `{ error }` as well as for a
     thrown request — there are no threads in it either way. */
  it("says it failed when the body carries an error", async () => {
    answer = () => Promise.resolve(json({ error: "the store is not there" }));
    await mount(() => createElement(ChatHarness));
    expect(chat?.loaded).toBe(true);
    expect(chat?.loadFailed).toBe(true);
  });

  /**
   * **The bug, reproduced.** Two fetches for one article, the second answering
   * first and the first failing afterwards. Before the fix, the late failure
   * set `loadFailed` on a list that had already arrived.
   *
   * `StrictMode` is how the app really produces this — see the docstring — and
   * mounting under it here means the test is exercising the same double-run
   * React does rather than a hand-built imitation of it.
   */
  it("ignores an earlier fetch failing after a later one succeeded", async () => {
    const first = deferred<Response>();
    let call = 0;
    answer = () => {
      call += 1;
      return call === 1 ? first.promise : Promise.resolve(json({ threads: [] }));
    };

    await mount(() => createElement(StrictMode, null, createElement(ChatHarness)));
    /* Two runs of the effect, so two requests. If React ever stops doing this
       the rest of the test proves nothing, so it is asserted rather than
       assumed. */
    expect(call).toBe(2);
    expect(chat?.loaded).toBe(true);
    expect(chat?.loadFailed).toBe(false);

    first.reject(new Error("the abandoned one, failing late"));
    await settle();
    expect(chat?.loadFailed).toBe(false);
  });
});

describe("useSearch", () => {
  it("says it worked when the runs come back", async () => {
    answer = () => Promise.resolve(json({ runs: [] }));
    await mount(() => createElement(SearchHarness));
    expect(search?.loaded).toBe(true);
    expect(search?.loadFailed).toBe(false);
  });

  it("says it failed when the request throws", async () => {
    answer = () => Promise.reject(new Error("network down"));
    await mount(() => createElement(SearchHarness));
    expect(search?.loaded).toBe(true);
    expect(search?.loadFailed).toBe(true);
  });

  it("says it failed when the body carries an error", async () => {
    answer = () => Promise.resolve(json({ error: "the store is not there" }));
    await mount(() => createElement(SearchHarness));
    expect(search?.loaded).toBe(true);
    expect(search?.loadFailed).toBe(true);
  });
});
