// @vitest-environment jsdom
/**
 * **A password sign-in on `/login` lands where the sign-in page was told to go**
 * — and an address alone sends nobody anywhere. docs/plans/261001m, GPT Sol's
 * plan review F1.
 *
 * Mounts the real `App` under `StrictMode`, because the signed-in `/login`
 * branch navigates during render: StrictMode renders it twice with the same
 * props, and the second render must not send the reader on to the shelf over
 * the destination the first one took.
 */
import { act, createElement, StrictMode, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type SessionState = {
  session: { access_token: string } | null;
  user: { id: string; email: string } | null;
  loading: boolean;
  known: boolean;
};
let state: SessionState = { session: null, user: null, loading: false, known: true };
const listeners = new Set<() => void>();
function setState(next: SessionState) {
  state = next;
  for (const l of listeners) l();
}

vi.mock("../src/web/useSession.js", () => ({
  useSession: () =>
    useSyncExternalStore(
      (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      () => state,
    ),
}));

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  urlSessionKind: async () => "sign-in",
  arrivedWithCode: () => false,
  forgetCodeArrival: () => {},
  googleSignInAvailable: async () => true,
  CALLBACK_PATH: "/auth/callback",
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

class NoResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.assign(globalThis, { ResizeObserver: NoResizeObserver });
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("../src/web/App.js");
const { rememberReturn } = await import("../src/web/auth-return.js");

const READER = {
  session: { access_token: "t" },
  user: { id: "11111111-1111-4000-8000-000000000001", email: "reader@example.test" },
  loading: false, known: true,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  state = { session: null, user: null, loading: false, known: true };
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function openAt(address: string): Promise<void> {
  history.replaceState(null, "", address);
  await act(async () => {
    root.render(
      createElement(StrictMode, null, createElement(NuqsAdapter, null, createElement(App, null))),
    );
  });
}

async function signInHere(): Promise<void> {
  await act(async () => setState(READER));
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

it("shows the sign-in page to a stranger", async () => {
  await openAt("/login?next=%2Fpricing");
  expect(host.querySelector("h1")?.textContent).toMatch(/sign in or create an account/i);
});

it("goes where the sign-in page remembered, once the session arrives", async () => {
  await openAt("/login?next=%2Fpricing");
  /* What SignInControls does on submit; tests/sign-in-controls.test.tsx pins that half. */
  rememberReturn("/pricing");
  await signInHere();
  expect(location.pathname).toBe("/pricing");
});

it("goes to the shelf when nothing was remembered, whatever the address says", async () => {
  await openAt("/login?next=%2Fpricing");
  await signInHere();
  expect(location.pathname).toBe("/");
});
