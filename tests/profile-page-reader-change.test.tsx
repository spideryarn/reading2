// @vitest-environment jsdom
/**
 * **`/profile` forgets the last reader, and what it owed them is not sent as
 * the next.** docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2;
 * GPT Sol's review, F3 (docs/plans/261006f-plan-review-sol.md).
 *
 * The profile page is not under the article's gate, so nothing unmounted it
 * when another tab signed in as somebody else: reader A's *About you*, loaded
 * and half edited, stayed in the box for reader B, and its next save went to
 * `/api/reader`, which is whoever the token says.
 *
 * **The whole `App` is rendered, on purpose.** The second case is the only
 * check that `App` provides the reader every page's late writes are named
 * for (lib/made-for.ts): take the provider out and the unmount save here goes
 * out as B.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
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
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false },
    readOnly: false,
    busy: false,
    toggle: () => {},
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));

const { App } = await import("../src/web/App.js");

interface Sent {
  method: string;
  url: string;
  as: string | null;
}
let sent: Sent[] = [];
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** The server: each reader's own description, by the token the request carried. */
function answer(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const as = new Headers(init.headers).get("Authorization");
  sent.push({ method, url, as });
  const who = as?.replace("Bearer TOKEN-", "") ?? "nobody";
  const path = url.split("?")[0] ?? url;
  if (method !== "GET") return Promise.resolve(json(typeof init.body === "string" ? JSON.parse(init.body) : {}));
  if (path === "/api/reader") return Promise.resolve(json({ profile: `About ${who}.`, autoModes: true }));
  if (path === "/api/library") return Promise.resolve(json({ articles: [] }));
  if (path === "/api/models") return Promise.resolve(json({ tasks: [] }));
  if (path === "/api/jobs") return Promise.resolve(json({ jobs: [] }));
  return Promise.resolve(json({}));
}
const writtenAsB = () =>
  sent.filter((r) => r.method !== "GET" && r.as === "Bearer TOKEN-B").map((r) => `${r.method} ${r.url}`);

let host: HTMLDivElement;
let root: Root;

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}
async function become(id: string): Promise<void> {
  signedIn = sessionOf(id);
  act(() => {
    for (const fn of [...listeners]) fn("SIGNED_IN", signedIn);
  });
  await settle();
}
const box = (): HTMLTextAreaElement => {
  const el = host.querySelector<HTMLTextAreaElement>("#reader-profile");
  if (!el) throw new Error("no About you box on /profile");
  return el;
};
function type(value: string): void {
  const el = box();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  sent = [];
  vi.stubGlobal("fetch", answer);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/profile");
  act(() => {
    for (const fn of [...listeners]) fn("SIGNED_OUT", null);
  });
  act(() => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await become("A");
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("shows B their own About you, not the one A had loaded", async () => {
  expect(box().value).toBe("About A.");
  await become("B");
  expect(box().value).toBe("About B.");
  expect(writtenAsB()).toEqual([]);
});

it("does not write what A had typed and not saved as B", async () => {
  expect(box().value).toBe("About A.");
  type("About A, and something B must never be told.");
  await become("B");
  expect(box().value).toBe("About B.");
  expect(writtenAsB()).toEqual([]);
});
