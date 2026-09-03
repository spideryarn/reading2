/**
 * The front door: what somebody who is not signed in sees.
 *
 * Greg, 2026-08-27: *"Add a simple landing page for not-logged-in users …
 * Include some of the vision/distinctiveness."* Two decisions he made then
 * still shape this file:
 *
 *  - **The sign-in buttons are on the page**, not behind a link to `/login`.
 *    SignInControls.tsx is rendered here, near the top and again at the foot,
 *    and `/login` keeps its compact screen for password-reset landings.
 *  - **A deep link gets this same page.** `/read/some-article` while signed out
 *    is the landing page, and the address stays put so signing in puts you back
 *    where you were heading (auth-return.ts).
 *
 * ## Where the words come from — rewritten 2026-09-03
 *
 * Greg, 2026-09-02, on the previous version of this page: *"I want it to use
 * my words rather than AI-generated, and it may not be clear what came from me
 * vs AI."* So every sentence here is one of three things, and the comment
 * beside it says which:
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
 * ## Beta, and the honest strip
 *
 * Greg, 2026-09-02: *"we should write the copy as if we're in Beta and taking
 * payments."* And, asked what the live page says while sign-up is still an
 * invite list and Stripe is still being built: **beta copy, honest strip** —
 * one strip that says sign-up opens shortly and takes an email, to be deleted
 * the day it opens. The strip is `BetaStrip` below and nothing else on the
 * page knows about it, so deleting it is deleting one component.
 *
 * ## The screenshots
 *
 * All in shots.ts, with the how and the why. The lead is the glossary card,
 * because his own image of the product is *"a dog-eared copy of a book where a
 * clever friend has highlighted the best bits and scribbled in the margins"*,
 * and the card is the scribble in the margin. He left the call to me
 * (2026-09-03: *"Use your judgment … I can't decide."*).
 *
 * Styled with Tailwind utilities — docs/project/web-client.md § Tailwind and
 * shadcn. Note the `tw:` prefix on every class.
 */
import { CONTACT_EMAIL } from "../site-text.js";
import { Plans } from "./FeaturesPage.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { FEATURES_HREF, PRIVACY_HREF } from "./router.js";
import { SHOTS } from "./shots.js";
import { SignInControls } from "./SignInControls.js";
import { Feature, H2, Shot } from "./SiteBits.js";

/**
 * The strip a stranger has to read: the product is in beta, sign-up is not
 * open yet, and here is how to hear when it is. Delete this component, and its
 * one use, the day sign-up opens. The email goes to the one address the site
 * uses (docs/project/website-text.md § The contact address) with a subject so
 * the inbox can be filtered; a waitlist table is a decision for later.
 */
function BetaStrip() {
  const subject = encodeURIComponent("Tell me when Spideryarn Reading sign-up opens");
  return (
    <p className="tw:mt-6 tw:rounded-md tw:border tw:border-highlight/40 tw:bg-highlight/10 tw:px-4 tw:py-3 tw:text-sm tw:text-foreground">
      {/* [tissue] */}
      <strong>Spideryarn Reading is in beta.</strong> Sign-up opens shortly.{" "}
      <a
        href={`mailto:${CONTACT_EMAIL}?subject=${subject}`}
        className="tw:text-highlight tw:no-underline tw:hover:underline"
      >
        Leave your email
      </a>{" "}
      and we’ll tell you the day it does.
    </p>
  );
}

export function LandingPage() {
  useDocumentTitle(pageTitle({ kind: "landing" }));

  return (
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:py-12 tw:font-sans tw:text-[0.95rem] tw:leading-relaxed tw:text-muted-foreground">
      <header>
        <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-4">
          <h1 className="tw:font-prose tw:text-5xl tw:text-foreground">Spideryarn Reading</h1>
          <span className="tw:rounded-full tw:border-2 tw:border-highlight tw:px-4 tw:py-1 tw:text-lg tw:font-semibold tw:uppercase tw:tracking-widest tw:text-highlight">
            Beta
          </span>
        </div>

        {/* Greg, 2026-09-03, answer 1, and the 2025 tagline file's first line. */}
        <p className="tw:mt-4 tw:font-prose tw:text-2xl tw:text-foreground">
          Read deeply &amp; efficiently.
        </p>
        <p className="tw:mt-2 tw:font-prose tw:text-xl tw:text-foreground">
          A companion, not a replacement: it highlights, annotates, orients and explains, but keeps
          you in the text itself.
        </p>

        <BetaStrip />
      </header>

      <section className="tw:mt-10 tw:rounded-lg tw:border tw:border-border tw:bg-card/50 tw:p-6">
        <p className="tw:mb-5 tw:text-sm">{/* [tissue] */}Already have an account? Sign in.</p>
        <SignInControls />
      </section>

      {/* Greg, 2026-09-03, follow-up to answer 4: "notes in the margin that
          explain & remind you about anything you might find tricky". The
          second sentence is docs/project/vision.md's line on the glossary. */}
      <Shot shot={SHOTS.glossary} title="Notes in the margin." eager>
        They explain and remind you about anything you might find tricky: the terms this piece uses
        in a non-obvious way, defined from the piece itself, underlined where they stand. The card
        comes to you.
      </Shot>

      <H2>Not the Reader’s Digest version</H2>
      {/* Greg, 2026-09-03, answer 2, verbatim apart from pronouns. */}
      <p>
        Spideryarn keeps bringing you back to the original text itself — an improved interface on
        it, not an LLM-rewritten version that may or may not capture the author’s full intent. It
        helps you fight cognitive surrender.
      </p>
      <p className="tw:mt-4">
        It’s like reading a dog-eared copy of a book where a clever friend has highlighted the best
        bits and scribbled in the margins to help with the difficult bits, based on your background,
        interests and needs — rather than reading the Reader’s Digest version.
      </p>

      <H2>Who it’s for</H2>
      {/* Greg, 2026-09-03, answer 3. The fields are his call of 2026-09-02:
          "name fields too". */}
      <p>
        People who read difficult material and think professionally: scientists, researchers,
        academics. You open a long, deep, important article — a paper, a philosophy essay, a policy
        report — that you want to understand, digest, internalise, critique and remember.
      </p>

      {/* Greg, 2026-09-03, answer 4, verbatim apart from the opening. */}
      <Shot shot={SHOTS.outline} title="Where you are in the grand scheme of things.">
        A constantly evolving table of contents that gives you a sense of the overall landscape and
        where you are in it, with more detail for the current and nearby sections — a semantic
        fisheye lens.
      </Shot>

      {/* Greg, 2025-07-14, on the highlighting feature, lightly trimmed;
          the last sentence is a product fact from docs/project/search.md. */}
      <Shot shot={SHOTS.meaning} title="Search by what a passage says, not what it says exactly.">
        Type in basically anything — a word, a phrase, a description — and it highlights the areas
        of the text that are relevant. It leaves you as the arbiter of whether something is worth
        considering more closely; you can scan it rapidly. Every hit is marked in the prose and
        painted into the strip beside it, and each says how sure it is.
      </Shot>

      <H2>And the rest of it</H2>
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        {/* Greg, 2026-08-24, the granularity-zoom brief, compressed. */}
        <Feature name="Every level of detail at once.">
          Scroll right for more detail, down to progress through the article. The far right is
          always the author’s own words.
        </Feature>
        {/* Greg, 2026-08-26 (ideas) and 2026-08-31 (quotes). */}
        <Feature name="The ideas it introduces, and the ones it needs you to hold.">
          And the most central, helpful, interesting quotes — in order, or by importance, or by how
          memorable they are.
        </Feature>
        {/* Greg, 2026-08-28 (comments) and docs/project/comments.md. */}
        <Feature name="Ask at the point of confusion.">
          Select a sentence, bookmark it, add a note — and, if you want one, an answer, from the
          surrounding argument and from the web when it needs to. The article never leaves the
          screen.
        </Feature>
        {/* Greg, 2026-08-27 (remember) and 2026-08-31 (quiz). */}
        <Feature name="Find out what you kept.">
          Say what you took from the piece and hear, plainly and concisely, where it diverges from
          the text. Or take a dozen short questions, easy first, central first.
        </Feature>
        {/* docs/project/referee-mode.md, its title. */}
        <Feature name="For peer reviewers.">
          A mode that helps a referee read a paper without reading it for them.
        </Feature>
        {/* Greg, 2026-09-03, answer 2's postscript. */}
        <Feature name="Public articles share their annotations.">
          The expensive AI annotations on a public-readable article are there for everyone who
          opens it.
        </Feature>
      </ul>
      <p className="tw:mt-6">
        <Link href={FEATURES_HREF} className="tw:text-highlight tw:no-underline tw:hover:underline">
          Everything it does, with pictures →
        </Link>
      </p>

      <H2>What it holds to</H2>
      <ul className="tw:mt-3 tw:flex tw:flex-col tw:gap-4">
        {/* Greg, 2026-09-03, answer 2; docs/project/vision.md § Principles 1 and 5. */}
        <Feature name="It keeps bringing you back to the original text.">
          Generated text lives at generated altitudes; the author’s prose is never quietly
          rewritten, and it is always one column away.
        </Feature>
        {/* docs/project/vision.md § Principles 4, and block-ids.md. */}
        <Feature name="Every claim the AI makes is tied to a passage you can press.">
          Nothing it says floats free of the article.
        </Feature>
        {/* Greg, 2026-09-03, answer 1; the tiebreak as he corrected it the same
            day, from his notes on "rich updated internal representations". */}
        <Feature name="A companion, not a replacement.">
          When a design call is close, the question is which option will best help you form your
          own rich, updated understanding — digest, learn, notice, integrate, critique — not which
          is easier.
        </Feature>
        {/* Greg, 2026-09-01, on the export button. */}
        <Feature name="It’s the reader’s data.">
          One button exports everything Spideryarn holds about an article, as plain files.
        </Feature>
      </ul>

      <H2>And deliberately not</H2>
      {/* docs/project/vision.md § Anti-goals. */}
      <p>
        “Read this in 2 minutes.” Streaks, nudges, anything optimising for time in the app.
        Confident generated claims with no path back to the source.
      </p>

      <H2>Plans</H2>
      <Plans />

      <section className="tw:mt-14 tw:rounded-lg tw:border tw:border-border tw:bg-card/50 tw:p-6">
        <p className="tw:mb-5 tw:text-sm">
          {/* [tissue] */}Already have an account? Sign in — your shelf is where you left it.
        </p>
        <SignInControls />
      </section>

      <footer className="tw:mt-14 tw:border-t tw:border-border tw:pt-5 tw:text-xs tw:text-ink-faint">
        <p className="tw:m-0">
          Spideryarn Reading — beta. Every screenshot is of a real article read in Spideryarn; most
          are of <em>The Mythology of AI Consciousness</em> by Anil Seth.
        </p>
        <p className="tw:mt-2 tw:mb-0">
          <Link href={FEATURES_HREF} className="tw:text-ink-faint tw:hover:text-highlight">
            Features
          </Link>
          {" · "}
          <Link href={PRIVACY_HREF} className="tw:text-ink-faint tw:hover:text-highlight">
            Privacy
          </Link>
          {" · "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="tw:text-ink-faint tw:hover:text-highlight">
            {CONTACT_EMAIL}
          </a>
        </p>
      </footer>
    </main>
  );
}
