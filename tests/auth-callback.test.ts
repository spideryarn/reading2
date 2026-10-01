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
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const initialize = vi.fn();
const getSession = vi.fn();
const navigate = vi.fn();
const takeReturn = vi.fn();
/* What the SDK said the URL's session was. docs/plans/261001i-password-reset.md. */
const urlSessionKind = vi.fn();
/* Whether the page *loaded* with a code on it, as lib/supabase.ts read it before
   the SDK could strip it. */
const arrival = { withCode: false };
const forgetCodeArrival = vi.fn(() => {
  arrival.withCode = false;
});

vi.mock("../src/web/lib/supabase.js", () => ({
  /* `onAuthStateChange` is not this file's subject: `src/web/lib/api.ts` calls
     it at module load, and this test reaches that module transitively through
     `ShelfEntry` → `TitleEditor`. Without it the file throws on import and all
     tests below stop running — vitest does report that, but as
     "1 failed | no tests", which reads like an empty file rather than a
     silenced one. */
  supabase: {
    auth: {
      initialize,
      getSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  urlSessionKind,
  arrivedWithCode: () => arrival.withCode,
  forgetCodeArrival,
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
async function arriveWith(search: string, strict = false): Promise<string> {
  history.replaceState(null, "", `/auth/callback${search}`);
  const host = document.createElement("div");
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    const callback = createElement(AuthCallback);
    root.render(strict ? createElement(StrictMode, null, callback) : callback);
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
  urlSessionKind.mockReset();
  urlSessionKind.mockResolvedValue("sign-in");
  forgetCodeArrival.mockClear();
  arrival.withCode = false;
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
    /* Even a remembered page-load code cannot outrank explicit error params. */
    arrival.withCode = true;
    const shown = await arriveWith(
      "?error=access_denied&error_code=access_denied&error_description=The+user+did+not+approve",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
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

  /**
   * **The code was there; the SDK took it before this mounted.** The exchange
   * starts at module load and strips `?code=` when it succeeds, and in dev —
   * Vite serving modules one by one — that can finish before React mounts this.
   * Seen in the browser on 2026-10-01: 3 of about 12 recovery links went
   * `/auth/callback?code=… → /auth/callback → /login → /`, with no form, because
   * this page read an empty address and moved on. The page load's own address,
   * read before `createClient`, is what decides whether there is a verdict to
   * wait for.
   */
  it("still waits for the verdict when the SDK stripped the code first", async () => {
    arrival.withCode = true;
    urlSessionKind.mockResolvedValue("recovery");
    /* main.tsx mounts the app in StrictMode in development. */
    await arriveWith("", true);
    expect(initialize).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
  });

  it("does not reuse that page-load arrival on a later in-app callback navigation", async () => {
    arrival.withCode = true;
    urlSessionKind.mockResolvedValue("recovery");
    await arriveWith("");
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);

    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    navigate.mockClear();
    initialize.mockClear();

    await arriveWith("");
    expect(initialize).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalled();
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

  it("keeps the same deadline while reading the resulting session", async () => {
    getSession.mockReturnValue(new Promise(() => {}));
    const host = document.createElement("div");
    document.body.appendChild(host);
    history.replaceState(null, "", "/auth/callback?code=abc123");
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(AuthCallback));
    });
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(host.textContent).toContain("[auth-slow]");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("a password-recovery link", () => {
  /**
   * The recovery exchange signs the reader in, exactly like any other link. What
   * tells it apart is the SDK's PASSWORD_RECOVERY event, which lib/supabase.ts
   * catches at module scope. docs/plans/261001i-password-reset.md.
   */
  it("asks for a new password instead of sending the reader on", async () => {
    urlSessionKind.mockResolvedValue("recovery");
    await arriveWith("?code=abc123");
    expect(navigate).not.toHaveBeenCalled();
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(2);
    expect(location.search).not.toContain("code=");
  });

  it("consumes the stored destination on the recovery path too", async () => {
    urlSessionKind.mockResolvedValue("recovery");
    await arriveWith("?code=abc123");
    expect(takeReturn).toHaveBeenCalled();
  });

  /** A failed exchange is a failure, whatever event anyone heard. */
  it("still reports a failed exchange", async () => {
    urlSessionKind.mockResolvedValue("recovery");
    initialize.mockResolvedValue({ error: new Error("code verifier missing") });
    const shown = await arriveWith("?code=abc123");
    expect(shown).toContain("[auth-exchange]");
    expect(document.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(getSession).not.toHaveBeenCalled();
    expect(urlSessionKind).not.toHaveBeenCalled();
  });

  /** About this session, not the first event anybody heard (another tab's). */
  it("asks about the session the exchange produced", async () => {
    getSession.mockResolvedValue({ data: { session: { access_token: "this-one" } } });
    await arriveWith("?code=abc123");
    expect(urlSessionKind).toHaveBeenCalledWith("this-one");
  });

  /**
   * The event never comes. The SDK promises one, so its absence is not evidence
   * of an ordinary sign-in — and silently moving on would break the email's
   * promise of a new password. Say so, and offer the shelf the reader already
   * has. GPT Sol, plan review, finding 2.
   */
  it("says it could not tell, rather than guessing, once the deadline passes", async () => {
    urlSessionKind.mockReturnValue(new Promise(() => {}));
    await arriveWith("?code=abc123");
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("[auth-kind]");
    expect(document.body.textContent).not.toContain("[auth-slow]");
    expect(takeReturn).toHaveBeenCalled();
  });

  /** One ten-second budget from arrival, not a fresh one once the exchange is done. */
  it("does not restart the deadline after a slow exchange", async () => {
    initialize.mockReturnValue(
      new Promise((resolve) => setTimeout(() => resolve({ error: null }), 9_000)),
    );
    urlSessionKind.mockReturnValue(new Promise(() => {}));
    await arriveWith("?code=abc123");
    await act(async () => {
      vi.advanceTimersByTime(9_100);
    });
    expect(document.body.textContent).not.toContain("[auth-kind]");
    await act(async () => {
      vi.advanceTimersByTime(1_500);
    });
    expect(document.body.textContent).toContain("[auth-kind]");
  });
});
