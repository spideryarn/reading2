/**
 * Choose a new password — what a password-recovery link lands on.
 *
 * **Rendered by AuthCallback, and only by it**, in the state that only a
 * recovery exchange reaches (`urlSessionKind()` said `"recovery"`). Not a route
 * of its own: a route would need a gate decision, an entry in the router, and a
 * way to tell a recovery session from an ordinary one that survives a reload.
 * The cost of not having one is that reloading this page drops the reader on
 * their shelf, signed in, without the prompt. docs/plans/261001i-password-reset.md
 * § What we are not doing.
 *
 * **The reader is already signed in when this renders.** That is how Supabase
 * recovery works — the link is a sign-in — and it is why "not now" is honest:
 * it goes to the shelf they already have.
 */
import { useRef, useState } from "react";

import { AUTH_PASSWORD_MISMATCH, AUTH_PASSWORD_SET_FAILED } from "../messages.js";
import { Button } from "./components/ui/button.js";
import { supabase } from "./lib/supabase.js";
import { LIBRARY_HREF, navigate } from "./router.js";

/** The sign-in form's floor, so a password set here is one it would accept. */
const MIN_LENGTH = 8;

const FIELD =
  "tw:rounded-md tw:border tw:border-border tw:bg-card tw:px-3 tw:py-2 tw:text-sm tw:text-foreground tw:outline-none tw:any-pointer-coarse:text-base tw:focus:border-highlight-text";

export function SetNewPassword() {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* A ref, not `document.getElementById`: SignInControls.tsx says why. */
  const secondBox = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== again) {
      setError(AUTH_PASSWORD_MISMATCH.message);
      return;
    }
    setBusy(true);
    let err: Error | null;
    try {
      ({ error: err } = await supabase.auth.updateUser({ password }));
    } catch {
      /* `updateUser` rethrows what is not an Auth error — a dropped
         connection, blocked storage — instead of returning it. GPT Sol. */
      setBusy(false);
      setError(AUTH_PASSWORD_SET_FAILED.message);
      return;
    }
    setBusy(false);
    /* GoTrue's own words, as the sign-in form shows them: too short, too weak,
       the same as the old one. The reader stays on the form to try again. */
    if (err) {
      setError(err.message);
      return;
    }
    navigate(LIBRARY_HREF, { replace: true });
  };

  return (
    <div className="tw:flex tw:flex-col">
      <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">Choose a new password</h1>
      <p className="tw:mb-6 tw:mt-1 tw:text-sm tw:text-muted-foreground">
        You are signed in. Choose the password you will use next time.
      </p>

      {error && (
        <p
          role="alert"
          className="tw:mb-4 tw:rounded-md tw:border tw:border-destructive/40 tw:bg-destructive/10 tw:px-4 tw:py-2 tw:text-sm tw:text-foreground"
        >
          {error}
        </p>
      )}

      <form onSubmit={(e) => void submit(e)} className="tw:flex tw:flex-col tw:gap-3">
        <label className="tw:text-xs tw:text-muted-foreground" htmlFor="new-password">
          New password
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          /* Enter moves to the second box rather than submitting a form whose
             second box is still empty. The sign-in form's email box does the
             same, for the same reason (SignInControls.tsx). */
          enterKeyHint="next"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            secondBox.current?.focus();
          }}
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
        <label className="tw:text-xs tw:text-muted-foreground" htmlFor="new-password-again">
          The same again
        </label>
        <input
          id="new-password-again"
          ref={secondBox}
          type="password"
          autoComplete="new-password"
          enterKeyHint="go"
          required
          minLength={MIN_LENGTH}
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          className={FIELD}
        />
        <div className="tw:mt-1 tw:flex tw:items-center tw:gap-3">
          <Button type="submit" disabled={busy}>
            Set new password
          </Button>
          <button
            type="button"
            onClick={() => navigate(LIBRARY_HREF, { replace: true })}
            disabled={busy}
            className="tw:text-xs tw:text-ink-faint tw:hover:text-highlight-text"
          >
            not now
          </button>
        </div>
      </form>
    </div>
  );
}
