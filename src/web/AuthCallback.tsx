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
 *  4. goes where the reader was going, or says why not — or, when the link was
 *     a password recovery, stays and asks for a new password (SetNewPassword,
 *     docs/plans/261001i-password-reset.md).
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

import {
  AUTH_DENIED,
  AUTH_EXCHANGE_FAILED,
  AUTH_KIND_UNKNOWN,
  authProviderRefused,
} from "../messages.js";

import { takeReturn } from "./auth-return.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { CALLBACK_HREF, LIBRARY_HREF, navigate } from "./router.js";
import { SetNewPassword } from "./SetNewPassword.js";
import {
  arrivedWithCode,
  forgetCodeArrival,
  supabase,
  urlSessionKind,
} from "./lib/supabase.js";

/** Everything either end of the OAuth exchange leaves behind. */
const AUTH_PARAMS = [
  "code",
  "state",
  "error",
  "error_code",
  "error_description",
  /* The SDK's own, and it is not obvious from the outside. A failed exchange
     leaves it on the URL, so a list without it does not do what this list says
     it does. GPT Sol, 2026-08-27. */
  "sb_flow_id",
];

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
  if (code === "access_denied") return AUTH_DENIED.message;
  /* Deliberately not `error_description`, which is the provider's text — see
     docs/project/copy.md: never repeat what the provider said. The code is
     short, ours to show, and quotable in a bug report.

     **And provider-neutral.** Both of these named Google until 2026-08-27, and
     `signUp` sends its confirmation link to this same callback — so an expired
     email confirmation told the reader Google had refused something Google was
     never asked. GPT Sol found it. src/messages.ts holds both sentences now. */
  return authProviderRefused(code).message;
}

const AUTH_SLOW = "Signing in is taking longer than it should. Try again. [auth-slow]";

export function AuthCallback() {
  const [error, setError] = useState<string | null>(null);
  /* A password-recovery link: show SetNewPassword instead of moving on. */
  const [recovery, setRecovery] = useState(false);
  /* The error is `[auth-kind]`: the reader is signed in, so the way out is
     their shelf rather than "the sign-in screen". */
  const [signedIn, setSignedIn] = useState(false);

  useDocumentTitle(pageTitle(recovery ? { kind: "new-password" } : { kind: "callback" }));

  useEffect(() => {
    /* Captured before anything strips it. `location.search` is read once, here,
       and never again — by the time the effect below finishes the address bar
       may have been rewritten underneath us by the SDK. */
    const params = new URLSearchParams(location.search);
    const said = describe(params);
    /* Or it had one when the page loaded, and the SDK's exchange — started at
       module load — has already succeeded and stripped it. arrivedWithCode in
       lib/supabase.ts says why that happens and when it was seen. */
    const hasCode = params.has("code") || arrivedWithCode();

    let live = true;

    const clearParams = () => {
      const url = new URL(location.href);
      for (const key of AUTH_PARAMS) url.searchParams.delete(key);
      history.replaceState(history.state, "", `${url.pathname}${url.search}`);
      /* The module outlives this route in the hand-rolled SPA. Do not let a
         later in-app visit to the bare callback inherit this page load's code. */
      forgetCodeArrival();
    };

    const leave = () => {
      const back = takeReturn(CALLBACK_HREF);
      navigate(back ?? LIBRARY_HREF, { replace: true });
    };

    let timer: ReturnType<typeof setTimeout> | null = null;
    const stopDeadline = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    /**
     * **The one way this page fails**, and the only caller of `setError`.
     *
     * Every failure **consumes the stored destination even though we are not
     * going there**: auth-return.ts promises a failed sign-in does not survive to
     * redirect the next one. Until 2026-10-01 each failure path did that itself,
     * and three of them — `[auth-slow]`, `[auth-nosession]`, `[auth-finish]` —
     * did not; GPT Sol found it reviewing 261001i's plan, and Greg approved the
     * fix. One exit means a fourth failure cannot forget it.
     * tests/auth-callback.test.ts pins that `setError` is called only here.
     */
    const fail = (message: string, options: { signedIn?: boolean } = {}) => {
      stopDeadline();
      clearParams();
      takeReturn(CALLBACK_HREF);
      if (options.signedIn) setSignedIn(true);
      setError(message);
    };

    if (said || !hasCode) {
      /* Google said no, or somebody arrived at this address with nothing on it.
         Either way there is nothing to wait for. */
      if (said) fail(said);
      else {
        clearParams();
        leave();
      }
      return;
    }

    /* There is a code, and the SDK is already exchanging it. Ask it what
       happened, with a deadline — `getSession()` resolves once initialisation
       has settled, whichever way it settled. */
    const DEADLINE = Symbol("auth callback deadline");
    const deadline = new Promise<typeof DEADLINE>((resolve) => {
      timer = setTimeout(() => resolve(DEADLINE), DEADLINE_MS);
    });

    /* **`initialize()`, not `getSession()`** — and the difference is a wrong
       answer rather than a slow one.
     *
       `getSession()` returns whatever session exists. Supabase **keeps an
       existing session when a new callback exchange fails** — deliberately, so
       that a reused magic link does not log you out of a perfectly good
       session. So a reader who was already signed in, arriving here with a
       stale or wrong code, would have been redirected as though the sign-in
       they just attempted had worked. Which matters most for the case where
       they were trying to switch account.
     *
       `initialize()` is public, and its own docs say it returns "any error
       encountered while detecting it from the URL" — i.e. the verdict on *this*
       attempt rather than on the state of the world. GPT Sol, 2026-08-27. */
    void (async () => {
      const initialized = await Promise.race([supabase.auth.initialize(), deadline]);
      if (!live) return;
      if (initialized === DEADLINE) {
        fail(AUTH_SLOW);
        return;
      }
      if (initialized.error) {
        /* The commonest real cause is a PKCE verifier that is not in this
           browser — the reader started the sign-in somewhere else, or cleared
           their storage in between. */
        fail(AUTH_EXCHANGE_FAILED.message);
        return;
      }
      clearParams();

      /* `getSession()` can itself refresh a near-expiry token. Keep it inside
         the same deadline rather than opening an unbounded gap between the
         exchange verdict and recovery classification. */
      const got = await Promise.race([supabase.auth.getSession(), deadline]);
      if (!live) return;
      if (got === DEADLINE) {
        fail(AUTH_SLOW);
        return;
      }
      if (!got.data.session) {
        fail("That sign-in did not produce a session. Try again. [auth-nosession]");
        return;
      }

      /* **This attempt worked; was it a password recovery?** Only after the
         verdict above, so nothing here can turn a failed exchange into a form.
         The SDK says so by an event that can arrive *after* `initialize()` has
         resolved, which lib/supabase.ts catches at module scope — asked about
         this auth session, because another tab's sign-in is heard too. */
      const kind = await Promise.race([
        urlSessionKind(got.data.session.access_token),
        deadline,
      ]);
      if (!live) return;
      stopDeadline();
      if (kind === "sign-in") {
        leave();
        return;
      }
      if (kind === "recovery") {
        /* Consumed and ignored: after a new password the reader goes to their
           shelf. Left here, it would redirect the next sign-in — the hole
           auth-return.ts was reviewed for. */
        takeReturn(CALLBACK_HREF);
        setRecovery(true);
      } else {
        /* The SDK promises the event, so its absence is not evidence of an
           ordinary sign-in, and guessing would break the email's promise.
           GPT Sol, plan review, finding 2. */
        fail(AUTH_KIND_UNKNOWN.message, { signedIn: true });
      }
    })()
      .catch(() => {
        if (!live) return;
        fail("Something went wrong finishing your sign-in. Try again. [auth-finish]");
      });

    return () => {
      live = false;
      stopDeadline();
    };
  }, []);

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-sm tw:flex-col tw:justify-center tw:px-6 tw:font-sans">
      {recovery ? (
        <SetNewPassword />
      ) : error ? (
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
            {signedIn ? "go to your shelf" : "back to the sign-in screen"}
          </button>
        </>
      ) : (
        <p className="tw:text-sm tw:text-muted-foreground">Signing you in…</p>
      )}
    </main>
  );
}
