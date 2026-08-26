/**
 * Where Google sends the reader back.
 *
 * ## Why this page reads the URL itself
 *
 * The obvious version of this component waits for `onAuthStateChange` and
 * navigates when a session appears. It works when sign-in works, and it hangs
 * for ever when it does not — which is the version this repo nearly shipped.
 *
 * `_initialize()` in the installed SDK
 * (`@supabase/auth-js/dist/module/GoTrueClient.js:376`) calls
 * `_getSessionFromURL`, and when the exchange fails it `_debug`-logs and
 * `return { error }` to its own caller. **It notifies no subscriber.**
 * Listeners get `INITIAL_SESSION, null`, which is exactly what they get when
 * nobody is signed in. And the failed parameters stay in the address bar,
 * because only a *successful* exchange strips `code`.
 *
 * So a broken sign-in looks like this: `/auth/callback?code=…` on screen, for
 * ever, with no message. Found by GPT Sol, 2026-08-26, and confirmed by reading
 * the SDK rather than by reasoning about it.
 *
 * This component therefore:
 *
 *  1. reads `location.search` itself, before anything is stripped;
 *  2. waits for the SDK to finish, with a deadline rather than for ever;
 *  3. clears **every** auth parameter, whichever way it went;
 *  4. goes where the reader was going, or says why not.
 *
 * ## The one thing it must not do
 *
 * Exchange the code itself. `detectSessionInUrl` is on (lib/supabase.ts), the
 * client is created at module scope, and the exchange has already started
 * before this component mounts. A second exchange of a one-time code fails by
 * definition — and would fail *after* the first one succeeded, turning a good
 * sign-in into an error message.
 */
import { useEffect, useState } from "react";

import { takeReturn } from "./auth-return.js";
import { CALLBACK_HREF, LIBRARY_HREF, navigate } from "./router.js";
import { supabase } from "./lib/supabase.js";

/** Everything either end of the OAuth exchange leaves behind. */
const AUTH_PARAMS = ["code", "state", "error", "error_code", "error_description"];

/**
 * How long to wait for the SDK to settle before calling it a failure.
 *
 * The exchange is one network round trip to Supabase. Ten seconds is long
 * enough for a bad connection and short enough that a reader does not assume
 * the page is dead — and, crucially, it is *a bound*. Waiting for an event that
 * the SDK has already decided not to send is how this page hangs.
 */
const DEADLINE_MS = 10_000;

/** The reader's own words for what went wrong, without quoting the provider at length. */
function describe(params: URLSearchParams): string | null {
  const code = params.get("error_code") ?? params.get("error");
  if (!code) return null;
  if (code === "access_denied") {
    return "You cancelled, or Google declined the sign-in. Nothing has changed. [auth-denied]";
  }
  /* Deliberately not `error_description`, which is the provider's text — see
     docs/project/copy.md: never repeat what the provider said. The code is
     short, ours to show, and quotable in a bug report. */
  return `Google refused the sign-in (${code}). Try again, or use an email address. [auth-oauth]`;
}

export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* Captured before anything strips it. `location.search` is read once, here,
       and never again — by the time the effect below finishes the address bar
       may have been rewritten underneath us by the SDK. */
    const params = new URLSearchParams(location.search);
    const said = describe(params);
    const hasCode = params.has("code");

    let live = true;

    const clearParams = () => {
      const url = new URL(location.href);
      for (const key of AUTH_PARAMS) url.searchParams.delete(key);
      history.replaceState(history.state, "", `${url.pathname}${url.search}`);
    };

    const leave = () => {
      const back = takeReturn(CALLBACK_HREF);
      navigate(back ?? LIBRARY_HREF, { replace: true });
    };

    if (said || !hasCode) {
      /* Google said no, or somebody arrived at this address with nothing on it.
         Either way there is nothing to wait for. */
      clearParams();
      if (said) setError(said);
      else leave();
      return;
    }

    /* There is a code, and the SDK is already exchanging it. Ask it what
       happened, with a deadline — `getSession()` resolves once initialisation
       has settled, whichever way it settled. */
    const timer = setTimeout(() => {
      if (!live) return;
      clearParams();
      setError("Signing in is taking longer than it should. Try again. [auth-slow]");
    }, DEADLINE_MS);

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!live) return;
        clearTimeout(timer);
        clearParams();
        if (data.session) leave();
        else {
          /* The exchange failed and told nobody. The commonest real cause is a
             PKCE verifier that is not in this browser — the reader started the
             sign-in somewhere else, or cleared their storage in between. */
          setError(
            "That sign-in could not be completed. If you started it in another browser or " +
              "window, start again in this one. [auth-exchange]",
          );
        }
      })
      .catch(() => {
        if (!live) return;
        clearTimeout(timer);
        clearParams();
        setError("Something went wrong finishing your sign-in. Try again. [auth-finish]");
      });

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-sm tw:flex-col tw:justify-center tw:px-6 tw:font-sans">
      {error ? (
        <>
          <p
            role="alert"
            className="tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:px-4 tw:py-2 tw:text-sm tw:text-foreground"
          >
            {error}
          </p>
          <button
            type="button"
            onClick={() => navigate(LIBRARY_HREF, { replace: true })}
            className="tw:mt-4 tw:text-xs tw:text-ink-faint tw:hover:text-highlight"
          >
            back to the sign-in screen
          </button>
        </>
      ) : (
        <p className="tw:text-sm tw:text-muted-foreground">Signing you in…</p>
      )}
    </main>
  );
}
