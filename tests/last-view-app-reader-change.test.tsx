// @vitest-environment jsdom
/** The real App must retain last-view identity when its auth branches remount ArticlePage. */
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
/* jsdom has no `showModal` (tests/feedback-dialog.test.tsx). */
Object.assign(window.HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  },
  close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  },
});

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

// Keep the real ArticlePage and App wiring; only the article network answer is held loading.
vi.mock("../src/web/article/access.js", () => ({ useArticleAccess: () => ({ kind: "loading" }) }));
const { App } = await import("../src/web/App.js");
const { lastViewKey } = await import("../src/web/last-view.js");
const { navigate, watchHistoryWrites } = await import("../src/web/router.js");
enableHistorySync();
watchHistoryWrites();

let host: HTMLDivElement;
let root: Root;
const A_VIEW = "?mode=quotes&at=spya-k3m9qt";
const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" },
});
async function settle() {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function become(id: string | null) {
  signedIn = id === null ? null : sessionOf(id);
  act(() => { for (const fn of [...listeners]) fn(id === null ? "SIGNED_OUT" : "SIGNED_IN", signedIn); });
  await settle();
}
async function move(href: string) {
  act(() => navigate(href, { replace: true, scroll: false }));
  await settle();
}
beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", async (url: string) => json(
    url.startsWith("/api/reader") ? { experimentalSince: null } :
    url.startsWith("/api/library") ? { articles: [] } :
    url.startsWith("/api/jobs") ? { jobs: [] } :
    url.startsWith("/api/models") ? { tasks: [] } : {},
  ));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  signedIn = null;
  act(() => { for (const fn of [...listeners]) fn("SIGNED_OUT", null); });
  history.replaceState(null, "", "/profile");
  act(() => root.render(createElement(NuqsAdapter, null, createElement(App))));
  await become("A");
  await move(`/read/x${A_VIEW}`);
  expect(window.localStorage.getItem(lastViewKey("x", "A"))).toBe(A_VIEW);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("another tab signs A out then B in: B never inherits A's address across the remount", async () => {
  await become(null);
  expect(location.search, "sign-out must remove A's article state").toBe("");
  await become("B");
  expect(location.search).toBe("?mode=summary&margin=1");
  expect(window.localStorage.getItem(lastViewKey("x", "B"))).toBe("?mode=summary&margin=1");
  expect(window.localStorage.getItem(lastViewKey("x", "A"))).toBe(A_VIEW);
  await become(null);
  await become("A");
  expect(location.search).toBe(A_VIEW);
});

it("B's saved view wins after signing out and in from another tab", async () => {
  window.localStorage.setItem(lastViewKey("x", "B"), "?mode=timeline");
  await become(null);
  await become("B");
  expect(location.search).toBe("?mode=timeline");
  expect(window.localStorage.getItem(lastViewKey("x", "A"))).toBe(A_VIEW);
});

it("a switch away from the article does not strip an explicit link B opens later", async () => {
  await move("/profile");
  await become("B");
  await move("/read/x?mode=glossary&at=spya-d2w4rt");
  expect(location.search).toBe("?mode=glossary&at=spya-d2w4rt");
  expect(window.localStorage.getItem(lastViewKey("x", "B"))).toBe(location.search);
});

it("a direct A-to-B notification restores B and saves subsequent movement only as B", async () => {
  window.localStorage.setItem(lastViewKey("x", "B"), "?mode=timeline");
  await become("B");
  expect(location.search).toBe("?mode=timeline");
  await move("/read/x?mode=glossary");
  expect(window.localStorage.getItem(lastViewKey("x", "B"))).toBe("?mode=glossary");
  expect(window.localStorage.getItem(lastViewKey("x", "A"))).toBe(A_VIEW);
});

it("one reader returning from the shelf keeps the saved place and gets the default only once", async () => {
  await move("/profile");
  await move("/read/x");
  expect(location.search).toBe(A_VIEW);
  await move("/read/y");
  expect(location.search).toBe("?mode=summary&margin=1");
  await move("/read/y");
  expect(window.localStorage.getItem(lastViewKey("y", "A"))).toBe("");
  await move("/profile");
  await move("/read/y");
  expect(location.search).toBe("");
});
