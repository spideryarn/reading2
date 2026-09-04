/**
 * The front door: what somebody who is not signed in sees.
 *
 * Greg, 2026-08-27: *"Add a simple landing page for not-logged-in users …
 * Include some of the vision/distinctiveness."* Two decisions he made then
 * still shape this file:
 *
 *  - **The sign-in buttons are on the page**, not behind a link to `/login`.
 *    SignInControls.tsx is rendered here, and `/login` keeps its compact screen
 *    for password-reset landings. Since the 2026-09-03 redesign there is one
 *    panel rather than two, at the foot, with a `Sign in` link in the top bar
 *    jumping to it — so the rule holds and the fold is free for the product.
 *  - **A deep link gets this same page.** `/read/some-article` while signed out
 *    is the landing page, and the address stays put so signing in puts you back
 *    where you were heading (auth-return.ts).
 *
 * ## Where the words come from — rewritten 2026-09-03
 *
 * Greg, 2026-09-02, on the version before that: *"I want it to use my words
 * rather than AI-generated, and it may not be clear what came from me vs AI."*
 * So every sentence here is one of three things, and the comment beside it says
 * which:
 *
 *  - **His**, from the interview of 2026-09-03
 *    (docs/research/260902k-spideryarn-reading-interview-guide.md) or from an
 *    earlier dated quote in docs/project — verbatim, or with punctuation and a
 *    pronoun changed so it reads to a stranger.
 *  - **A product fact** — a mode name, a price, a count — checked against the
 *    code, never against a doc about the code. This page once said "six
 *    diagrams" for a day when there were four.
 *  - **Connective tissue**, marked `[tissue]`, kept short, and the part the
 *    next interview replaces.
 *
 * No quote is attributed on the page itself: a stranger has no idea who he is,
 * and a founder quote about one's own product is the softest thing on a page.
 * The words are his; the page speaks in the app's voice.
 *
 * **The 2026-09-03 redesign moved sentences and cut two duplicates. It wrote
 * none.** What moved, and why: docs/plans/260903g-redesign-the-signed-out-marketing-pages.md
 * § Copy. The dog-eared-book line came up to sit under the hero because it is
 * the most vivid thing he has said; "And deliberately not" came out of the gap
 * between the principles and the prices; "Who it's for" went below the pictures,
 * because a stranger asks whether it is for them after seeing what it is.
 *
 * ## Beta, and the strip that is gone
 *
 * Greg, 2026-09-02: *"we should write the copy as if we're in Beta and taking
 * payments."* While sign-up was still an invite list and Stripe was still being
 * built, the page carried an honest strip alongside that copy — one line under
 * the buttons saying sign-up had not opened, and the primary call to action was
 * a mailto because there was nothing else honest for it to be.
 *
 * **Stripe went live on 2026-09-03 and sign-up is open to anyone**, so Greg had
 * both deleted: `BetaLine` here and `OpensShortly` under the plans (PlanCards.tsx)
 * are gone, and the primary button now goes to the sign-in panel at the foot of
 * this page. The copy above it did not have to change, which was the point of
 * writing it as if we were already here.
 *
 * ## The lead shot changed
 *
 * It was the glossary card. It is now the outline — the whole app in one frame,
 * the fisheye that nothing else does, and the thing Greg named first when asked
 * what the product does. The glossary asset was half filled by a white figure
 * from the article, with the card sitting on top of the white; Greg named that
 * one himself. See docs/project/marketing-pages.md § One shot, one idea.
 *
 * Styled with the `site-*` classes at the foot of styles.css and `tw:` utilities
 * for nudges — SiteBits.tsx's header says which does what.
 */
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { WebsitePlans } from "./PlanCards.js";
import { FEATURES_HREF, PRICING_HREF } from "./router.js";
import { SHOTS } from "./shots.js";
import { SiteFooter } from "./SiteFooter.js";
import { SignInControls } from "./SignInControls.js";
import {
  Feature,
  Frame,
  GhostCta,
  H2,
  PrimaryCta,
  SHELL,
  Showcase,
  SiteNav,
  Tile,
} from "./SiteBits.js";

export function LandingPage() {
  useDocumentTitle(pageTitle({ kind: "landing" }));

  return (
    <div className="site tw:font-sans tw:text-muted-foreground">
      <SiteNav here="home" />

      {/* ------------------------------------------------------- the hero --
          `overflow-hidden` is load-bearing twice: it clips the glow, which is
          deliberately wider than the page, and it clips the hero shot, which is
          wider still. Without it the page scrolls sideways on a narrow screen. */}
      <header className="tw:relative tw:overflow-hidden tw:pt-16 tw:pb-4 tw:sm:pt-24">
        <div className="site-grid" />
        <div className="site-glow" />

        <div className={`${SHELL} tw:relative`}>
          <h1 className="site-display tw:max-w-[16ch]">
            {/* Greg, 2026-09-03, answer 1, and the 2025 tagline file's first line. */}
            Read deeply &amp; efficiently.
          </h1>

          {/* Greg, 2026-09-03, answer 1. */}
          <p className="site-lede tw:mt-6">
            A companion, not a replacement: it highlights, annotates, orients and explains, but
            keeps you in the text itself.
          </p>

          <div className="tw:mt-8 tw:flex tw:flex-wrap tw:items-center tw:gap-3">
            {/* [tissue] Sign-up is open, so the primary action is the panel at
                the foot of this page — a plain `<a>` to a fragment on the page
                it is already on, which is why it does not need `Link`. */}
            <PrimaryCta href="#sign-in">Start reading</PrimaryCta>
            <GhostCta href={PRICING_HREF}>Plans and pricing</GhostCta>
          </div>

          {/* The one picture above the fold. It arrives tilted and straightens
              as you scroll into it — a screenshot of a reading product held at
              an angle is arguing against itself (styles.css § the tilt). */}
          <div className="site-tilt-stage tw:mt-14 tw:sm:mt-16">
            <div className="site-tilt">
              <Frame shot={SHOTS.outline} hero />
            </div>
          </div>
        </div>
      </header>

      <main className={SHELL}>
        {/* ------------------------------------------------ the one sentence --
            Greg, 2026-09-03, answer 2. Promoted out of the third section: it is
            the most vivid thing he has said about the product, so it is the
            first prose under the picture rather than the second paragraph of a
            section a stranger may never reach. */}
        <section className="site-reveal tw:mx-auto tw:mt-20 tw:max-w-[54ch] tw:text-center">
          <p className="tw:font-prose tw:text-xl tw:leading-relaxed tw:text-foreground tw:sm:text-2xl">
            It’s like reading a dog-eared copy of a book where a clever friend has highlighted the
            best bits and scribbled in the margins to help with the difficult bits, based on your
            background, interests and needs — rather than reading the Reader’s Digest version.
          </p>
        </section>

        {/* --------------------------------------------------- the pictures --
            Greg, 2026-09-03, follow-up to answer 4: "notes in the margin that
            explain & remind you about anything you might find tricky". The rest
            is docs/project/vision.md's line on the glossary. */}
        <Showcase shot={SHOTS.glossary} eyebrow="Glossary" title="Notes in the margin." offset>
          They explain and remind you about anything you might find tricky: the terms this piece
          uses in a non-obvious way, defined from the piece itself, underlined where they stand. The
          card comes to you.
        </Showcase>

        {/* Greg, 2026-08-24, the granularity-zoom brief, compressed; and
            2026-08-25, "I also always want to be able to see the full text". */}
        <Showcase shot={SHOTS.zoom} eyebrow="Zoom" title="Every level of detail at once.">
          Scroll right for more detail, down to progress through the article. Scan quickly to get a
          sense of the landscape, or burrow deeply — and the full text is always there beside it.
        </Showcase>

        {/* Greg, 2025-07-14, on the highlighting feature, lightly trimmed; the
            last sentence is a product fact from docs/project/search.md. */}
        <Showcase
          shot={SHOTS.meaning}
          eyebrow="Search by meaning"
          title="Find by concepts and meaning, rather than exact match"
          offset
        >
          Type in basically anything — a word, a phrase, a description — and it highlights the areas
          of the text that are relevant. It leaves you as the arbiter of whether something is worth
          considering more closely. Every hit is marked in the prose and painted into the strip
          beside it, and each says how sure it is.
        </Showcase>

        {/* ------------------------------------------------------ who it's for --
            Moved below the pictures on 2026-09-03: a stranger asks whether this
            is for them after seeing what it is, not before. */}
        <section className="site-panel site-reveal tw:mt-24 tw:p-8 tw:sm:p-10">
          <h2 className="site-eyebrow tw:mb-3">Who it’s for</h2>
          {/* Greg, 2026-09-03, answer 3. The fields are his call of 2026-09-02:
              "name fields too". */}
          <p className="tw:max-w-[58ch] tw:font-prose tw:text-lg tw:leading-relaxed tw:text-foreground">
            People who read difficult material and think professionally: scientists, researchers,
            academics. You open a long, deep, important article — a paper, a philosophy essay, a
            policy report — that you want to understand, digest, internalise, critique and remember.
          </p>
        </section>

        {/* ------------------------------------------------ and the rest of it -- */}
        {/* [tissue] The count is a product fact: nine <Tile>s follow. If you
            add or remove one, change the number — this page has shipped a wrong
            count before. */}
        <H2 eyebrow="And the rest of it">Nine more ways in.</H2>
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-26 (ideas) and 2026-08-31 (quotes). */}
          <Tile name="The ideas it introduces, and the ones it needs you to hold." span="wide">
            And the most central, helpful, interesting quotes — in order, or by importance, or by
            how memorable they are.
          </Tile>
          {/* Greg, 2026-08-28 (comments) and docs/project/comments.md. */}
          <Tile name="Ask at the point of confusion." span="wide">
            Select a sentence, bookmark it, add a note — and, if you want one, an answer, from the
            surrounding argument and from the web when it needs to. The article never leaves the
            screen.
          </Tile>
          {/* Greg, 2026-08-27 (remember) and 2026-08-31 (quiz). */}
          <Tile name="Find out what you kept.">
            Say what you took from the piece and hear, plainly and concisely, where it diverges from
            the text. Or take a dozen short questions, easy first, central first.
          </Tile>
          {/* Greg, 2026-08-26, the summary request, and 2026-08-31. */}
          <Tile name="Summary.">
            One sentence on every part of the piece, and every section of every part, as deep as you
            ask — beside the prose, never instead of it.
          </Tile>
          {/* Greg, 2026-08-31, the timeline request; docs/project/timeline.md. */}
          <Tile name="Timeline.">
            When the piece says things happened — falling back to order where the dates are
            ambiguous, and showing the uncertainty rather than hiding it.
          </Tile>
          {/* Greg, 2026-08-26, the diagram request, and 2026-09-03 for the
              fifth. The five names are DIAGRAMS in src/web/diagram.ts — checked
              there, not in a doc about it: this page said "six diagrams" for a
              day when there were four, and said "four" for an afternoon when
              Illustrated had made it five. */}
          <Tile name="Diagrams.">
            Five maps of the structure of the piece — force, drift, trail, sketch and illustrated —
            with where you are marked on each.
          </Tile>
          {/* docs/project/referee-mode.md, its title. */}
          <Tile name="For peer reviewers.">
            A mode that helps a referee read a paper without reading it for them.
          </Tile>
          {/* Greg, 2026-08-27, the links request. */}
          <Tile name="Links.">
            Hover the author’s own hyperlinks and see something about the destination before you
            leave.
          </Tile>
          {/* Greg, 2026-09-03, answer 2's postscript. What is shared is the
              generated work — outline, gists, glossary, ideas, quotes — and not
              the owner's comments, chats or searches (PrivacyPage.tsx). */}
          <Tile name="Public articles share their AI annotations." span="featured">
            The expensive generated work on a public-readable article — its outline, glossary, ideas
            and quotes — is there for everyone who opens it. Your own notes stay yours.
          </Tile>
        </div>
        <p className="tw:mt-6 tw:text-sm">
          <Link
            href={FEATURES_HREF}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            Everything it does, with pictures →
          </Link>
        </p>

        {/* --------------------------------------------------- what it holds to --
            Two lines shorter than it was. "A companion, not a replacement" and
            "it keeps bringing you back to the original text" both appeared twice
            on this page; each is kept once, higher up. */}
        {/* [tissue] */}
        <H2 eyebrow="What it holds to">The promises underneath.</H2>
        <ul className="site-reveal tw:mt-4 tw:flex tw:max-w-[62ch] tw:flex-col tw:gap-4">
          {/* Greg, 2026-09-03, answer 2; docs/project/vision.md § Principles 1 and 5. */}
          <Feature name="It keeps bringing you back to the original text.">
            An improved interface on the text itself, not an LLM-rewritten version that may or may
            not capture the author’s full intent. It helps you fight cognitive surrender.
          </Feature>
          {/* docs/project/vision.md § Principles 4, and the rule in
              src/converse.ts: a statement about the article cites its block. */}
          <Feature name="When the AI says what the article says, it cites the passage.">
            One press and you are reading the author, not the model.
          </Feature>
          {/* Greg, 2026-09-03, answer 1; the tiebreak as he corrected it the
              same day, from his notes on "rich updated internal representations". */}
          <Feature name="When a design call is close, depth wins.">
            The question is which option will best help you form your own rich, updated
            understanding — digest, learn, notice, integrate, critique — not which is easier.
          </Feature>
          {/* Greg, 2026-09-01, on the export button. */}
          <Feature name="It’s the reader’s data.">
            One button exports everything Spideryarn holds about an article, as plain files.
          </Feature>
        </ul>

        {/* ------------------------------------------------ and deliberately not --
            Promoted out of the gap between the principles and the prices. It is
            the only paragraph here a stranger would screenshot.
            docs/project/vision.md § Anti-goals. */}
        <section className="site-panel site-reveal tw:mt-20 tw:p-8 tw:sm:p-10">
          <h2 className="site-eyebrow tw:mb-3">And deliberately not</h2>
          <p className="tw:font-prose tw:text-lg tw:leading-relaxed tw:text-foreground tw:sm:text-xl">
            “Read this in 2 minutes.” Streaks, nudges, anything optimising for time in the app.
            Confident generated claims with no path back to the source.
          </p>
        </section>

        {/* [tissue]; "reading is never gated" is Greg, 2026-09-02, and the
            rule PlanCards.tsx states in full. */}
        <H2 eyebrow="Plans">Simple, and reading is never gated.</H2>
        <div className="site-reveal">
          <WebsitePlans />
          {/* [tissue] The same three rows are on `/pricing`, which exists to be
              an address you can send somebody rather than a page with more on
              it. Same shape as the features link above. */}
          <p className="tw:mt-6 tw:text-sm">
            <Link
              href={PRICING_HREF}
              className="tw:text-highlight tw:no-underline tw:hover:underline"
            >
              Pricing, and what a month’s allowance means →
            </Link>
          </p>
        </div>

        {/* ---------------------------------------------------------- sign in --
            One panel, at the foot. The `Sign in` link in the top bar jumps here,
            so the buttons are still on the page — the 2026-08-27 rule — without
            standing between a stranger and the product. */}
        <section
          id="sign-in"
          className="site-panel tw:mt-24 tw:scroll-mt-20 tw:p-6 tw:sm:p-8"
        >
          <p className="tw:mb-5 tw:text-sm">
            {/* [tissue] Both halves, since sign-up opened on 2026-09-03: the
                same controls create an account and return to one. */}
            Start with three articles free. Already have an account? Sign in — your shelf is where
            you left it.
          </p>
          <SignInControls />
        </section>

        {/* **One footer for the whole site**, since the merge of 2026-09-03:
            this page's own `SiteFooter` in SiteBits.tsx and the general one
            arrived the same day in two worktrees, and Greg's call was to keep
            the general one. `variant` carries this page's taller spacing over
            unchanged; the sentence is this page's and stays here.

            **`here` because this page is drawn at addresses that are not its
            own.** Signed out, `App.tsx` answers `/profile`, `/design`,
            `/admin`, `/add/...` and an unshared `/read/<slug>` with this page,
            so without it the row offered those readers a Home link to the page
            they were already on. SiteFooter.tsx § `here`. */}
        <SiteFooter here="library" variant="marketing">
          Spideryarn Reading — beta. Every screenshot is of a real article read in Spideryarn.
        </SiteFooter>
      </main>
    </div>
  );
}
