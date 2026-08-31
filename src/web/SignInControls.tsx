/**
 * The buttons and the form — Google, or an email address — with no page around
 * them.
 *
 * **Pulled out of SignInPage.tsx on 2026-08-27, when a second page needed
 * them.** Not being signed in now shows you LandingPage.tsx, which is the pitch
 * *and* the way in: Greg's call, and the reason is that a landing page whose
 * only control is a link to another page has put a click between somebody and
 * the thing they came for. `/login` still exists and still renders the compact
 * screen (SignInPage.tsx), because a password-reset email has to land
 * somewhere.
 *
 * Two pages, one implementation, and that is the whole point of this file being
 * a file. A second copy of `signInWithOAuth` is a second place for
 * `redirectTo` to be wrong — and the way it goes wrong is not a broken button,
 * it is our one-time authorisation code folded into somebody else's URL. See
 * the comment on `withGoogle` below and main.tsx's callback exemption.
 *
 * **Hand-built, and that was researched rather than assumed.** Every
 * off-the-shelf option fails on a different axis:
 * `@supabase/auth-ui-react` is unmaintained since February 2024 and its repo was
 * archived in October 2025; Supabase's replacement blocks are Next.js only,
 * built on server actions and cookie SSR; shadcn's `login-01…05` are markup
 * with no auth logic in them at all. See
 * docs/plans/260826w-auth-supabase.md § Step 5 for the full survey.
 *
 * So this is a form on our own tokens. No shadcn `Card` — overriding its chrome
 * for one screen is more work than not having it, the same call
 * docs/plans/260825a-shadcn-migration.md made about `Dialog`.
 */
import { useState } from "react";

import { AUTH_EXCHANGE_FAILED, AUTH_PROVIDER_OFF, authConfirmationSent } from "../messages.js";
import { Button } from "./components/ui/button.js";
import { GoogleMark } from "./GoogleMark.js";
import { rememberReturn } from "./auth-return.js";
import { callbackUrl, googleSignInAvailable, supabase } from "./lib/supabase.js";

type Mode = "choose" | "email";

export function SignInControls() {
  const [mode, setMode] = useState<Mode>("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /** Where we are now, so the callback can put the reader back. See auth-return.ts. */
  const remember = () => rememberReturn(location.pathname + location.search);

  const withGoogle = async () => {
    setBusy(true);
    setError(null);

    /* Ask the project whether Google is on before handing the browser over.
       `signInWithOAuth` navigates rather than requesting, so a provider that is
       switched off shows the reader Supabase's own JSON on Supabase's own
       origin and there is nothing of ours left on screen to say what happened —
       which is exactly what the live site did on 2026-08-27. This fails open;
       see googleSignInAvailable in lib/supabase.ts. */
    if (!(await googleSignInAvailable())) {
      setBusy(false);
      /* The message says "below", so make that true rather than leaving the
         reader to find the link that opens the form. */
      setMode("email");
      setError(AUTH_PROVIDER_OFF.message);
      return;
    }

    remember();
    /* `try`, because this can reject as well as return an error. The SDK writes
       the PKCE verifier to storage and then assigns `location`, and a browser
       with storage blocked throws rather than answering — which without this
       is an unhandled rejection that leaves `busy` true for ever, so the button
       is disabled and the reader has no way to try anything. Sol caught it
       reviewing this file. */
    try {
      const { error: err } = await supabase.auth.signInWithOAuth({
        provider: "google",
        /* Always the bare callback, never the current page. The reason is in
           main.tsx and it is a security one: any spelling that carries the
           destination in the address can carry our `?code=` with it. */
        options: { redirectTo: callbackUrl() },
      });
      if (err) {
        setBusy(false);
        setError(err.message);
      }
      /* No `setBusy(false)` on success — the page is navigating away, and
         turning the button back on mid-redirect just invites a second click. */
    } catch (thrown) {
      setBusy(false);
      setError(thrown instanceof Error ? thrown.message : AUTH_EXCHANGE_FAILED.message);
    }
  };

  const withPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (err) setError(err.message);
  };

  const signUp = async () => {
    setBusy(true);
    setError(null);
    remember();
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: callbackUrl() },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    /* Locally `mailer_autoconfirm` is on and the session arrives immediately;
       in production it is off and this is where the reader waits for an email.
       Saying which happened beats a form that appears to do nothing. */
    if (!data.session) setSent(true);
  };

  if (sent) {
    return (
      <p className="tw:text-sm tw:text-muted-foreground">{authConfirmationSent(email)}</p>
    );
  }

  return (
    <div className="tw:flex tw:flex-col">
      {error && (
        <p
          role="alert"
          className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:px-4 tw:py-2 tw:text-sm tw:text-foreground"
        >
          {error}
        </p>
      )}

      {/* Google's own dark-theme palette, which is specified rather than
          chosen: #131314 fill, #8E918F stroke, #E3E3E3 text, and the exact
          words. All three are conditions of using the API. */}
      <button
        type="button"
        onClick={() => void withGoogle()}
        disabled={busy}
        className="tw:flex tw:w-full tw:items-center tw:justify-center tw:gap-3 tw:rounded-full tw:border tw:px-4 tw:py-2.5 tw:text-sm tw:font-medium tw:disabled:opacity-60"
        style={{ background: "#131314", borderColor: "#8E918F", color: "#E3E3E3" }}
      >
        <GoogleMark />
        Sign in with Google
      </button>

      {mode === "choose" ? (
        <button
          type="button"
          onClick={() => setMode("email")}
          className="tw:mt-6 tw:self-start tw:text-xs tw:text-ink-faint tw:hover:text-highlight"
        >
          or use an email address
        </button>
      ) : (
        <form onSubmit={(e) => void withPassword(e)} className="tw:mt-6 tw:flex tw:flex-col tw:gap-3">
          <label className="tw:text-xs tw:text-muted-foreground" htmlFor="signin-email">
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-3 tw:py-2 tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-highlight"
          />
          <label className="tw:text-xs tw:text-muted-foreground" htmlFor="signin-password">
            Password
          </label>
          <input
            id="signin-password"
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-3 tw:py-2 tw:text-sm tw:text-foreground tw:outline-none tw:focus:border-highlight"
          />
          <div className="tw:mt-1 tw:flex tw:items-center tw:gap-3">
            <Button type="submit" disabled={busy}>
              Sign in
            </Button>
            <button
              type="button"
              onClick={() => void signUp()}
              disabled={busy}
              className="tw:text-xs tw:text-ink-faint tw:hover:text-highlight"
            >
              create an account
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
