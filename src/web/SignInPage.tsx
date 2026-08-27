/**
 * The compact sign-in screen, at `/login`.
 *
 * A centred column on our own tokens, wrapped round SignInControls.tsx — which
 * is where the Google button, the email form and every line of auth logic
 * actually live, because since 2026-08-27 two pages need them. The other is
 * LandingPage.tsx.
 *
 * ## What this page is for now
 *
 * It used to be the whole of being signed out: no user, this screen, wherever
 * you were. That is now LandingPage.tsx (App.tsx has the gate), and this is the
 * short version for the cases where a pitch would be in the way:
 *
 *  - a password-reset email, which has to land *somewhere*;
 *  - "send me the login page", which is a reasonable thing to be able to do.
 *
 * ## Why the landing page has no route in the address bar and this does
 *
 * Not being signed in shows you the landing page wherever you are, and the
 * address you were heading for stays in the address bar — which is the point,
 * because signing in then puts you back there (auth-return.ts). Who you are is
 * not view state, and docs/project/url-state.md says view state is what lives
 * in the URL. `/login` is the exception rather than the rule: it is not a
 * statement about who you are, it is a page somebody was *sent*.
 */
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SignInControls } from "./SignInControls.js";

export function SignInPage() {
  useDocumentTitle(pageTitle({ kind: "login" }));

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-screen tw:max-w-sm tw:flex-col tw:justify-center tw:px-6 tw:font-sans">
      <h1 className="tw:font-prose tw:text-3xl tw:text-foreground">Spideryarn</h1>
      <p className="tw:mb-8 tw:mt-1 tw:text-sm tw:text-muted-foreground">
        Read deeply, at whatever level of detail you need. Sign in to get to your shelf.
      </p>

      <SignInControls />
    </main>
  );
}
