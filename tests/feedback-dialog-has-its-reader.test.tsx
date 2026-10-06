// @vitest-environment jsdom
/**
 * **The Feedback box is drawn inside the reader `App` provides**, so a write
 * it makes late (a dictated recording still draining, most of all) names the
 * reader it was mounted for. docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 2.
 *
 * `FeedbackHost` wraps every page and draws the dialog itself, beside its
 * children. With the provider inside the host, the pages had a reader and
 * the dialog had `null`, which is unfenced: a recording made by reader A in
 * the Feedback box could be uploaded with reader B's token. The dialog here
 * is a probe that says what `useMadeFor` answers where the real one is drawn.
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

vi.mock("../src/web/FeedbackDialog.js", async () => {
  const { useMadeFor } = await import("../src/web/lib/made-for.js");
  const { createElement: h } = await import("react");
  return {
    FeedbackDialog: () => h("output", { "data-feedback-made-for": useMadeFor() ?? "nobody" }),
  };
});

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


it("gives the Feedback dialog the signed-in reader", () => {
  const drawn = host.querySelector("[data-feedback-made-for]");
  expect(drawn?.getAttribute("data-feedback-made-for")).toBe("A");
});
