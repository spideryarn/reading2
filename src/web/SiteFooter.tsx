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
 * *"mine absorbs theirs"*. It is the evidence for the paragraph above rather
 * than a counter-example to it — the duplication this file exists to prevent had
 * already begun, twice, in a week. The `variant` prop that merge left behind was
 * removed on 2026-09-08; see `SPACING`.
 * docs/project/marketing-pages.md.
 *
 * ## What it looks like, and why it looks like that
 *
 * A hairline, then one flex row with two ends: the wordmark, the caller's
 * sentence and a colophon on the left, the links on the right. Before
 * 2026-09-08 it was a rule and a huddle of underlined grey text at the far left
 * of it, which on `/` meant about 370px of content under 1104px of rule and
 * nothing closing the page. Each decision in it carries its reason at the point
 * of use below — the rule's colour, the link class, the missing middots, the
 * plain-text wordmark, the absent `mt-auto`, and the single spacing measure.
 * docs/plans/260908d-make-the-site-footer-and-the-signed-out-pages-more-aesthetically-pleasing.md
 * has the measurements it was changed against.
 *
 * ## Where it goes, and where it does not
 *
 * Every page a reader *lands on and reads*: `LandingPage`, `FeaturesPage`,
 * `PricingPage`, `PrivacyPage`, `ContactPage`, `ChangelogPage`,
 * `PublicReadableSharingPage` and `SignInPage` signed out, and the signed-in
 * pages of the same shape — the shelf, `/profile`, and those same policy and
 * marketing pages when a signed-in reader opens them. `/pricing` arrived
 * 2026-09-03, `/contact` 2026-09-05, `/changelog` and
 * `/features/public-readable-sharing` 2026-09-06.
 *
 * **Written without a count, deliberately, since 2026-09-08.** This paragraph
 * said "nine" while omitting `PublicReadableSharingPage` from its own list, and
 * a count beside the list it counts is a fact with two homes — the same trap
 * `FooterPage` below carries a note about. GPT Sol, reviewing the 260908d plan,
 * finding 3.
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

import { GitHubMark } from "./GitHubMark.js";
import { Link } from "./Link.js";
import { Wordmark } from "./SiteBits.js";
import {
  CHANGELOG_HREF,
  CHANGELOG_LABEL,
  CONTACT_HREF,
  FEATURES_HREF,
  LIBRARY_HREF,
  OPENSOURCE_HREF,
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
  "library" | "features" | "privacy" | "pricing" | "contact" | "changelog" | "opensource"
>;

/**
 * The row, in order, each tagged with the route it *is* so it can drop itself.
 *
 * `library` covers two different pages and that is correct in both: signed in
 * it is the shelf, signed out it is the landing page, and on either of them a
 * link labelled Home would point at the page under the reader's feet.
 */
const LINKS: readonly {
  href: string;
  label: string;
  here: FooterPage;
  /**
   * A mark drawn before the label, and exactly one entry has one.
   *
   * Greg asked for the open-source link *"using GitHub logo to indicate"*, and
   * the mark is doing work the word cannot: in a row of six identical grey
   * words, it is the only thing that says *this one leaves the site and goes
   * somewhere you already know how to read*. `aria-hidden` inside `GitHubMark`,
   * because the label beside it is the accessible name and an icon read aloud
   * as well is noise.
   */
  icon?: ReactNode;
}[] = [
  { href: LIBRARY_HREF, label: "Home", here: "library" },
  { href: FEATURES_HREF, label: "Features", here: "features" },
  /* Added 2026-09-03 with `/pricing`, and this array is the whole edit — which
     is the claim the header makes, now tested by something other than itself. */
  { href: PRICING_HREF, label: "Pricing", here: "pricing" },
  { href: PRIVACY_HREF, label: "Privacy", here: "privacy" },
  /* Added 2026-09-05 with `/contact`, and — like `/pricing` before it — this
     array is the whole edit, which is the claim this file's header makes.

     **It replaced the address**, which this row carried beside it for a day.
     Greg, 2026-09-06: *"Remove the hello@spideryarn.com from the footer — just
     keep the Contact page, which already points to that — that's sufficient."*
     The earlier decision had been to keep both, on the grounds that a
     `mailto:` is one press for a reader who is stuck; one press more, through a
     page that also tells them the Feedback button is better, is the trade Greg
     took. docs/plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md. */
  { href: CONTACT_HREF, label: "Contact", here: "contact" },
  /* Added 2026-09-06 with `/changelog` — same claim, same array-is-the-edit.
     "What's new" rather than "Changelog": the latter is the internal name for
     the process that writes the page (docs/project/changelog.md), and a
     reader has never heard of it.

     **The label is `CHANGELOG_LABEL` rather than the words**, since 2026-09-07:
     the command bar offers this page too, so the string had four homes and three
     comments promising they matched. router.ts § `CHANGELOG_LABEL`. */
  { href: CHANGELOG_HREF, label: CHANGELOG_LABEL, here: "changelog" },
  /* Added 2026-09-07 with `/opensource` — and, like the three entries above it,
     this array is the whole edit. The first entry to carry an icon; see `icon`
     above for why this one and not the others.
     docs/plans/260907f-changelog-table-of-contents-collapsible-versions-version-numbers-and-an-opensource-page.md.

     Its label is still the words, unlike the row above — router.ts
     § `OPENSOURCE_HREF` says why, and that it should not stay that way for long. */
  {
    href: OPENSOURCE_HREF,
    label: "Open source",
    here: "opensource",
    icon: <GitHubMark size={11} />,
  },
];

/**
 * **`SiteNav`'s link class, copied deliberately** (SiteBits.tsx § `SiteNav`), so
 * a page speaks one link language at the top and at the bottom.
 *
 * **`tw:no-underline` is the load-bearing word.** This app imports no Tailwind
 * preflight (tailwind.css § the bit of preflight we need), so the UA's
 * `text-decoration: underline` stands wherever nothing removes it — and until
 * 2026-09-08 nothing here did. Five grey underlined items in a row is what made
 * this footer read as raw markup rather than as furniture, and it was the only
 * link row on the site wearing them: the nav, the *Back* links, the `mailto:` on
 * `/contact` and every cross-reference in the privacy policy all say
 * `tw:no-underline` themselves. Do not drop it on the theory that a footer link
 * "should" be underlined; nothing else here is.
 */
const LINK_CLASS =
  "tw:text-sm tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:text-foreground";

/**
 * **One measure, and it used to be two.**
 *
 * There was a `variant` prop — `page` (`mt-14 pt-5`) against `marketing`
 * (`mt-24 pt-6 pb-16`), the taller one carried over from the 2026-09-03
 * redesign and passed by four callers. The reason it existed was that a single
 * grey line of 12px text looked *cut off* under the marketing pages' vertical
 * space, so those pages bought the closure back with air. Since 2026-09-08 the
 * footer has a wordmark, a colophon and a two-ended row, which is mass of its
 * own, and one measure closes both kinds of page. Four callers lost a prop and
 * the knob went with it. docs/plans/260908d-make-the-site-footer-and-the-signed-out-pages-more-aesthetically-pleasing.md.
 *
 * If a page ever genuinely needs different air, give *that page* a wrapper
 * rather than giving this component a second knob back.
 */
const SPACING = "tw:mt-20 tw:pt-8 tw:pb-16";

export function SiteFooter({
  children,
  here,
}: {
  /**
   * An optional sentence in the left-hand block, between the wordmark and the
   * colophon — what the landing and features pages say about their screenshots.
   * Anything true of *this page* rather than of the site, which is why it is the
   * caller's and not a constant here.
   *
   * It said "above the links" until 2026-09-08, which was true of the stacked
   * row this replaced and is not true of the two-ended one: the links are now
   * *beside* it.
   */
  children?: ReactNode;
  /**
   * **Which page this really is**, when the address does not say. Only
   * `LandingPage` and `Library` pass it — the two pages `App.tsx` falls back
   * to, see the header. Everything else lets the route answer, which is the
   * arrangement that cannot drift.
   */
  here?: FooterPage;
}) {
  const route = useRoute();
  const kind = here ?? route.kind;
  const links = LINKS.filter((l) => l.here !== kind);

  return (
    /* **A literal translucent white, not `border-border`.** `--border` is
       `oklch(0.27 0 0)` — a solid grey line, and on a `oklch(0.145 0 0)` page it
       was the heaviest edge anywhere on it, sitting under the least important
       content. The marketing language builds its edges from translucent white
       instead (site.css § the ladder), and this is that same family without
       needing a `.site` ancestor — which matters, because this footer also draws
       on the shelf and `/profile`, and neither of those may become a `.site`
       page.

       **`border-[rgb(255_255_255/0.16)]` and not `border-white/[0.16]`**, which
       is what a Tailwind opacity modifier would normally be for. Read the CSS
       v4.3.3 actually emits for it:

           border-color: var(--tw-color-white);
           @supports (color: color-mix(in lab, red, red)) {
             border-color: color-mix(in oklab, var(--tw-color-white) 16%, transparent);
           }

       The alpha lives inside the `@supports`, and the declaration outside it is
       **opaque white**. So a browser without `color-mix` gets a solid white 1px
       rule across the foot of the page — a louder version of exactly the defect
       this line exists to fix, on the only browsers nobody here tests. An
       arbitrary literal has no fallback to be wrong. GPT Sol, reviewing the
       260908d plan, finding 7; checked against the compiled stylesheet rather
       than taken on trust.

       **`0.16` — `--site-hairline-strong` — rather than the plain `0.10`
       hairline, and that is a measurement rather than a preference.** The 10%
       version was tried first, on the reasoning that it is the value most edges
       on these pages use, and it disappeared: those edges are borders around a
       `--site-surface` fill, so the fill is doing half the separating, and a
       bare rule over the page background has nothing helping it. The stronger
       value is the one the language already keeps for exactly that job.

       **There is no `mt-auto` here, and that is the interesting one.** Pushing
       the footer to the floor of a short page is a real requirement — `/contact`
       and `/login` are both shorter than one screen — and `mt-auto` inside the
       flex column those pages now are is the obvious way to say it. It was
       written that way first and it was wrong: `margin-top: auto` and
       `margin-top: 5rem` are the same property, and Tailwind emits `mt-auto`
       later regardless of the order they appear in the class string, so `auto`
       won everywhere — and `auto` resolves to zero wherever there is no free
       space to absorb, which is every page that is not a flex column and also
       any flex column whose free space something else has already taken.
       Measured immediately afterwards: `marginTop: 0px` on `/`, `/pricing`,
       `/privacy`, `/changelog` and `/login`, the rule sitting flush against the
       bottom of the last panel on five pages out of six — while the sixth
       looked perfect and the screenshots of the other five looked close enough
       to pass. docs/reusable/silent-success.md.

       CSS has no way to spell "auto, but at least 5rem", so the push belongs to
       the page rather than to the footer: the short pages carry a `tw:flex-1`
       element above this one, which grows into the free space and leaves this
       margin alone. ContactPage.tsx has the shape. */
    <footer className={`${SPACING} tw:border-t tw:border-[rgb(255_255_255/0.16)]`}>
      {/* Two ends rather than one huddle. On `/` and `/pricing` the row is
          1104px wide and used to hold about 370px of text hard against its left
          edge, leaving roughly 70% of the rule with nothing under it.

          `flex-wrap` is the whole narrow-window story — docs/project/narrow-windows.md
          § "a row of things whose widths you do not control must be allowed to
          wrap". On a narrow window the links drop under the left column, and
          inside `/login`'s 336px column they do so at any window width.
          Measured clean — `scrollWidth - clientWidth === 0`, that doc's own
          check — on all seven pages at 1440, 390 and 320. */}
      <div className="tw:flex tw:flex-wrap tw:items-start tw:justify-between tw:gap-x-10 tw:gap-y-6">
        <div className="tw:flex tw:max-w-[46ch] tw:flex-col tw:gap-2">
          {/* Plain text, deliberately: see SiteBits.tsx § `Wordmark`. A link to
              `/` here would be the one thing this component exists to prevent —
              an entry pointing at the page under the reader's feet — on every
              page that is `/`. */}
          <Wordmark className="tw:text-sm" />
          {children && (
            <p className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-ink-faint">{children}</p>
          )}
          {/* The line that closes the page. A fact rather than copy, so it is
              not subject to docs/project/positioning.md § Whose words — and the
              year is read rather than typed, because a hardcoded one is wrong
              every January and nothing goes red when it is. */}
          <p className="tw:m-0 tw:text-xs tw:text-ink-faint">
            © {new Date().getFullYear()} Spideryarn · beta
          </p>
        </div>
        {/* **The gap is the separator.** It was ` · ` between every pair, which
            was already the careful version — a trailing one on each link had
            been correct only while the contact address was drawn last after
            them, and stopped being the moment that address left. Set in a row
            of its own with real space between the items, the middot is one more
            grey mark competing with the words. */}
        <nav
          aria-label="Site"
          className="tw:flex tw:flex-wrap tw:gap-x-5 tw:gap-y-2"
        >
          {/* **One entry carries a mark, and it is why this is not a bare
              `{l.label}`.** Greg asked for the open-source link *"using GitHub
              logo to indicate"* — see `icon` on `LINKS`. `inline-flex` only when
              there is one, so every other link stays the plain inline text this
              row's spacing was measured against. */}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                l.icon ? `${LINK_CLASS} tw:inline-flex tw:items-center tw:gap-1.5` : LINK_CLASS
              }
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}
