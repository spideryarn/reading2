/**
 * The sign-in screen.
 *
 * **Hand-built, and that was researched rather than assumed.** Every
 * off-the-shelf option fails on a different axis:
 * `@supabase/auth-ui-react` is unmaintained since February 2024 and its repo was
 * archived in October 2025; Supabase's replacement blocks are Next.js only,
 * built on server actions and cookie SSR; shadcn's `login-01…05` are markup
 * with no auth logic in them at all. See
 * docs/plans/auth-supabase.md § Step 5 for the full survey.
 *
 * So this is a centred form on our own tokens. No shadcn `Card` — overriding
 * its chrome for one screen is more work than not having it, the same call
 * docs/plans/shadcn-migration.md made about `Dialog`.
 *
 * ## Why there is no route in the address bar
 *
 * Not being signed in shows you this wherever you are. Who you are is not view
 * state, and docs/project/url-state.md says view state is what lives in the
 * URL. `/login` exists as a route (router.ts) for password-reset landings and
 * for "send me the login page"; nothing here links to it.
 */
import { useState } from "react";

import { Button } from "./components/ui/button.js";
import { GoogleMark } from "./GoogleMark.js";
import { rememberReturn } from "./auth-return.js";
import { callbackUrl, supabase } from "./lib/supabase.js";

type Mode = "choose" | "email";

export function SignInPage() {
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
    remember();
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
    /* No `setBusy(false)` on success — the page is navigating away, and turning
       the button back on mid-redirect just invites a second click. */
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

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-sm tw:flex-col tw:justify-center tw:px-6 tw:font-sans">
      <h1 className="tw:font-prose tw:text-3xl tw:text-foreground">Spideryarn</h1>
      <p className="tw:mb-8 tw:mt-1 tw:text-sm tw:text-muted-foreground">
        Read deeply, at whatever level of detail you need. Sign in to get to your shelf.
      </p>

      {error && (
        <p
          role="alert"
          className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:px-4 tw:py-2 tw:text-sm tw:text-foreground"
        >
          {error}
        </p>
      )}

      {sent ? (
        <p className="tw:text-sm tw:text-muted-foreground">
          Check <strong className="tw:text-foreground">{email}</strong> for a confirmation link. The
          account will not work until you have clicked it. [auth-confirm]
        </p>
      ) : (
        <>
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
              className="tw:mt-6 tw:text-xs tw:text-ink-faint tw:hover:text-highlight"
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
        </>
      )}
    </main>
  );
}
