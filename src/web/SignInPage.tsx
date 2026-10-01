/**
 * The sign-in page, at `/login` — and since 2026-10-01 the only one.
 *
 * Greg, report spya-p6s5a4 (2026-09-29): *"For the non-logged-in users, let's
 * create a separate sign-in page and signpost to it at the top and bottom, and
 * follow any best practices in making that nice and usable."* So the landing
 * page and `/pricing` no longer carry the form; they link here, and this page
 * wears their clothes — the `.site` shell, the top bar, one panel, the footer —
 * so that following *Sign in* does not feel like leaving the site.
 * docs/plans/261001m-a-sign-in-page-of-its-own-signposted-from-the-signed-out-pages.md.
 *
 * Every line of auth logic is in SignInControls.tsx. What this page adds is two
 * readings of its own address:
 *
 *  - **`?next=`** — where to go afterwards, read through auth-return.ts §
 *    `loginNext`, which refuses anywhere that is not ours, the callback, and
 *    this page. It is passed to the controls as a *candidate*: they write it
 *    through the one-shot store only when the reader actually signs in, and
 *    App.tsx's signed-in `/login` branch takes it from there. The address alone
 *    never sends anybody anywhere.
 *  - **`?new`** — open on Create account. The hero's *Start reading* and every
 *    *Get Reader* use it; the top bar's *Sign in* does not.
 *
 * ## Why the landing page has no route in the address bar and this does
 *
 * Not being signed in shows you the landing page wherever you are, and the
 * address you were heading for stays in the address bar — that is what the
 * links from it put into `next`. Who you are is not view state, and
 * docs/project/url-state.md says view state is what lives in the URL. `/login`
 * is the exception rather than the rule: it is a page somebody was *sent*.
 */
import { loginNext } from "./auth-return.js";
import { CALLBACK_PATH } from "./lib/supabase.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SHELL, SiteNav } from "./SiteBits.js";
import { SignInControls } from "./SignInControls.js";
import { SiteFooter } from "./SiteFooter.js";

export function SignInPage() {
  useDocumentTitle(pageTitle({ kind: "login" }));
  const next = loginNext(location.search, CALLBACK_PATH) ?? "/";
  const create = new URLSearchParams(location.search).has("new");

  return (
    /* `min-h-dvh`, not `min-h-screen`: on a phone `100vh` is the viewport with
       the browser's chrome *retracted*, so the page is always a bar or two
       taller than the window and the footer starts below the fold.

       **`className="site"` is required, not decorative** — the `--site-*`
       custom properties a `site-panel` draws with are declared on it.
       PricingPage.tsx says what a page without it looks like. */
    <div className="site tw:flex tw:min-h-dvh tw:flex-col tw:font-sans tw:text-muted-foreground">
      <SiteNav here="login" signedIn={false} />

      {/* **This `flex-1` is what puts the footer on the floor**, and it is not
          `mt-auto` on the footer: that silently cancelled the footer's own
          `mt-20` — same property, `auto` wins and resolves to zero.
          SiteFooter.tsx says what that measured. */}
      <main className="tw:flex tw:flex-1 tw:items-start tw:justify-center tw:px-4 tw:pt-12 tw:sm:items-center tw:sm:pt-0">
        <section className="site-panel tw:w-full tw:max-w-md tw:p-6 tw:sm:p-8">
          {/* [tissue] The switch inside says which half you are in, so the
              heading names both rather than following it. GPT Sol, plan review
              F5: one seam fewer. */}
          <h1 className="tw:font-prose tw:text-2xl tw:text-foreground">
            Sign in or create an account
          </h1>
          <p className="tw:mb-6 tw:mt-2 tw:text-sm">
            {/* [tissue] The landing page's own sentence, which is true here too. */}
            Start with three articles free. Already have an account? Your shelf is where you left
            it.
          </p>
          <SignInControls initialTab={create ? "create" : "sign-in"} returnTo={next} />
        </section>
      </main>

      {/* **The one page here that is a dead end without it.** Somebody sent to
          `/login` has no landing page behind them and no shelf in front of
          them, so this row is their only way to find out what they are signing
          in to, or what happens to what they add. SiteFooter.tsx. */}
      {/* Inside `SHELL`, as on the landing page: the row has no gutter of its
          own, and outside the shell it ran into both edges of the window. */}
      <div className={SHELL}>
        <SiteFooter />
      </div>
    </div>
  );
}
