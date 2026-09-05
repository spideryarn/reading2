/**
 * **The row of site links at the foot of a page.**
 *
 * Greg, 2026-09-03: *"add a link in the footer to the Privacy and Features
 * pages on all non-logged-in-pages, and also for some of the logged-in pages
 * where it makes sense to do so (e.g. on `/`, but NOT on any `/read/*` pages).
 * We'll probably also add a Terms of Service etc later."*
 *
 * It existed twice before this file did — hand-written in `LandingPage.tsx` and
 * again in `FeaturesPage.tsx`, already disagreeing about which links they
 * carried. Adding a third copy per page is how a Terms link ships on two pages
 * out of seven, so the row is a component and the list below is the whole of it:
 * a Terms page is one entry in `LINKS`, not an edit to every page.
 *
 * **And it very nearly existed twice again.** The marketing redesign of
 * 2026-09-03 extracted its own `SiteFooter` into `SiteBits.tsx` on the same day
 * this file was written, in another worktree — two components, one name, the
 * same job, found only when the branches met. Greg's call was one component:
 * *"mine absorbs theirs"*. That is what `variant` below is for, and it is the
 * evidence for the paragraph above rather than a counter-example to it — the
 * duplication this file exists to prevent had already begun, twice, in a week.
 * docs/project/marketing-pages.md.
 *
 * ## Where it goes, and where it does not
 *
 * Every page a reader *lands on and reads*, and there are eight:
 * `LandingPage`, `FeaturesPage`, `PricingPage`, `PrivacyPage`, `ContactPage`
 * and `SignInPage` signed out, and the signed-in pages of the same shape — the
 * shelf, `/profile`, and those same policy and marketing pages when a signed-in
 * reader opens them. `/pricing` is the seventh, since 2026-09-03, and
 * `/contact` the eighth, since 2026-09-05.
 * `tests/site-footer.test.tsx` pins the list, so this paragraph and the code
 * cannot drift apart quietly — and it was the test, not this paragraph, that
 * was right for a day (GPT Sol, stage 2 code review, finding 6).
 *
 * **Nothing under `/read/`**, which is Greg's exclusion, taken at its word:
 * *"NOT on any `/read/*` pages"*. The obvious reason is the reading view — one
 * screen with a fixed spine and a band, and no bottom to put a footer at — and
 * that reason tempted an earlier version of this file into reading the rule as
 * being about the *view* and giving the row to the two dead-end pages in
 * `PublicChrome.tsx`, which sit at a `/read/` address and are not the view. A
 * cross-family review called that rationalising and it was right. The brief is
 * about the path, so the path is what this obeys, and the comments at those two
 * pages say what to undo if Greg wants them after all.
 *
 * **The landing page is the one thing under `/read/` that keeps it**, and that
 * is a collision between two of Greg's sentences rather than a second
 * reinterpretation of one: signed out at an unshared `/read/<slug>` the reader
 * gets `LandingPage`, which is *the* non-logged-in page and already carries the
 * row at `/`. Drawing the same page two different ways depending on the address
 * that produced it would be the stranger answer.
 *
 * Not `/add` either — that is an action in flight rather than a page — and not
 * `/design` or `/admin`, which are developer furniture with no reader on
 * them.
 *
 * ## The link for the page you are already on is dropped
 *
 * Rather than drawn dead. `useRoute()` answers it by default, so all but two of
 * the callers pass nothing and cannot get it wrong — the failure the two
 * hand-written footers had already found, one of them linking to Features from
 * Features. (Written without a count on purpose: the two previous versions of
 * this sentence both said a number, and both were wrong by the time somebody
 * read them. `tests/site-footer.test.tsx` holds the inventory instead.)
 *
 * **`here` is the escape hatch, and the two pages that need it are the two
 * `App.tsx` uses as its fallbacks.** The default asks *what address is this*,
 * and for most pages that is the same question as *what page is this*. It is
 * not for these two, because `App.tsx` reaches for them whenever an address
 * does not work out:
 *
 *  - `LandingPage`, signed out, answers `/profile`, `/design`, `/admin`,
 *    `/add/...` and an unshared `/read/<slug>` as well as `/`.
 *  - `Library` answers `/admin` for a reader who is not the administrator.
 *    **It answered every unrecognised address too until 2026-09-03**, when
 *    those got a page of their own (NotFoundPage.tsx) and this list shrank to
 *    the one case; `/admin` stayed, deliberately, for the reason
 *    docs/project/admin.md gives. The escape hatch is worth no less for
 *    covering one address instead of all of them — that address is exactly
 *    where the route and the page still disagree.
 *
 * On any of those the route said one thing while the reader looked at another,
 * and the row grew a Home link pointing at the page under their feet. GPT Sol
 * found both, 2026-09-03 — the second one *after* the first was fixed, which is
 * the argument for the narrow type below rather than for trusting a rule.
 *
 * So: **a page `App.tsx` can draw at somebody else's address declares itself;
 * every other page must not**, because a hand-written `here` is the copy-paste
 * failure above waiting to happen again. `FooterPage` is deliberately the link
 * kinds `LINKS` carries and not `Route["kind"]`, so the only values that can be
 * passed are ones that mean something here.
 *
 * Styled with Tailwind utilities, the rule for chrome — docs/project/web-client.md
 * § Tailwind and shadcn. Note the `tw:` prefix on every class.
 */
import type { ReactNode } from "react";

import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import {
  CONTACT_HREF,
  FEATURES_HREF,
  LIBRARY_HREF,
  PRICING_HREF,
  PRIVACY_HREF,
  useRoute,
  type Route,
} from "./router.js";

/**
 * **The pages this row can link to**, and therefore the only answers to "which
 * page am I" that change anything — one member per entry in `LINKS` below.
 *
 * Deliberately not counted here. It said "four" while `LINKS` held five, having
 * been written when it held three, and a count beside the list it counts is a
 * fact with two homes.
 *
 * A subset of `Route["kind"]` rather than the whole union, and the subtraction
 * is the point: `here="profile"` is meaningless — no link would drop — and
 * under the wider type it type-checks, so a caller could pass it, watch nothing
 * happen, and conclude the prop is broken.
 *
 * `Extract` rather than a bare union of three strings, so this cannot drift
 * from the router: rename the `library` route and `Extract` yields `never` for
 * that member, which `LINKS` below then refuses to satisfy. A hand-written
 * union would go on compiling and stop matching anything at run time.
 */
type FooterPage = Extract<
  Route["kind"],
  "library" | "features" | "privacy" | "pricing" | "contact"
>;

/**
 * The row, in order, each tagged with the route it *is* so it can drop itself.
 *
 * `library` covers two different pages and that is correct in both: signed in
 * it is the shelf, signed out it is the landing page, and on either of them a
 * link labelled Home would point at the page under the reader's feet.
 */
const LINKS: readonly { href: string; label: string; here: FooterPage }[] = [
  { href: LIBRARY_HREF, label: "Home", here: "library" },
  { href: FEATURES_HREF, label: "Features", here: "features" },
  /* Added 2026-09-03 with `/pricing`, and this array is the whole edit — which
     is the claim the header makes, now tested by something other than itself. */
  { href: PRICING_HREF, label: "Pricing", here: "pricing" },
  { href: PRIVACY_HREF, label: "Privacy", here: "privacy" },
  /* Added 2026-09-05 with `/contact`, and — like `/pricing` before it — this
     array is the whole edit, which is the claim this file's header makes.

     **It does not replace the address below**, and that is a decision rather
     than an oversight. The `mailto:` is the only thing in this row a reader who
     is stuck can act on in one press; the page is where somebody who went
     looking for "contact us" lands, and it says the Feedback button is better
     than either. docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md. */
  { href: CONTACT_HREF, label: "Contact", here: "contact" },
];

const LINK_CLASS = "tw:text-ink-faint tw:hover:text-highlight";

/**
 * **How much air the row sits in**, and it is two values because the pages come
 * in two shapes rather than because anybody wanted a knob.
 *
 * `page` is the app's own measure and the default, so it is what every page gets
 * that is chrome around something a reader came for. `marketing` is the taller,
 * roomier one the 2026-09-03 redesign chose, and the three pages that pass it —
 * `/`, `/features` and `/pricing` — are the whole of its use. Kept exactly as
 * that redesign had it (`mt-24 pt-6 pb-16`) when its footer was absorbed into
 * this file — those two pages end in a lot of vertical space on purpose, and the
 * app's tighter measure read as the page having been cut off.
 * docs/project/marketing-pages.md.
 */
const SPACING = {
  page: "tw:mt-14 tw:pt-5",
  marketing: "tw:mt-24 tw:pt-6 tw:pb-16",
} as const;

export function SiteFooter({
  children,
  here,
  variant = "page",
}: {
  /**
   * An optional sentence above the links — what the landing and features pages
   * say about their screenshots. Anything true of *this page* rather than of
   * the site, which is why it is the caller's and not a constant here.
   */
  children?: ReactNode;
  /**
   * **Which page this really is**, when the address does not say. Only
   * `LandingPage` and `Library` pass it — the two pages `App.tsx` falls back
   * to, see the header. Everything else lets the route answer, which is the
   * arrangement that cannot drift.
   */
  here?: FooterPage;
  /** Which spacing — see `SPACING`. The three marketing pages pass `marketing`. */
  variant?: keyof typeof SPACING;
}) {
  const route = useRoute();
  const kind = here ?? route.kind;
  const links = LINKS.filter((l) => l.here !== kind);

  return (
    <footer
      className={`${SPACING[variant]} tw:border-t tw:border-border tw:text-xs tw:text-ink-faint`}
    >
      {children && <p className="tw:m-0">{children}</p>}
      <p className={children ? "tw:mt-2 tw:mb-0" : "tw:m-0"}>
        {links.map((l) => (
          <span key={l.href}>
            <Link href={l.href} className={LINK_CLASS}>
              {l.label}
            </Link>
            {" · "}
          </span>
        ))}
        {/* Last, and always drawn — it is the only one that is not a page, and
            the only thing here a reader who is stuck can actually use.
            docs/project/website-text.md § The contact address is why it is
            imported rather than typed. */}
        <a href={`mailto:${CONTACT_EMAIL}`} className={LINK_CLASS}>
          {CONTACT_EMAIL}
        </a>
      </p>
    </footer>
  );
}
