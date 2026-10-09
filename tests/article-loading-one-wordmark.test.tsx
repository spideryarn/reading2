// @vitest-environment jsdom
/**
 * **An article that is still loading draws one wordmark, not two.** Past the
 * 600ms threshold the page draws the wordmark large and centred as its spinner
 * (LogoLoader.tsx); the corner `HomeLogo` beside it was a second copy of the
 * same mark. Greg, 2026-10-09 (spya-mdmqqq): *"If so, that doesn't feel
 * necessary - we don't need both."* The real App and ArticlePage, with only
 * the article-access hook held at `loading` — the harness is
 * tests/last-view-late-session.test.tsx's.
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

// The real App and ArticlePage; only the article-access hook is held at loading.
vi.mock("../src/web/article/access.js", () => ({ useArticleAccess: () => ({ kind: "loading" }) }));
const { App } = await import("../src/web/App.js");
const { watchHistoryWrites } = await import("../src/web/router.js");
const { resetSessionForTests } = await import("../src/web/lib/session.js");
enableHistorySync();
watchHistoryWrites();

let host: HTMLDivElement;
let root: Root;
const ANSWERS: Record<string, unknown> = {
  "/api/reader": { experimentalSince: null },
  "/api/library": { articles: [] },
  "/api/jobs": { jobs: [] },
  "/api/models": { tasks: [] },
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  resetSessionForTests();
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

for (const who of ["signed out", "signed in"] as const) {
  it(`a loading article, ${who}, draws only the centred wordmark`, async () => {
    signedIn = who === "signed in" ? sessionOf("A") : null;
    history.replaceState(null, "", "/read/still-loading");
    await act(async () => {
      root.render(createElement(NuqsAdapter, null, createElement(App)));
    });
    await act(async () => {
      for (const fn of [...listeners]) fn("INITIAL_SESSION", signedIn);
      await vi.advanceTimersByTimeAsync(50);
    });
    /* Before the threshold: no wordmark at all, so none can flash and vanish. */
    expect(host.querySelectorAll(".logo-home, .logo-loader")).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(host.querySelectorAll(".logo-loader")).toHaveLength(1);
    expect(host.querySelectorAll(".logo-home")).toHaveLength(0);
  });
}
