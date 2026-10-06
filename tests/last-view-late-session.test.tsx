// @vitest-environment jsdom
/**
 * **A session that answers late is not a change of reader.** `useSession`
 * stops showing "loading" after eight seconds whether or not the SDK has said
 * who is signed in. If `useLastView` took that for "signed out", the answer
 * that then names the reader would look like a change of reader, and a shared
 * link's `?mode=` and `?at=` would be stripped on a cold load
 * (GPT Sol, plan 261006h, code review round two, D1).
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
/* jsdom's storages are shadowed by Node's own globals here (tests/add-page-purpose.test.tsx). */
for (const name of ["localStorage", "sessionStorage"] as const) {
  const kept = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
      clear: () => kept.clear(),
    },
  });
}
class NoObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoObserver, IntersectionObserver: NoObserver });
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });

interface FakeSession {
  access_token: string;
  user: { id: string; email: string };
}
let signedIn: FakeSession | null = null;
const listeners = new Set<(event: string, session: FakeSession | null) => void>();
const sessionOf = (id: string): FakeSession => ({
  access_token: `TOKEN-${id}`,
  user: { id, email: `${id}@example.com` },
});

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: signedIn } }),
      refreshSession: async () => ({ data: { session: signedIn } }),
      onAuthStateChange: (fn: (event: string, session: FakeSession | null) => void) => {
        listeners.add(fn);
        return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } };
      },
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

// The real App and ArticlePage; only the article's network answer is held loading.
vi.mock("../src/web/article/access.js", () => ({ useArticleAccess: () => ({ kind: "loading" }) }));
const { App } = await import("../src/web/App.js");
const { lastViewKey } = await import("../src/web/last-view.js");
const { watchHistoryWrites } = await import("../src/web/router.js");
const { resetSessionForTests } = await import("../src/web/lib/session.js");
enableHistorySync();
watchHistoryWrites();

let host: HTMLDivElement;
let root: Root;
const LINK = "?mode=glossary&at=spya-d2w4rt";
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const ANSWERS: Record<string, unknown> = {
  "/api/reader": { experimentalSince: null },
  "/api/library": { articles: [] },
  "/api/jobs": { jobs: [] },
  "/api/models": { tasks: [] },
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  resetSessionForTests();
  signedIn = null;
  vi.stubGlobal("fetch", async (url: string) => json(ANSWERS[url.split("?")[0] ?? url] ?? {}));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("a cold shared link keeps its parameters when the session answers after the loading deadline", async () => {
  history.replaceState(null, "", `/read/slow-cold${LINK}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App)));
  });
  /* Nothing has said who is signed in, and the deadline passes. */
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9_000);
  });
  expect(location.search).toBe(LINK);

  signedIn = sessionOf("A");
  await act(async () => {
    for (const fn of [...listeners]) fn("INITIAL_SESSION", signedIn);
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(location.search).toBe(LINK);
  expect(window.localStorage.getItem(lastViewKey("slow-cold", "A"))).toBe(LINK);
  expect(window.localStorage.getItem(lastViewKey("slow-cold", null))).toBeNull();
});
