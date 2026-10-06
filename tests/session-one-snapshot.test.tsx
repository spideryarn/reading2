// @vitest-environment jsdom
/**
 * **The screen and the request fence read one identity, so a reader's own
 * request is never refused.**
 * docs/plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md § Stage 1;
 * found by GPT Sol's review (docs/plans/261006f-reader-bound-plan-review-sol.md, F1).
 *
 * The SDK here behaves as the installed `@supabase/auth-js` does in the one
 * way that matters: **each new `onAuthStateChange` subscriber is sent its own
 * `INITIAL_SESSION`, read from storage at that moment.** So two subscribers
 * can hold different readers: another tab writes B's session to shared
 * storage, and before the broadcast arrives a late subscriber is told B while
 * an early one still holds A. When `useSession` and `api.ts` each subscribed,
 * the screen was drawn for B and B's request was bound to A and refused.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeSession {
  access_token: string;
  user: { id: string };
}
const sessionOf = (id: string): FakeSession => ({ access_token: `TOKEN-${id}`, user: { id } });

/** What is in shared storage: every tab of this browser reads the same one. */
let storage: FakeSession | null = null;
const subscribers = new Set<(event: string, session: FakeSession | null) => void>();
/** The cross-tab broadcast, when it finally arrives: every subscriber, in order. */
function broadcast(event: string): void {
  for (const fn of [...subscribers]) fn(event, storage);
}

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: storage } }),
      refreshSession: async () => ({ data: { session: storage } }),
      onAuthStateChange: (fn: (event: string, session: FakeSession | null) => void) => {
        subscribers.add(fn);
        /* Its own INITIAL_SESSION, from storage as it is when this one is
           served, a task after it subscribed. */
        setTimeout(() => {
          if (subscribers.has(fn)) fn("INITIAL_SESSION", storage);
        }, 0);
        return { data: { subscription: { unsubscribe: () => subscribers.delete(fn) } } };
      },
    },
  },
  googleSignInAvailable: false,
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

/* The tab was opened by A: whatever subscribes at import hears A. */
storage = sessionOf("A");
const { apiFetch } = await import("../src/web/lib/api.js");
const { useSession } = await import("../src/web/useSession.js");
await new Promise((resolve) => setTimeout(resolve, 0));

/** What each screen's own request came to: the token it went out with, or the refusal. */
let outcomes: { screen: string; result: string }[] = [];
let sent: (string | null)[] = [];

/** `App`, as far as this goes: a screen for whoever `useSession` says, which asks for its shelf. */
function Screen() {
  const { user, loading } = useSession();
  const reader = loading ? null : (user?.id ?? null);
  useEffect(() => {
    if (reader === null) return;
    apiFetch("/api/library").then(
      (r) => outcomes.push({ screen: reader, result: String(r.status) }),
      (e: Error) => outcomes.push({ screen: reader, result: e.name }),
    );
  }, [reader]);
  return createElement("p", { "data-reader": reader ?? "" });
}

let host: HTMLDivElement;
let root: Root;
const drawn = () => host.querySelector("p")?.getAttribute("data-reader");
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  outcomes = [];
  sent = [];
  vi.stubGlobal("fetch", (_url: string, init: RequestInit = {}) => {
    sent.push(new Headers(init.headers).get("Authorization"));
    return Promise.resolve(
      new Response('{"articles":[]}', { status: 200, headers: { "content-type": "application/json" } }),
    );
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("a screen drawn for B has its own request sent as B, when storage became B's before the broadcast", async () => {
  /* Another tab signs in as B. Storage is shared; the broadcast has not arrived. */
  storage = sessionOf("B");
  act(() => root.render(createElement(Screen)));
  await settle();

  expect(drawn()).toBe("B");
  /* The screen's own reader is never the one refused. */
  expect(outcomes.filter((o) => o.screen === drawn())).toEqual([{ screen: "B", result: "200" }]);
  expect(sent.at(-1)).toBe("Bearer TOKEN-B");
  /* And nothing went out carrying a token for a reader the screen was not drawn for. */
  expect(sent.filter((token) => token !== "Bearer TOKEN-B")).toEqual([]);

  /* The broadcast, late, changes nothing. */
  act(() => broadcast("SIGNED_IN"));
  await settle();
  expect(drawn()).toBe("B");
  expect(outcomes.filter((o) => o.result === "NotThisReader" && o.screen === "B")).toEqual([]);
});
