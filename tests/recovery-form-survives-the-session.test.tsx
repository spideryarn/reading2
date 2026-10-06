// @vitest-environment jsdom
/**
 * **The choose-a-new-password form stays up when the session arrives**, asserted
 * by mounting the real `App`.
 *
 * The form is rendered inline by AuthCallback rather than on a route of its own
 * (docs/plans/261001i-password-reset.md). That is only safe because `App`
 * answers `/auth/callback` before its loading and user gates, so `useSession`
 * delivering the recovery session re-renders `App` without unmounting the
 * callback. A change that moved the callback below the gate would swap the form
 * for the shelf at exactly the moment the reader started typing. GPT Sol's plan
 * review, finding 4.
 */
import { act, createElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, expect, it, vi } from "vitest";

/** Who `useSession` says is here, as a store the test can change under `App`. */
type SessionState = {
  session: { access_token: string } | null;
  user: { id: string; email: string } | null;
  loading: boolean;
  known: boolean;
};
let state: SessionState = { session: null, user: null, loading: true, known: false };
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
      initialize: async () => ({ error: null }),
      getSession: async () => ({ data: { session: { access_token: "recovered" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "recovered" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      updateUser: async () => ({ data: { user: {} }, error: null }),
    },
  },
  urlSessionKind: async () => "recovery",
  arrivedWithCode: () => true,
  forgetCodeArrival: () => {},
  googleSignInAvailable: false,
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
globalThis.fetch = (async () =>
  new Response("[]", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { App } = await import("../src/web/App.js");

let host: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const passwordBoxes = () => host.querySelectorAll('input[type="password"]').length;

it("keeps the form mounted while the session goes from loading to signed in", async () => {
  history.replaceState(null, "", "/auth/callback?code=abc123");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  for (let i = 0; i < 20 && passwordBoxes() === 0; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
  expect(passwordBoxes()).toBe(2);

  await act(async () => {
    setState({
      session: { access_token: "recovered" },
      user: { id: "11111111-1111-4000-8000-000000000001", email: "reader@example.test" },
      loading: false, known: true,
    });
  });

  expect(passwordBoxes()).toBe(2);
  expect(host.querySelector("h1")?.textContent).toBe("Choose a new password");
});
