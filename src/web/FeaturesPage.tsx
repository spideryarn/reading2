/**
 * `/features` — what the thing does, mode by mode, with pictures.
 *
 * The landing page is the pitch and shows three things. This is the rest,
 * for the person who has read the pitch and wants to know what they would
 * actually get. Reachable signed out, like `/privacy`, and for the same
 * reason: the person who wants it is deciding whether to sign up.
 *
 * ## Where the words come from
 *
 * Same rule as LandingPage.tsx, same three kinds, same marks: **Greg's words**
 * from a dated quote (the comment beside each says which), **product facts**
 * checked against the code, and **connective tissue** marked `[tissue]`. Ten
 * of the fourteen interview questions were still unanswered when this was
 * written (docs/research/260902k-spideryarn-reading-interview-guide.md), so
 * for those modes the words are his older ones, from the feature docs — the
 * request that built the mode, which is usually the clearest sentence about
 * what it is for.
 *
 * ## The order
 *
 * The reading order he gave the product: get the landscape, go into the text,
 * ask, keep something. Then the mode for a specific job (referees), then the
 * shelf, the plans, and the one sentence about where the text goes.
 *
 * Styled with Tailwind utilities — docs/project/web-client.md. `tw:` prefix
 * on every class.
 */
import { ArrowLeft } from "lucide-react";
import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { PRIVACY_HREF } from "./router.js";
import { SHOTS } from "./shots.js";
import { Feature, H2, Shot } from "./SiteBits.js";

/**
 * The three plans, as docs/plans/260902i-stripe-payments-and-subscription-tiers.md
 * set them on 2026-09-02, and as `billing_tiers` holds them. Rendered on both
 * pages. **The numbers here are copy, not configuration**: the source of truth
 * is the database, and when a quota changes there this table is a second copy
 * that has to be changed by hand — which is the trade the plan made so that a
 * signed-out page needs no fetch. Reading is never gated, in Greg's words
 * (2026-09-02): *"if a user has hit their quota, they should still be able to
 * read their existing and Public-readable articles, just not incur extra
 * spend."*
 */
export function Plans() {
  const cell = "tw:py-2 tw:pr-6 tw:align-top";
  return (
    <div>
      <table className="tw:mt-4 tw:w-full tw:border-collapse tw:text-sm">
        <thead>
          <tr className="tw:border-b tw:border-border tw:text-left tw:text-xs tw:uppercase tw:tracking-wide tw:text-ink-faint">
            <th className={cell}>Plan</th>
            <th className={cell}>Articles</th>
            <th className={cell}>Price</th>
          </tr>
        </thead>
        <tbody className="tw:text-foreground">
          <tr className="tw:border-b tw:border-border">
            <td className={cell}>Free</td>
            <td className={cell}>3, to try it</td>
            <td className={cell}>—</td>
          </tr>
          <tr className="tw:border-b tw:border-border">
            <td className={cell}>Reader</td>
            <td className={cell}>20 a month</td>
            <td className={cell}>$10 · £8 · €9 a month</td>
          </tr>
          <tr>
            <td className={cell}>Researcher</td>
            <td className={cell}>150 a month</td>
            <td className={cell}>$50 · £40 · €45 a month</td>
          </tr>
        </tbody>
      </table>
      {/* Greg, 2026-09-02, rephrased to the reader. */}
      <p className="tw:mt-4 tw:text-sm">
        An article counts when you add it; everything you do with it afterwards is included. Reading
        is never gated: at your limit you can still read every article you have and every public
        one.
      </p>
    </div>
  );
}

export function FeaturesPage() {
  useDocumentTitle(pageTitle({ kind: "features" }));

  return (
    <main className="tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:pb-24 tw:font-sans tw:text-[0.95rem] tw:leading-relaxed tw:text-muted-foreground">
      <Link
        href="/"
        className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
      >
        <ArrowLeft size={13} />
        Back
      </Link>

      <h1 className="tw:m-0 tw:font-prose tw:text-4xl tw:leading-tight tw:text-foreground">
        What Spideryarn Reading does
      </h1>
      {/* Greg, 2026-09-03, answer 1. */}
      <p className="tw:mt-4 tw:font-prose tw:text-xl tw:text-foreground">
        It highlights, annotates, orients and explains, but keeps you in the text itself.
      </p>

      <H2>Start with any article</H2>
      {/* Product facts: docs/project/ingest-queue.md, fetching.md, and
          src/messages.ts ADDING_SENDS_TEXT_AWAY. */}
      <p>
        Paste a URL or drop in a PDF. It comes back as the article, in a column set for reading,
        with everything below built around it. Adding an article sends its text to AI providers to
        make the notes and summaries — so add things you are allowed to share with a third party,
        not a confidential manuscript.
      </p>

      {/* Greg, 2026-09-03, answer 4. */}
      <H2>The landscape, and where you are in it</H2>
      <Shot shot={SHOTS.outline} title="Outline." eager>
        A constantly evolving table of contents that gives you a sense of the overall landscape and
        where you are in the grand scheme of things, with more detail for the current and nearby
        sections — a semantic fisheye lens.
      </Shot>
      {/* Greg, 2026-08-24, the granularity-zoom brief, compressed; the last
          sentence is docs/project/vision.md § Principles 1. */}
      <Shot shot={SHOTS.zoom} title="Zoom.">
        The article at several levels of detail at once: scroll right for more, down to progress
        through it. Scan through quickly to get a sense of the landscape, or burrow deeply. The far
        right is always the author’s own words.
      </Shot>
      {/* Greg, 2026-08-26, the diagram request, trimmed. */}
      <Shot shot={SHOTS.diagram} title="Diagram." width="tw:mx-auto tw:max-w-sm">
        Maps of the structure of the piece — its outline as a tree, its sections joined by the
        words they share, and its paragraphs placed by what they are about — with where you are
        marked on each.
      </Shot>

      <H2>The text, with a clever friend’s notes in it</H2>
      {/* Greg, 2026-09-03, follow-up to answer 4; docs/project/vision.md. */}
      <Shot shot={SHOTS.glossary} title="Glossary.">
        Notes in the margin that explain and remind you about anything you might find tricky: the
        terms this piece uses in a non-obvious way, defined from the piece itself, underlined
        wherever they occur. Point at one and the card comes to you.
      </Shot>
      {/* Greg, 2026-08-26, the ideas request. */}
      <Shot shot={SHOTS.ideas} title="Ideas." width="tw:mx-auto tw:max-w-sm">
        The new ideas the text introduces, and the key ideas it requires you to understand. A term
        is a word you look up; an idea is a claim you hold.
      </Shot>
      {/* Greg, 2026-08-31, the quotes request. */}
      <Shot shot={SHOTS.quotes} title="Quotes." width="tw:mx-auto tw:max-w-sm">
        The most central, helpful, interesting quotes, in the author’s own words. In order by
        default, or by importance, or by how memorable, striking or lyrical they are.
      </Shot>
      {/* Greg, 2025-07-14, and docs/project/search.md. */}
      <Shot shot={SHOTS.meaning} title="Search by meaning.">
        Type in basically anything — a word, a phrase, a description of what you are looking for —
        and it highlights the areas of the text that are relevant. Every hit is marked in the prose
        and painted as a lane in the strip beside it, so you can see where in the piece a theme
        lives. It leaves you as the arbiter of what is worth a closer look.
      </Shot>
      <Shot shot={SHOTS.meaningPanel} title="Every hit says how sure." width="tw:mx-auto tw:max-w-sm">
        {/* docs/project/search.md, the confidence rule. */}
        The number is the model’s own guess rather than a measurement, so the panel says so and
        gives you the slider. Run several searches at once, each in its own colour.
      </Shot>
      {/* Greg, 2026-08-31, the timeline request; product fact from timeline.md. */}
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        <Feature name="Timeline.">
          When the piece says things happened — dealing with ambiguity about dates by falling back
          to order, and showing the uncertainty rather than hiding it.
        </Feature>
        {/* Greg, 2026-08-27, the links request. */}
        <Feature name="Links.">
          Hover the author’s own hyperlinks and see something about the destination before you
          leave.
        </Feature>
      </ul>

      <H2>Ask, in place</H2>
      {/* Greg, 2026-08-28, the comments request, rephrased to the reader;
          docs/project/comments.md. */}
      <Shot shot={SHOTS.ask} title="Select a sentence.">
        That bookmarks it. Optionally add a comment. And, if you want one, ask for an answer — an
        explanation from the surrounding argument, researching the web when it judges it needs to.
        The answer starts arriving in a second or two, and the article never leaves the screen.
      </Shot>
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        {/* docs/project/chat-tools.md; docs/project/vision.md § Anti-goals. */}
        <Feature name="A chat that cites.">
          Ask a longer question and every claim in the answer links back into the article. It can
          search the piece, your library or the web — and it will not summarise the article for
          you, on purpose.
        </Feature>
        {/* Greg, 2026-08-31, the live-conversation request. */}
        <Feature name="Or say it out loud.">
          Switch into a live conversation for a bit, then type or dictate for a while, then talk
          again. The audio goes straight to the voice provider and never touches our server.
        </Feature>
      </ul>

      <H2>Find out what you kept</H2>
      {/* Greg, 2026-08-27, the review-mode request, rephrased to the reader. */}
      <Shot shot={SHOTS.remember} title="Remember." width="tw:mx-auto tw:max-w-sm">
        Type or talk about what you have taken from the piece, and get a plain, concise response:
        corrections, misunderstandings, refinements, gaps. Written not to be annoying, patronising
        or superior — you are earnestly looking to deepen your understanding, and it treats you so.
      </Shot>
      {/* Greg, 2026-08-31, the quiz request. */}
      <Shot shot={SHOTS.quiz} title="Quiz." width="tw:mx-auto tw:max-w-sm">
        Questions that need a couple of sentences each, a dozen at a time, ordered by a combination
        of ease and value: easy first then harder, central first. Marked against the article, not
        an answer key.
      </Shot>

      <H2>For peer reviewers</H2>
      {/* docs/project/referee-mode.md, its title and its four sub-modes;
          the confidentiality sentence is the one the mode itself shows. */}
      <Shot shot={SHOTS.referee} title="Referee mode.">
        Helps a referee read a paper without reading it for them. Your own criteria, streamed
        against the paper with every matching passage marked; the paper’s claims pulled out with
        where each is taken up; and a mirror that rereads your own draft comments. Nothing here
        forms the judgment for you. For preprints, open review and drafts shared with consent —
        the text goes to AI providers, so not a confidential submission.
      </Shot>

      <H2>Your shelf, and everyone’s</H2>
      {/* Greg, 2026-08-25 (library) and 2026-09-03, answer 2's postscript. */}
      <Shot shot={SHOTS.library} title="The library.">
        Every article you have added, one click from where you left off. Make one public-readable
        and it shares its expensive AI annotations, so that everyone who opens it can benefit from
        them.
      </Shot>
      <ul className="tw:mt-4 tw:flex tw:flex-col tw:gap-4">
        {/* Greg, 2026-08-26, the reader-profile request, rephrased. */}
        <Feature name="It knows who is reading.">
          Say once who you are and what you know, and for any article why you are reading it, and
          the notes are written for you.
        </Feature>
        {/* Greg, 2026-09-01: "It's the reader's data." docs/project/export.md. */}
        <Feature name="It’s the reader’s data.">
          One button exports everything Spideryarn holds about an article — the text, the ids, and
          every note and summary — as plain files.
        </Feature>
      </ul>

      <H2>Plans</H2>
      <Plans />

      <footer className="tw:mt-14 tw:border-t tw:border-border tw:pt-5 tw:text-xs tw:text-ink-faint">
        <p className="tw:m-0">
          Every screenshot is of a real article read in Spideryarn; most are of{" "}
          <em>The Mythology of AI Consciousness</em> by Anil Seth.
        </p>
        <p className="tw:mt-2 tw:mb-0">
          <Link href="/" className="tw:text-ink-faint tw:hover:text-highlight">
            Home
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
