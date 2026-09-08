/**
 * `/contact` — how to reach us, and which way is best.
 *
 * Greg asked for it on 2026-09-05, and gave the copy with it:
 *
 * > Add a /contact page and link to it appropriately. For now it can be really
 * > brief. Mostly just saying Spideryarn is in beta, but we'd really love your
 * > feedback or suggestions. The best way to do it is with the Feedback button
 * > in the top right. You can also contact us at hello@spideryarn.com.
 *
 * So the page says those things and stops. docs/project/website-text.md is the
 * doc; docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md is the
 * plan, and names the one judgment call in it — the footer kept its `mailto:`
 * as well as gaining a link here. **That lasted a day**: Greg, 2026-09-06,
 * *"Remove the hello@spideryarn.com from the footer — just keep the Contact
 * page, which already points to that — that's sufficient."* So this page is now
 * the only place in the chrome the address appears, which is the argument for
 * the fallback paragraph below rather than against it.
 *
 * ## Why it looks like `/privacy` and not like `/features`
 *
 * The three marketing pages (`/`, `/features`, `/pricing`) open with
 * `className="site"` and a `SiteNav`, and carry the `--site-*` token scope with
 * them — a hero and a glow. That shell exists to sell something to a stranger
 * over a long scroll. This page is three short paragraphs, so it takes
 * `PrivacyPage.tsx`'s shape instead: an `← Home` link, an `h1`, prose, and the
 * same `SiteFooter` every other page a reader lands on carries.
 *
 * **The footer is no longer one of the differences.** It was — the marketing
 * pages passed `variant="marketing"` for a taller one — until 2026-09-08, when
 * the row was redesigned and one measure closed both kinds of page. What still
 * separates the two families is the nav and the hero, which is the decision
 * above; that it stands is GPT Sol's finding 4 on
 * docs/plans/260908d-make-the-site-footer-and-the-signed-out-pages-more-aesthetically-pleasing.md,
 * where it survived having its first argument disproved.
 *
 * ## The Feedback button is the answer, and the address is the fallback
 *
 * That ordering is Greg's — *"The best way to do it is with the Feedback button
 * … You can also contact us at …"* — and it is not only politeness. A report
 * filed through the button always arrives with the address the reader was
 * standing on and, on an article, its slug; an email arrives with neither.
 * docs/project/feedback.md.
 *
 * **The sentence is hedged twice, and both hedges were bought.** GPT Sol
 * established a P1 against the first draft of it, 2026-09-05:
 *
 *  - *"If you are signed in"* — `FeedbackButton` lives in the signed-in chrome,
 *    and App.tsx renders this page **bare** to a stranger. So the first draft
 *    pointed a signed-out reader at a top-right corner with nothing in it.
 *  - *"it carries that page's address"*, rather than the first draft's *"so we
 *    can see what you saw"* — pressing Feedback here sends `/contact` and not
 *    wherever they were before, and no screenshot goes unless they attach one.
 *    That wording promised a great deal more than arrives, and the page telling
 *    people how to reach us is the worst place in the app to overclaim.
 *
 * The address is imported rather than typed —
 * docs/project/website-text.md § The contact address.
 */
import { ArrowLeft } from "lucide-react";

import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { SiteFooter } from "./SiteFooter.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";

const MAIL_CLASS = "tw:text-highlight tw:no-underline tw:hover:underline";

export function ContactPage() {
  useDocumentTitle(pageTitle({ kind: "contact" }));

  return (
    <main className="tw:mx-auto tw:flex tw:min-h-dvh tw:max-w-2xl tw:flex-col tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans">
      {/* **"Home", not "Back", since 2026-09-08.** It goes to `/` rather than
          `history.back()`, and most people who open this page were *sent* to it
          — from an email, from the footer of another page, from a link in an
          article — so there was often no "back" for it to mean. It is also the
          label the footer uses for the same destination, and one page should not
          call one address two things. */}
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Home
      </Link>

      <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
        Contact
      </h1>

      <div className="tw:mt-5 tw:flex tw:flex-col tw:gap-4 tw:text-sm tw:leading-relaxed tw:text-muted-foreground">
        <p className="tw:m-0">
          Spideryarn is in beta, and we would really love your feedback or suggestions.
        </p>
        <p className="tw:m-0">
          If you are signed in, the best way to send them is the{" "}
          <strong className="tw:text-foreground">Feedback</strong> button in the top right. Press it
          on the page you want to tell us about — it carries that page&rsquo;s address with your
          report, which saves you describing where you were.
        </p>
        <p className="tw:m-0">
          You can also write to us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className={MAIL_CLASS}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>

      {/* **The spacer that puts the footer on the floor.** This page is a
          `min-h-dvh` flex column, and on `/contact` — 469 characters — the
          content is a third of one screen, which used to leave the footer
          floating 510px above the bottom of the window with black underneath
          it. This grows into whatever is left over.

          A spacer rather than `mt-auto` on the footer, and rather than wrapping
          everything above in a `flex-1` div: `margin-top: auto` is the same
          property as the footer's own `mt-20`, so it silently won on every page
          that is not a flex column and took the air above the rule with it —
          SiteFooter.tsx says what that measured. */}
      <div className="tw:flex-1" />

      <SiteFooter />
    </main>
  );
}
