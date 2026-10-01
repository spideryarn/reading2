/**
 * `watchUrlSessionKinds` — **was the session this page load got from its URL a
 * password recovery, or a sign-in?**
 *
 * The SDK knows and says so only through the event it emits:
 * `PASSWORD_RECOVERY` instead of `SIGNED_IN`. It emits that late — queued until
 * initialisation settles, and again from a `setTimeout(0)` after `initialize()`
 * has resolved (`@supabase/auth-js` 2.112.4, `GoTrueClient.js:337`, `:414-421`,
 * `:1640`) — so the only listener certain to hear it is one registered beside
 * `createClient`. docs/plans/261001i-password-reset.md.
 *
 * **Asked about one session, by its access token, not "the first event".** GPT
 * Sol's plan review, finding 1: another tab's sign-in arrives over the SDK's
 * BroadcastChannel immediately, bypassing that queue, so "the first event"
 * could be somebody else's session.
 */
import { describe, expect, it } from "vitest";

import { watchUrlSessionKinds } from "../src/web/lib/url-session-kind.js";

type Listener = (event: string, session: { access_token: string } | null) => void;

/** An `auth` with nothing but the one method the watcher uses. */
function fakeAuth() {
  let listener: Listener | null = null;
  return {
    auth: {
      onAuthStateChange(fn: Listener) {
        listener = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    emit(event: string, token: string | null) {
      listener?.(event, token === null ? null : { access_token: token });
    },
  };
}

/** A JWT-shaped token; only the stable `session_id` claim matters to this unit. */
function token(sessionId: string, nonce: string): string {
  const payload = btoa(JSON.stringify({ session_id: sessionId, nonce }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `header.${payload}.signature`;
}

/** Whether a promise has settled yet, without waiting for it. */
async function settled<T>(p: Promise<T>): Promise<{ value: T } | null> {
  const pending = Symbol("pending");
  const v = await Promise.race([p, Promise.resolve(pending)]);
  return v === pending ? null : { value: v as T };
}

describe("watchUrlSessionKinds", () => {
  it("answers recovery for a PASSWORD_RECOVERY on that session", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    f.emit("INITIAL_SESSION", null);
    f.emit("PASSWORD_RECOVERY", "ours");
    expect(await kindOf("ours")).toBe("recovery");
  });

  it("answers sign-in for a SIGNED_IN on that session", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    f.emit("SIGNED_IN", "ours");
    expect(await kindOf("ours")).toBe("sign-in");
  });

  /** Asked before the event arrives — the order AuthCallback usually sees. */
  it("waits for the event when asked first", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    const kind = kindOf("ours");
    expect(await settled(kind)).toBeNull();
    f.emit("PASSWORD_RECOVERY", "ours");
    expect(await kind).toBe("recovery");
  });

  it("ignores the events that are not about a URL session", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    f.emit("INITIAL_SESSION", "ours");
    f.emit("TOKEN_REFRESHED", "ours");
    f.emit("USER_UPDATED", "ours");
    expect(await settled(kindOf("ours"))).toBeNull();
  });

  /** Another tab signed in first. Its event is about its session, not ours. */
  it("is not answered by another session's sign-in, either way round", async () => {
    const a = fakeAuth();
    const kindA = watchUrlSessionKinds(a.auth);
    a.emit("SIGNED_IN", "another-tab");
    a.emit("PASSWORD_RECOVERY", "ours");
    expect(await kindA("ours")).toBe("recovery");

    const b = fakeAuth();
    const kindB = watchUrlSessionKinds(b.auth);
    const asked = kindB("ours");
    b.emit("PASSWORD_RECOVERY", "ours");
    b.emit("SIGNED_IN", "another-tab");
    expect(await asked).toBe("recovery");
    expect(await settled(kindB("a-third"))).toBeNull();
  });

  /**
   * A sibling tab can load the just-written session from shared storage and
   * broadcast SIGNED_IN before this tab flushes its queued PASSWORD_RECOVERY.
   * Both events then carry the same token; recovery is the more specific fact.
   */
  it("lets recovery supersede an early sign-in for the same session", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    const kind = kindOf("ours");
    f.emit("SIGNED_IN", "ours");
    f.emit("PASSWORD_RECOVERY", "ours");
    expect(await kind).toBe("recovery");
  });

  /** The SDK sends the URL event twice; later broad sign-ins cannot erase recovery. */
  it("keeps the recovery answer for a session", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    f.emit("PASSWORD_RECOVERY", "ours");
    f.emit("PASSWORD_RECOVERY", "ours");
    f.emit("SIGNED_IN", "ours");
    expect(await kindOf("ours")).toBe("recovery");
  });

  /**
   * `getSession()` refreshes inside the SDK when a token is within its expiry
   * margin. The event still carries the pre-refresh token, but both JWTs name
   * the same auth session.
   */
  it("keeps the answer across an access-token refresh", async () => {
    const f = fakeAuth();
    const kindOf = watchUrlSessionKinds(f.auth);
    const before = token("the-session", "before");
    const after = token("the-session", "after");
    f.emit("PASSWORD_RECOVERY", before);
    expect(await settled(kindOf(after))).toEqual({ value: "recovery" });
  });
});
