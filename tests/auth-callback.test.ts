// @vitest-environment jsdom
/**
 * `AuthCallback` — **the page that decides whether you are signed in**.
 *
 * GPT Sol's review of the built code, 2026-08-27, item 4:
 *
 * > The problem is that `AuthCallback.tsx` treats the existence of any session
 * > as proof that this callback succeeded. Supabase preserves an existing
 * > session when a new callback exchange fails. A user who already has a
 * > session can therefore receive a bad or expired callback and be redirected
 * > as though that attempted sign-in or account switch succeeded.
 *
 * and item 10:
 *
 * > There are no component tests for `AuthCallback`, including
 * > existing-session-plus-failed-exchange, timeout, denial, parameter cleanup
 * > or missing verifier.
 *
 * The first of those is the one worth dwelling on, because it is the shape this
 * repo keeps finding: the check and the thing being checked shared an
 * assumption, so **the wrong answer and the right answer looked identical**.
 * `getSession()` returning a session is true either way. Only
 * `initialize()`'s own error is about *this* attempt.
 * docs/reusable/silent-success.md.
 *
 * ## What is asserted, and what is not
 *
 * These check where the reader ends up and what the address bar is left holding
 * — not the wording of any message, which lives in the component and is allowed
 * to change. The one exception is the bracketed code at the end of each
 * message, which docs/project/copy.md exists to keep stable precisely so that a
 * test can pin it without pinning prose.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const getSession = vi.fn();
const navigate = vi.fn();
const takeReturn = vi.fn();

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: { auth: { initialize, getSession } },
  CALLBACK_PATH: "/auth/callback",
  callbackUrl: () => "https://spideryarn.test/auth/callback",
}));

vi.mock("../src/web/auth-return.js", () => ({ takeReturn }));

vi.mock("../src/web/router.js", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  navigate,
}));

const { AuthCallback } = await import("../src/web/AuthCallback.js");

let root: Root | null = null;

/** Land on the callback address with a given query string, and let the effect run. */
async function arriveWith(search: string): Promise<string> {
  history.replaceState(null, "", `/auth/callback${search}`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(createElement(AuthCallback));
  });
  /* Let the promise chain inside the effect drain — `initialize().then(...)`
     is two microtask hops deep before it decides anything. */
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return host.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  initialize.mockReset();
  getSession.mockReset();
  navigate.mockReset();
  takeReturn.mockReset();
  takeReturn.mockReturnValue(null);
  initialize.mockResolvedValue({ error: null });
  getSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("a sign-in that worked", () => {
  it("sends the reader on", async () => {
    await arriveWith("?code=abc123&state=xyz");
    expect(navigate).toHaveBeenCalled();
  });

  it("sends them where they were going, if we remembered", async () => {
    takeReturn.mockReturnValue("/read/some-article");
    await arriveWith("?code=abc123");
    expect(navigate).toHaveBeenCalledWith("/read/some-article", { replace: true });
  });

  /** A live authorisation code must not stay in the address bar, or in history. */
  it("takes the code out of the address bar", async () => {
    await arriveWith("?code=abc123&state=xyz&at=spya-k3m9qt");
    expect(location.search).not.toContain("code=");
    expect(location.search).not.toContain("state=");
    /* And leaves alone what was not ours. */
    expect(location.search).toContain("at=spya-k3m9qt");
  });
});

describe("a sign-in that did not", () => {
  /**
   * **The finding.** Somebody is already signed in; a second, bad callback
   * arrives. `getSession()` says yes — it is describing the *old* session — and
   * the old code redirected as though the new sign-in had worked. Someone
   * switching accounts would land back in the first account's library with no
   * indication anything had failed.
   */
  it("does not call a failed exchange a success just because a session exists", async () => {
    initialize.mockResolvedValue({ error: new Error("invalid request: code verifier missing") });
    getSession.mockResolvedValue({ data: { session: { access_token: "the-old-one" } } });

    const shown = await arriveWith("?code=stale-or-replayed");

    expect(navigate).not.toHaveBeenCalled();
    expect(shown).toContain("[auth-exchange]");
  });

  /** And the stored destination is consumed, so it cannot redirect the next attempt. */
  it("does not leave the return destination lying about", async () => {
    initialize.mockResolvedValue({ error: new Error("nope") });
    await arriveWith("?code=stale");
    expect(takeReturn).toHaveBeenCalled();
  });

  it("says the provider refused, without quoting the provider", async () => {
    const shown = await arriveWith(
      "?error=access_denied&error_code=access_denied&error_description=The+user+did+not+approve",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(shown).toContain("[auth-denied]");
    /* docs/project/copy.md: never repeat what the provider said. Their text is
       not ours to show, and it is written for a developer rather than a reader. */
    expect(shown).not.toContain("did not approve");
  });

  it("clears the error parameters too", async () => {
    await arriveWith("?error=access_denied&error_code=access_denied");
    expect(location.search).not.toContain("error");
  });

  /** An exchange that produces no session is a failure, not a silent success. */
  it("refuses an exchange that succeeds but produces nothing", async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const shown = await arriveWith("?code=abc123");
    expect(navigate).not.toHaveBeenCalled();
    expect(shown).toContain("[auth-nosession]");
  });

  it("survives the SDK throwing rather than returning an error", async () => {
    initialize.mockRejectedValue(new TypeError("fetch failed"));
    const shown = await arriveWith("?code=abc123");
    expect(navigate).not.toHaveBeenCalled();
    expect(shown).toContain("[auth-finish]");
  });
});

describe("arriving with nothing on it", () => {
  /**
   * Somebody bookmarked the callback address, or a link went stale. There is
   * nothing to wait for and nothing to report — send them to the library rather
   * than showing an error about a sign-in they did not attempt.
   */
  it("just sends the reader to the library", async () => {
    await arriveWith("");
    expect(navigate).toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
  });
});

describe("a sign-in that never finishes", () => {
  /**
   * The exchange hangs. Without the deadline this page shows nothing at all,
   * for ever — the same blank-rectangle failure `useSession` has, in a
   * different place.
   */
  it("gives up and says so", async () => {
    initialize.mockReturnValue(new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    history.replaceState(null, "", "/auth/callback?code=abc123");
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(AuthCallback));
    });
    expect(host.textContent).not.toContain("[auth-slow]");
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(host.textContent).toContain("[auth-slow]");
    expect(navigate).not.toHaveBeenCalled();
  });
});
