/**
 * Who is signed in, as React state.
 *
 * One subscription to `onAuthStateChange`, and `loading` until the SDK has told
 * us something. There is no third state: between page load and the first
 * `INITIAL_SESSION` the answer is genuinely unknown, and rendering the sign-in
 * screen during that moment makes a signed-in reader see a login flash on every
 * single reload.
 *
 * ## Two things about the callback that are easy to get wrong
 *
 * **`SIGNED_IN` is not "the user just logged in".** Supabase's own docs say it
 * *"can fire very frequently"* — it is re-emitted when a tab regains focus. Any
 * code that treats it as an event rather than as a statement of current state
 * will run on every alt-tab.
 *
 * **Do no refresh-triggering work inside the callback.** Not the blanket "never
 * await in there" that most write-ups give; reading the session out and calling
 * `setState` is exactly what the callback is for. What must not happen inside
 * it is anything that could itself cause a token refresh.
 *
 * ## What this hook deliberately cannot tell you
 *
 * **Whether a sign-in attempt failed.** `_initialize()` in the installed SDK
 * (`@supabase/auth-js/dist/module/GoTrueClient.js:376`) calls
 * `_getSessionFromURL`, and on an error it `_debug`-logs and returns the error
 * to its caller — notifying no subscriber. Listeners get `INITIAL_SESSION,
 * null`, which is indistinguishable from "nobody is signed in".
 *
 * So a failed code exchange is invisible here, by construction, and
 * AuthCallback.tsx reads `location.search` itself rather than waiting for an
 * event that never arrives. Found by GPT Sol; confirmed by reading the SDK.
 * docs/plans/260826ae-auth-ui-and-production.md.
 */
import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "./lib/supabase.js";

export interface SessionState {
  session: Session | null;
  user: User | null;
  /** True until the SDK has said anything at all. Not "no user". */
  loading: boolean;
}

/**
 * How long to stay in `loading` before giving up and showing the sign-in screen.
 *
 * **The whole app renders `null` while loading** (App.tsx), which is the right
 * call for the one frame it normally takes and a catastrophe if it never ends:
 * a stuck PKCE or refresh request leaves a permanently blank page, with no
 * error, nothing to click, and nothing in the console. `pageshow` does not
 * rescue it either, because `getSession()` waits on the same unresolved
 * initialisation.
 *
 * Supabase does emit `INITIAL_SESSION` even after an initialisation *error*, so
 * this only fires when initialisation **hangs** rather than fails. That is rare
 * and it is exactly the case with no other way out. GPT Sol, 2026-08-27.
 *
 * Eight seconds: past any plausible round trip, short of the point where a
 * reader concludes the site is broken and leaves.
 */
const SETTLE_MS = 8_000;

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    session: null,
    user: null,
    loading: true,
  });

  useEffect(() => {
    /* `onAuthStateChange` fires INITIAL_SESSION by itself once the client has
       finished initialising, so there is no separate `getSession()` call here
       to race with it. One source of truth. */
    /* Armed before subscribing, cleared by the first event. If initialisation
       never settles, this is the only thing that ends `loading` — and ending it
       as "signed out" is right: the reader gets a sign-in screen they can act
       on rather than a blank page they cannot. */
    const settle = setTimeout(() => {
      setState((current) => (current.loading ? { ...current, loading: false } : current));
    }, SETTLE_MS);

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      clearTimeout(settle);
      setState({ session, user: session?.user ?? null, loading: false });
    });

    /* A page restored from the bfcache comes back with whatever it had when it
       left, which may be an access token that expired while it was away. The
       SDK's refresh timer does not run in a frozen page. `getSession()`
       refreshes if it needs to, and the auth event that follows updates us. */
    const resync = () => {
      void supabase.auth.getSession();
    };
    window.addEventListener("pageshow", resync);

    return () => {
      clearTimeout(settle);
      data.subscription.unsubscribe();
      window.removeEventListener("pageshow", resync);
    };
  }, []);

  return state;
}
