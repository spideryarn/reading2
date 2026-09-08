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
import { SiteFooter } from "./SiteFooter.js";

export function SignInPage() {
  useDocumentTitle(pageTitle({ kind: "login" }));

  return (
    /* `min-h-dvh`, not `min-h-screen`: on a phone `100vh` is the viewport with
       the browser's chrome *retracted*, so the page is always a bar or two
       taller than the window and the footer starts below the fold. */
    <main className="tw:mx-auto tw:flex tw:min-h-dvh tw:max-w-sm tw:flex-col tw:px-6 tw:font-sans">
      {/* **The centring wraps the form, not the page**, and until 2026-09-08 it
          wrapped the page. `justify-center` on `<main>` centred the footer along
          with the sign-in controls, which left the row floating at about 70% of
          the height with 306px of black beneath it — the whole page's worth of
          furniture arranged around nothing. Now the form is centred in whatever
          space the footer does not want.

          **This `flex-1` is also what puts the footer on the floor**, and it is
          worth knowing that it is not `mt-auto` on the footer. That was the
          first version and it silently cancelled the footer's own `mt-20` —
          same property, `auto` wins and resolves to zero — so the 80px above the
          rule vanished on five pages. SiteFooter.tsx says what that measured.
          The other three bare pages carry a plain `tw:flex-1` spacer for the
          same job; this page needs the wrapper anyway, to centre the form. */}
      <div className="tw:flex tw:flex-1 tw:flex-col tw:justify-center">
        <h1 className="tw:font-prose tw:text-3xl tw:text-foreground">Spideryarn</h1>
        <p className="tw:mb-8 tw:mt-1 tw:text-sm tw:text-muted-foreground">
          Read deeply, at whatever level of detail you need. Sign in to get to your shelf.
        </p>

        <SignInControls />
      </div>

      {/* **The one page here that is a dead end without it.** Somebody sent to
          `/login` by a password-reset email has no landing page behind them and
          no shelf in front of them, so this row is their only way to find out
          what they are signing in to, or what happens to what they add.
          SiteFooter.tsx. */}
      <SiteFooter />
    </main>
  );
}
