/**
 * The buttons and the form — Google, or an email address and a password — with
 * no page around them. `/login` (SignInPage.tsx) is the one page that renders
 * them, since 2026-10-01.
 *
 * **They used to be on the landing page and on `/pricing` as well**, from
 * 2026-08-27, on Greg's reasoning that a landing page whose only control is a
 * link has put a click between somebody and the thing they came for. Greg
 * reversed that himself in report spya-p6s5a4 (2026-09-29): *"let's create a
 * separate sign-in page and signpost to it at the top and bottom"*. Both of
 * those pages now link here with `/login?next=…` (router.ts § `loginHref`), and
 * `returnTo` below is where that destination arrives.
 * docs/plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md.
 *
 * **What the same report asked of the form itself**: *"We're currently
 * emphasising Gmail, but we also allow email and password, and that should be
 * apparent. And we need to somehow make it easy for people to both log in and
 * register."* So the email form is on screen from the start (it was behind an
 * "or use an email address" link), and *Sign in* and *Create account* are the
 * two halves of a switch at the top rather than registration being a small grey
 * button inside the sign-in form. Both halves submit **the same form**, so the
 * browser's `required` and `minLength` hold for an account being created too —
 * the old side button called `signUp` directly and skipped them (GPT Sol, plan
 * review F4).
 *
 * One implementation, and that is the whole point of this file being a file. A
 * second copy of `signInWithOAuth` is a second place for `redirectTo` to be
 * wrong — and the way it goes wrong is not a broken button, it is our one-time
 * authorisation code folded into somebody else's URL. See the comment on
 * `withGoogle` below and main.tsx's callback exemption.
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
import { useEffect, useRef, useState } from "react";

import {
  AUTH_EXCHANGE_FAILED,
  AUTH_PROVIDER_OFF,
  authConfirmationSent,
  authResetSent,
} from "../messages.js";
import { Button } from "./components/ui/button.js";
import { GoogleMark } from "./GoogleMark.js";
import { forgetReturn, rememberReturn } from "./auth-return.js";
import { callbackUrl, googleSignInAvailable, supabase } from "./lib/supabase.js";

/** The two halves of the switch. `/login?new` opens on `create`. */
export type SignInTab = "sign-in" | "create";

/**
 * `forgot` is the email box alone, asking for a password-reset link.
 * docs/plans/261001i-password-reset.md.
 */
type Mode = "form" | "forgot";

const FIELD =
  /* `any-pointer-coarse:text-base` — iOS zooms the page in on a field under
     16px and does not zoom back out. The reading view's fields get that floor
     from narrow-window.css § a field iOS zooms into; the utilities layer
     outranks it, so a `tw:`-styled field says so itself. */
  "tw:w-full tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-3 tw:py-2 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight";

const QUIET = "tw:text-xs tw:text-ink-faint tw:hover:text-highlight";

export function SignInControls({
  initialTab = "sign-in",
  returnTo,
}: {
  initialTab?: SignInTab;
  /**
   * Where a sign-in started here should end up — the page's validated `next`,
   * or `/`. Written through `rememberReturn` only when the reader actually
   * starts one, and forgotten again if it fails before leaving the page.
   * auth-return.ts § `loginNext` says why the URL alone is never obeyed.
   */
  returnTo: string;
}) {
  const [tab, setTab] = useState<SignInTab>(initialTab);
  const [mode, setMode] = useState<Mode>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const mounted = useRef(true);

  /* Google's provider preflight is a network wait. A session can arrive from
     another tab while it is pending, taking this page away; do not let the
     abandoned click resume afterwards and start a second sign-in. Setting true
     in the setup matters under StrictMode's setup-cleanup-setup cycle. */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * The password box, so the email box's Enter can move to it.
   *
   * A ref rather than `document.getElementById("signin-password")`, which is the
   * whole document's namespace for a field this component owns and renders: two
   * of these on one page, or any other form that ever picks the same id, and the
   * key labelled "next" moves the focus into somebody else's box.
   */
  const passwordBox = useRef<HTMLInputElement>(null);

  /** A start that failed before leaving the page must not steer the next one. */
  const failed = (message: string) => {
    forgetReturn();
    setBusy(false);
    setError(message);
  };

  const withGoogle = async () => {
    setBusy(true);
    setError(null);
    /* Before the awaited preflight: a session arriving from another tab can
       make App.tsx leave `/login` during that wait, and LeaveLogin must already
       have the destination to take. Every failure below forgets it. */
    rememberReturn(returnTo);

    /* Ask the project whether Google is on before handing the browser over.
       `signInWithOAuth` navigates rather than requesting, so a provider that is
       switched off shows the reader Supabase's own JSON on Supabase's own
       origin and there is nothing of ours left on screen to say what happened —
       which is exactly what the live site did on 2026-08-27. This fails open;
       see googleSignInAvailable in lib/supabase.ts. The email form is already
       on screen below, which is what the message points at. */
    const available = await googleSignInAvailable();
    if (!mounted.current) return;
    if (!available) {
      setMode("form");
      failed(AUTH_PROVIDER_OFF.message);
      return;
    }

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
      if (err) failed(err.message);
      /* No `setBusy(false)` on success — the page is navigating away, and
         turning the button back on mid-redirect just invites a second click. */
    } catch (thrown) {
      failed(thrown instanceof Error ? thrown.message : AUTH_EXCHANGE_FAILED.message);
    }
  };

  /**
   * Both halves of the switch, through the one form.
   *
   * **Remembered here too, not only on the way out to Google.** A password
   * sign-in finishes on this page: the session arrives, App.tsx's signed-in
   * branch answers `/login` and *takes* the remembered destination. A sign-up
   * whose confirmation link is opened later lands on the callback, which takes
   * it too — **in this tab only**, since `sessionStorage` does not cross tabs
   * and the callback address stays bare (GPT Sol, plan review F2).
   */
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    rememberReturn(returnTo);
    try {
      if (tab === "sign-in") {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) failed(err.message);
        else setBusy(false);
        return;
      }
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl() },
      });
      if (err) {
        failed(err.message);
        return;
      }
      setBusy(false);
      /* Locally `mailer_autoconfirm` is on and the session arrives immediately;
         in production it is off and this is where the reader waits for an
         email. Saying which happened beats a form that appears to do nothing. */
      if (!data.session) setSent(true);
    } catch (thrown) {
      failed(thrown instanceof Error ? thrown.message : AUTH_EXCHANGE_FAILED.message);
    }
  };

  /**
   * Ask for a password-reset link.
   *
   * `redirectTo` is the bare callback, as every other sign-in here: never the
   * current page (the comment on `withGoogle`). No `rememberReturn` — after a
   * new password the reader goes to their shelf, and AuthCallback consumes any
   * stored destination on that path anyway.
   */
  const forgot = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: callbackUrl(),
      });
      setBusy(false);
      if (err) setError(err.message);
      else setResetSent(true);
    } catch (thrown) {
      /* Storage blocked: the SDK writes the PKCE verifier before it asks, and
         throws rather than answering. Same reason as `withGoogle`'s `try`. */
      setBusy(false);
      setError(thrown instanceof Error ? thrown.message : AUTH_EXCHANGE_FAILED.message);
    }
  };

  if (resetSent) {
    return <p className="tw:text-sm tw:text-muted-foreground">{authResetSent(email)}</p>;
  }

  if (sent) {
    return (
      <p className="tw:text-sm tw:text-muted-foreground">{authConfirmationSent(email)}</p>
    );
  }

  const creating = tab === "create";

  return (
    <div className="tw:flex tw:flex-col">
      {/* **The switch.** Two buttons with `aria-pressed` rather than an ARIA tab
          list: there is one panel, and what changes in it is a label, an
          autocomplete hint and one link. Hidden while asking for a reset link,
          which is neither half. */}
      {mode === "form" && (
        <fieldset
          aria-label="Sign in or create an account"
          className="tw:mb-6 tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-1 tw:rounded-full tw:border tw:border-border tw:p-1"
        >
          {(
            [
              ["sign-in", "Sign in"],
              ["create", "Create account"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setError(null);
                setTab(value);
              }}
              disabled={busy}
              className={`tw:rounded-full tw:px-3 tw:py-1.5 tw:text-sm tw:transition-colors ${
                tab === value
                  ? "tw:bg-card tw:font-medium tw:text-foreground"
                  : "tw:text-muted-foreground tw:hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </fieldset>
      )}

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
          words — *Continue with Google* is one of the three Google permits,
          and the one that is true on both halves of the switch. */}
      {mode === "form" && (
        <>
          <button
            type="button"
            onClick={() => void withGoogle()}
            disabled={busy}
            className="tw:flex tw:w-full tw:items-center tw:justify-center tw:gap-3 tw:rounded-full tw:border tw:px-4 tw:py-2.5 tw:text-sm tw:font-medium tw:disabled:opacity-60"
            style={{ background: "#131314", borderColor: "#8E918F", color: "#E3E3E3" }}
          >
            <GoogleMark />
            Continue with Google
          </button>

          <div
            aria-hidden="true"
            className="tw:my-6 tw:flex tw:items-center tw:gap-3 tw:text-xs tw:text-ink-faint"
          >
            <span className="tw:h-px tw:flex-1 tw:bg-border" />
            or with email
            <span className="tw:h-px tw:flex-1 tw:bg-border" />
          </div>
        </>
      )}

      {mode === "forgot" ? (
        <form onSubmit={(e) => void forgot(e)} className="tw:flex tw:flex-col tw:gap-3">
          <label className="tw:text-xs tw:text-muted-foreground" htmlFor="forgot-email">
            Email
          </label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="email"
            /* The only field of a form whose button sends the link. */
            enterKeyHint="go"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
          />
          <div className="tw:mt-1 tw:flex tw:items-center tw:gap-3">
            <Button type="submit" disabled={busy}>
              Send reset link
            </Button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setMode("form");
              }}
              disabled={busy}
              className={QUIET}
            >
              back to sign in
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="tw:flex tw:flex-col tw:gap-3">
          <label className="tw:text-xs tw:text-muted-foreground" htmlFor="signin-email">
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            /* **Next, and it really does move — always.** Enter in a field of a
               form with a submit button submits it, so without this handler the
               key labelled "next" would fire a sign-in the browser then refuses
               for an empty password: a validation bubble where the reader asked
               for the next box.

               **And not only when the password is empty**, which is what it said
               until GPT Sol's review of 2026-09-04. A password manager fills both
               boxes before the reader touches either, so the commonest case was
               the one where a key labelled "next" signed in instead — the label
               would have been a lie exactly where it was read. The key says where
               it goes and it goes there; signing in is the password field's job,
               and the button's. */
            enterKeyHint="next"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              passwordBox.current?.focus();
            }}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={FIELD}
          />
          <label className="tw:text-xs tw:text-muted-foreground" htmlFor="signin-password">
            Password
          </label>
          {/* **Show/Hide rather than a second box to type it again.** One field
              fewer, and the reader can check what they typed — which is the job
              the confirm box did, done in place. */}
          <div className="tw:relative">
            <input
              id="signin-password"
              ref={passwordBox}
              type={showPassword ? "text" : "password"}
              /* `new-password` is what makes a password manager offer to
                 generate one; `current-password` is what makes it fill one. */
              autoComplete={creating ? "new-password" : "current-password"}
              /* The last field of the form: Enter submits it. */
              enterKeyHint="go"
              required
              minLength={8}
              aria-describedby={creating ? "signin-password-hint" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${FIELD} tw:pr-16`}
            />
            <button
              type="button"
              aria-controls="signin-password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
              className={`tw:absolute tw:inset-y-0 tw:right-0 tw:px-3 ${QUIET}`}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          {creating && (
            <p id="signin-password-hint" className="tw:-mt-1 tw:text-xs tw:text-ink-faint">
              At least 8 characters.
            </p>
          )}
          <div className="tw:mt-2 tw:flex tw:items-center tw:gap-3">
            <Button type="submit" disabled={busy}>
              {creating ? "Create account" : "Sign in"}
            </Button>
            {!creating && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode("forgot");
                }}
                disabled={busy}
                className={`tw:ml-auto ${QUIET}`}
              >
                Forgot your password?
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
