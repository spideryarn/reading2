/**
 * Was the session this page load got from its URL a password recovery, or an
 * ordinary sign-in?
 *
 * **The SDK knows, and says so only through an event.** A recovery link and a
 * sign-in link both land on `/auth/callback?code=…` and both exchange into a
 * session. The SDK remembers which kind of request it started (the PKCE
 * verifier is stored with a recovery marker) and, once the exchange succeeds,
 * emits `PASSWORD_RECOVERY` instead of `SIGNED_IN`. It does not put that on
 * `initialize()`'s answer.
 *
 * **And it emits it late.** In `@supabase/auth-js` 2.112.4 the event is queued
 * until initialisation settles (`GoTrueClient.js:337`, `:1640`) and sent again
 * from a `setTimeout(0)` after `_initialize` returns (`:414-421`), and the
 * exchange started at module load — so it may arrive before AuthCallback mounts,
 * or after `initialize()` has resolved for it. The one listener certain to hear
 * it is registered beside `createClient`. lib/supabase.ts does that.
 *
 * **Asked about one session, by the stable `session_id` in its access token.**
 * Not "the first event": a
 * sign-in in another tab reaches this one over the SDK's BroadcastChannel
 * straight away, bypassing that queue (`:260`, `:4327`), so the first event
 * heard can be about somebody else's session. GPT Sol, plan review, finding 1.
 * Recovery wins over sign-in for a given session; the SDK sends the URL event
 * twice, and a sibling tab can broadcast a less-specific SIGNED_IN first.
 *
 * docs/plans/261001i-password-reset.md.
 */

export type UrlSessionKind = "recovery" | "sign-in";

/** The one method this needs, so a test can hand it a fake. */
interface AuthEvents {
  onAuthStateChange(listener: (event: string, session: { access_token: string } | null) => void): unknown;
}

/**
 * The auth session's stable identity, carried by every access token minted for
 * it. `getSession()` may refresh a near-expiry token before returning it, while
 * the URL event necessarily carries the token produced by the exchange.
 *
 * This is correlation, not authentication: the server still verifies the JWT
 * wherever identity matters. An unreadable token simply loses the refresh
 * alias and remains addressable by its exact value.
 */
function sessionId(accessToken: string): string | null {
  try {
    const part = accessToken.split(".")[1];
    if (!part) return null;
    const padded = part
      .replaceAll("-", "+")
      .replaceAll("_", "/")
      .padEnd(Math.ceil(part.length / 4) * 4, "=");
    const value: unknown = JSON.parse(atob(padded));
    const id = (value as { session_id?: unknown } | null)?.session_id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

function keysFor(accessToken: string): string[] {
  const id = sessionId(accessToken);
  return [id === null ? `token:${accessToken}` : `session:${id}`];
}

function knownFor(heard: Map<string, UrlSessionKind>, keys: string[]): UrlSessionKind | undefined {
  const values = keys.map((key) => heard.get(key));
  if (values.includes("recovery")) return "recovery";
  return values.includes("sign-in") ? "sign-in" : undefined;
}

/** Returns `kindOf(accessToken)`, which resolves once that auth session's event has been heard. */
export function watchUrlSessionKinds(
  auth: AuthEvents,
): (accessToken: string) => Promise<UrlSessionKind> {
  const heard = new Map<string, UrlSessionKind>();
  const waiting = new Map<string, ((kind: UrlSessionKind) => void)[]>();

  auth.onAuthStateChange((event, session) => {
    const kind: UrlSessionKind | null =
      event === "PASSWORD_RECOVERY" ? "recovery" : event === "SIGNED_IN" ? "sign-in" : null;
    const token = session?.access_token;
    if (!kind || !token) return;
    const keys = keysFor(token);
    const known = knownFor(heard, keys);
    /* PASSWORD_RECOVERY is the SDK's specific verdict. A sibling tab can read
       the newly saved session and broadcast SIGNED_IN before this tab flushes
       its queued recovery event, with the same token. Never let that broader
       event overwrite — or prematurely resolve — the specific one. */
    if (known === "recovery" || (known === "sign-in" && kind === "sign-in")) return;
    for (const key of keys) heard.set(key, kind);
    const resolves = new Set(keys.flatMap((key) => waiting.get(key) ?? []));
    const answer = () => {
      const latest = knownFor(heard, keys);
      if (latest) for (const resolve of resolves) resolve(latest);
    };
    /* A recovery verdict resolves immediately. SIGNED_IN waits one task: the
       local recovery event is queued until initialization settles, and must get
       the chance to supersede a same-session broadcast from another tab. */
    if (kind === "recovery") answer();
    else setTimeout(answer, 0);
    for (const key of keys) {
      waiting.delete(key);
    }
  });

  return (accessToken) =>
    new Promise((resolve) => {
      const keys = keysFor(accessToken);
      const known = knownFor(heard, keys);
      if (known) {
        if (known === "recovery") resolve(known);
        else
          setTimeout(() => {
            resolve(knownFor(heard, keys) ?? known);
          }, 0);
        return;
      }
      for (const key of keys) waiting.set(key, [...(waiting.get(key) ?? []), resolve]);
    });
}
