// @vitest-environment jsdom
/**
 * `useSession` — **the hook that can blank the whole app**.
 *
 * GPT Sol's review of the built code, 2026-08-27, item 5:
 *
 * > It is not sufficient when initialization hangs. `useSession.ts` has no
 * > deadline or error state, while `App.tsx` renders `null` while loading. A
 * > stuck PKCE or refresh request can therefore produce a permanently blank
 * > page.
 *
 * That is the worst possible failure mode for a reading app: no error, no
 * spinner, no address-bar change, nothing to screenshot, and every ordinary
 * remedy (reload) reproduces it. The fix is a deadline. This is the test for
 * it, and item 10 of the same review is why it exists at all:
 *
 * > There are no `useSession` initialization/hang tests.
 *
 * ## Why jsdom, and why no testing library
 *
 * `jsdom` is already a dependency (Readability uses it), and React 19 exports
 * `act` itself — so a hook can be driven with `createRoot` and about fifteen
 * lines of harness rather than a new devDependency and a new idiom. The repo's
 * rule about dependencies is in docs/reusable/third-party-library-selection.md;
 * the short version is that nothing here needed one.
 */
import { act } from "react";
import { createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The listener the hook registers, so a test can be the SDK. */
let announce: ((event: string, session: unknown) => void) | null = null;
const getSession = vi.fn();
const unsubscribe = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        announce = fn;
        return { data: { subscription: { unsubscribe } } };
      },
    },
  },
  CALLBACK_PATH: "/auth/callback",
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

const { useSession } = await import("../src/web/useSession.js");

/** Render the hook and hand back whatever it last returned. */
function drive(): { state: () => ReturnType<typeof useSession>; stop: () => void } {
  let latest: ReturnType<typeof useSession> | null = null;
  function Probe(): ReactNode {
    latest = useSession();
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: Root;
  act(() => {
    root = createRoot(host);
    root.render(createElement(Probe));
  });
  return {
    state: () => {
      if (!latest) throw new Error("the hook never rendered");
      return latest;
    },
    stop: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  announce = null;
  getSession.mockReset();
  unsubscribe.mockReset();
  /* A promise that never settles: the SDK hanging, which is the whole subject. */
  getSession.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("while the SDK is starting up", () => {
  it("reports loading, so nothing flashes signed-out and back", () => {
    const { state, stop } = drive();
    expect(state().loading).toBe(true);
    expect(state().user).toBeNull();
    stop();
  });

  /**
   * The ordinary path: the SDK answers, and it answers with nobody. That is a
   * perfectly good answer and must end the loading state immediately — a reader
   * who is signed out should see the sign-in page, not a spinner that times out.
   */
  it("stops loading the moment the SDK says nobody is signed in", () => {
    const { state, stop } = drive();
    act(() => announce?.("INITIAL_SESSION", null));
    expect(state().loading).toBe(false);
    expect(state().user).toBeNull();
    stop();
  });

  it("stops loading with a user when there is one", () => {
    const { state, stop } = drive();
    const user = { id: "abc", email: "a@b.test" };
    act(() => announce?.("INITIAL_SESSION", { access_token: "t", user }));
    expect(state().loading).toBe(false);
    expect(state().user).toMatchObject({ email: "a@b.test" });
    stop();
  });

  /**
   * **The blank page.** No event ever arrives — a stuck PKCE exchange, a
   * refresh that never returns, a network that accepted the connection and
   * then went quiet. Without a deadline this stays `loading: true` for ever and
   * `App` goes on rendering `null`.
   *
   * The deadline gives up and treats it as signed out, which is the right way
   * to be wrong: the reader gets a sign-in page they can act on rather than a
   * white rectangle they cannot.
   */
  it("gives up rather than leaving the app blank for ever", () => {
    const { state, stop } = drive();
    expect(state().loading).toBe(true);
    act(() => vi.advanceTimersByTime(9_000));
    expect(state().loading).toBe(false);
    expect(state().user).toBeNull();
    stop();
  });

  /** And it is a deadline, not a delay: a fast answer is not made to wait for it. */
  it("does not hold a fast answer back until the deadline", () => {
    const { state, stop } = drive();
    act(() => announce?.("INITIAL_SESSION", null));
    expect(state().loading).toBe(false);
    act(() => vi.advanceTimersByTime(9_000));
    expect(state().loading).toBe(false);
    stop();
  });

  /**
   * A late answer after the deadline has fired must still be honoured — the
   * reader really is signed in, and the deadline was a guess about the network.
   */
  it("still signs the reader in if the answer turns up late", () => {
    const { state, stop } = drive();
    act(() => vi.advanceTimersByTime(9_000));
    expect(state().user).toBeNull();
    act(() => announce?.("SIGNED_IN", { access_token: "t", user: { id: "x", email: "l@b.test" } }));
    expect(state().user).toMatchObject({ email: "l@b.test" });
    expect(state().loading).toBe(false);
    stop();
  });
});

describe("signing out", () => {
  it("drops the user without going back to loading", () => {
    const { state, stop } = drive();
    act(() => announce?.("SIGNED_IN", { access_token: "t", user: { id: "x", email: "a@b.test" } }));
    act(() => announce?.("SIGNED_OUT", null));
    expect(state().user).toBeNull();
    /* Not `loading` — that would blank the app on the way to the sign-in page,
       which looks exactly like the hang above. */
    expect(state().loading).toBe(false);
    stop();
  });
});

describe("tidying up", () => {
  it("unsubscribes when the component goes away", () => {
    const { stop } = drive();
    stop();
    expect(unsubscribe).toHaveBeenCalled();
  });

  /** A timer left running after unmount sets state on a dead tree. */
  it("does not fire its deadline after unmount", () => {
    const { stop } = drive();
    stop();
    expect(() => act(() => vi.advanceTimersByTime(30_000))).not.toThrow();
  });
});
