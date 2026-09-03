/**
 * `/features` — what the thing does, mode by mode, with pictures.
 *
 * The landing page is the pitch and shows four things. This is the rest, for the
 * person who has read the pitch and wants to know what they would actually get.
 * Reachable signed out, like `/privacy`, and for the same reason: the person who
 * wants it is deciding whether to sign up.
 *
 * ## Where the words come from
 *
 * Same rule as LandingPage.tsx, same three kinds, same marks: **Greg's words**
 * from a dated quote (the comment beside each says which), **product facts**
 * checked against the code, and **connective tissue** marked `[tissue]`. Ten of
 * the fourteen interview questions were still unanswered when this was written
 * (docs/research/260902k-spideryarn-reading-interview-guide.md), so for those
 * modes the words are his older ones, from the feature docs — the request that
 * built the mode, which is usually the clearest sentence about what it is for.
 *
 * ## The order, and the shape — restructured 2026-09-03
 *
 * The reading order he gave the product: get the landscape, go into the text,
 * ask, keep something. Then the mode for a specific job (referees), then the
 * shelf, the plans, and the one sentence about where the text goes. That order
 * is unchanged.
 *
 * What changed is the shape. This page was **thirteen full-width screenshots
 * stacked vertically, 11,042px of it**, which is impressive to no one. Now each
 * group leads with one or two landscape `Showcase` shots, and the group's other
 * modes follow as either three portraits across (`Gallery`) or plain `Tile`s.
 * Same thirteen pictures; the six tall band shots, which were the worst of the
 * height, now take one screen between them instead of six.
 *
 * Styled with the `site-*` classes at the foot of styles.css — SiteBits.tsx's
 * header says which mechanism owns what.
 */
import { CONTACT_EMAIL } from "../site-text.js";
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { Plans } from "./Plans.js";
import { SHOTS } from "./shots.js";
import {
  Gallery,
  H2,
  Portrait,
  SHELL,
  Showcase,
  SiteFooter,
  SiteNav,
  Tile,
} from "./SiteBits.js";

export function FeaturesPage() {
  useDocumentTitle(pageTitle({ kind: "features" }));

  return (
    <div className="site tw:font-sans tw:text-muted-foreground">
      <SiteNav here="features" />

      <header className="tw:relative tw:overflow-hidden tw:pt-16 tw:pb-2">
        <div className="site-glow" />
        <div className={`${SHELL} tw:relative`}>
          <h1 className="site-display tw:max-w-[18ch]">What Spideryarn Reading does</h1>
          {/* Greg, 2026-09-03, answer 1. */}
          <p className="site-lede tw:mt-6">
            It highlights, annotates, orients and explains, but keeps you in the text itself.
          </p>
        </div>
      </header>

      <main className={SHELL}>
        <H2 eyebrow="To begin">Start with any article.</H2>
        {/* Product facts: docs/project/ingest-queue.md, fetching.md, and
            src/messages.ts ADDING_SENDS_TEXT_AWAY. */}
        <p className="site-reveal tw:max-w-[62ch] tw:leading-relaxed">
          Paste a URL or drop in a PDF. It comes back as the article, in a column set for reading,
          with everything below built around it.
        </p>
        {/* The confidentiality warning is right and must stay. Set smaller and
            under the paragraph rather than inside it: it is true, and it is a
            dispiriting second sentence for a stranger to read. */}
        <p className="site-reveal tw:mt-3 tw:max-w-[62ch] tw:text-sm tw:text-ink-faint">
          Adding an article sends its text to AI providers to make the notes and summaries — so add
          things you are allowed to share with a third party, not a confidential manuscript.
        </p>

        {/* --------------------------------------- the landscape, and where you are --
            Greg, 2026-09-03, answer 4. */}
        <H2 eyebrow="Orient">The landscape, and where you are in it.</H2>
        <Showcase shot={SHOTS.outline} title="Outline." eager under>
          A constantly evolving table of contents that gives you a sense of the overall landscape
          and where you are in the grand scheme of things, with more detail for the current and
          nearby sections — a semantic fisheye lens.
        </Showcase>
        {/* Greg, 2026-08-24, the granularity-zoom brief, compressed; the last
            sentence is docs/project/vision.md § Principles 1. */}
        <Showcase shot={SHOTS.zoom} title="Zoom, in Hierarchy mode." offset under>
          The article at several levels of detail at once: scroll right for more, down to progress
          through it. Scan through quickly to get a sense of the landscape, or burrow deeply — and
          the full text is always there beside it.
        </Showcase>
        {/* Alone rather than in a Gallery: one portrait in a three-column grid
            sits in the left third with two empty cells beside it, which reads as
            a layout that lost something. Centred for the same reason — hard
            left, it strands two thirds of the row. */}
        <div className="site-reveal tw:mx-auto tw:my-12 tw:max-w-sm">
          {/* Greg, 2026-08-26, the diagram request, trimmed, and 2026-09-03
              for Illustrated. The five names are DIAGRAMS in src/web/diagram.ts
              and the picture is the first of them. Counted in the code: this
              said "the other three" on the afternoon there were four. */}
          <Portrait shot={SHOTS.diagram} title="Diagram.">
            Maps of the structure of the piece, with where you are marked on each. Pictured:{" "}
            <strong className="tw:text-foreground">force</strong>, the sections as dots, joined
            where they share distinctive words. The other four: <em>drift</em> and <em>trail</em>,
            one dot per paragraph placed by what it is about; <em>sketch</em>, drawn by the model;
            and <em>illustrated</em>, that same scene painted.
          </Portrait>
        </div>
        <div className="site-bento site-reveal tw:mt-4">
          {/* Greg, 2026-08-26, the summary request, and 2026-08-31 ("just
              keeping 'Gist' only is sufficient"). Summary mode, src/modes.ts. */}
          <Tile name="Summary." span="wide">
            One sentence on every part of the piece, and every section of every part, as deep as you
            ask — beside the prose, never instead of it.
          </Tile>
          {/* Plain mode: the article alone, with the band closed. */}
          <Tile name="Or just the article." span="wide">
            Plain mode is the prose and nothing else. Every other mode is a step away from it and a
            step back.
          </Tile>
        </div>

        {/* ------------------------------------ the text, with a friend's notes in it -- */}
        <H2 eyebrow="Annotate">The text, with a clever friend’s notes in it.</H2>
        {/* Greg, 2026-09-03, follow-up to answer 4; docs/project/vision.md. */}
        <Showcase shot={SHOTS.glossary} title="Glossary." under>
          Notes in the margin that explain and remind you about anything you might find tricky: the
          terms this piece uses in a non-obvious way, defined from the piece itself, underlined
          wherever they occur. Point at one and the card comes to you.
        </Showcase>
        {/* Greg, 2025-07-14, and docs/project/search.md. */}
        <Showcase shot={SHOTS.meaning} title="Search by meaning." offset under>
          Type in basically anything — a word, a phrase, a description of what you are looking for —
          and it highlights the areas of the text that are relevant. Every hit is marked in the
          prose and painted as a lane in the strip beside it, so you can see where in the piece a
          theme lives. It leaves you as the arbiter of what is worth a closer look.
        </Showcase>
        <Gallery>
          {/* Greg, 2026-08-26, the ideas request, and nothing else: question 7
              of the interview is unanswered, so the line that used to follow
              this ("a term is a word you look up; an idea is a claim you hold",
              from vision.md, an agent's) is out until he says it or something
              like it. */}
          <Portrait shot={SHOTS.ideas} title="Ideas.">
            The new ideas the text introduces, and the key ideas it requires you to understand —
            split into what you need to bring and what this piece adds.
          </Portrait>
          {/* Greg, 2026-08-31, the quotes request. */}
          <Portrait shot={SHOTS.quotes} title="Quotes.">
            The most central, helpful, interesting quotes, in the author’s own words. In order by
            default, or by importance, or by how memorable, striking or lyrical they are.
          </Portrait>
          {/* docs/project/search.md, the confidence rule. */}
          <Portrait shot={SHOTS.meaningPanel} title="Every hit says how sure.">
            The number is the model’s own guess rather than a measurement, so the panel says so and
            gives you the slider. Run several searches at once, each in its own colour.
          </Portrait>
        </Gallery>
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-31, the timeline request; product fact from timeline.md. */}
          <Tile name="Timeline." span="wide">
            When the piece says things happened — dealing with ambiguity about dates by falling back
            to order, and showing the uncertainty rather than hiding it.
          </Tile>
          {/* Greg, 2026-08-27, the links request. */}
          <Tile name="Links." span="wide">
            Hover the author’s own hyperlinks and see something about the destination before you
            leave.
          </Tile>
        </div>

        {/* ------------------------------------------------------------- ask -- */}
        <H2 eyebrow="Interrogate">Ask, in place.</H2>
        {/* Greg, 2026-08-28, the comments request, rephrased to the reader;
            docs/project/comments.md. */}
        <Showcase shot={SHOTS.ask} title="Select a sentence." under>
          That bookmarks it. Optionally add a comment. And, if you want one, ask for an answer — an
          explanation from the surrounding argument, researching the web when it judges it needs to.
          The answer streams in as it is written, and the article never leaves the screen.
        </Showcase>
        <div className="site-bento site-reveal">
          {/* docs/project/chat-tools.md, and the two rules in src/converse.ts: a
              statement about the article cites its block; no summarising unless
              the reader asks. */}
          <Tile name="A chat that cites." span="wide">
            Ask a longer question, and whenever the answer says what the article says, it links to
            the passage. It can search the piece, your library or the web — and it does not
            summarise the article unless you ask it to. You are reading it.
          </Tile>
          {/* Greg, 2026-08-31, the live-conversation request. */}
          <Tile name="Or say it out loud." span="wide">
            Switch into a live conversation for a bit, then type or dictate for a while, then talk
            again. The audio goes straight to the voice provider and never touches our server.
          </Tile>
        </div>

        {/* --------------------------------------------------- what you kept -- */}
        <H2 eyebrow="Internalise">Find out what you kept.</H2>
        <Gallery>
          {/* Greg, 2026-08-27, the review-mode request, rephrased to the reader. */}
          <Portrait shot={SHOTS.remember} title="Remember.">
            Type or talk about what you have taken from the piece, and get a plain, concise
            response: corrections, misunderstandings, refinements, gaps. Written not to be annoying,
            patronising or superior — you are earnestly looking to deepen your understanding, and it
            treats you so.
          </Portrait>
          {/* Greg, 2026-08-31, the quiz request. */}
          <Portrait shot={SHOTS.quiz} title="Quiz.">
            Questions that need a couple of sentences each, a dozen at a time, ordered by a
            combination of ease and value: easy first then harder, central first. Marked against the
            article, not an answer key.
          </Portrait>
        </Gallery>

        {/* ------------------------------------------------- for peer reviewers -- */}
        <H2 eyebrow="A mode for one job">For peer reviewers.</H2>
        {/* docs/project/referee-mode.md, its title and its four sub-modes; the
            confidentiality sentence is the one the mode itself shows. */}
        <Showcase shot={SHOTS.referee} title="Referee mode." offset under>
          Helps a referee read a paper without reading it for them. Your own criteria, streamed
          against the paper with every matching passage marked; the paper’s claims pulled out with
          where each is taken up; and a mirror that rereads your own draft comments. Nothing here
          forms the judgment for you. For preprints, open review and drafts shared with consent —
          the text goes to AI providers, so not a confidential submission.
        </Showcase>

        {/* -------------------------------------------- your shelf, and everyone's -- */}
        <H2 eyebrow="Your library">Your shelf, and everyone’s.</H2>
        {/* Greg, 2026-08-25 (library) and 2026-09-03, answer 2's postscript.
            What a public visitor gets is the generated work, not the owner's
            comments, chats or searches — PrivacyPage.tsx says so, and this must
            agree with it. */}
        <Showcase shot={SHOTS.library} title="The library." under>
          Every article you have added, one click from where you left off. Make one public-readable
          and it shares its expensive AI annotations — the outline, gists, glossary, ideas and
          quotes — so that everyone who opens it can benefit from them. Your own comments, chats and
          searches stay yours.
        </Showcase>
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-26, the reader-profile request, rephrased. */}
          <Tile name="It knows who is reading." span="wide">
            Say once who you are and what you know, and for any article why you are reading it, and
            the notes are written for you.
          </Tile>
          {/* Greg, 2026-09-01: "It's the reader's data." docs/project/export.md. */}
          <Tile name="It’s the reader’s data." span="wide">
            One button exports everything Spideryarn holds about an article — the text, the ids, and
            every note and summary — as plain files.
          </Tile>
        </div>

        {/* [tissue]; "reading is never gated" is Greg, 2026-09-02, and the
            rule Plans.tsx states in full. */}
        <H2 eyebrow="Plans">Simple, and reading is never gated.</H2>
        <div className="site-reveal">
          <Plans />
        </div>

        <p className="tw:mt-14 tw:text-sm">
          <Link href="/" className="tw:text-highlight tw:no-underline tw:hover:underline">
            ← Back to the front page
          </Link>
          {" · "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="tw:text-highlight tw:no-underline tw:hover:underline"
          >
            Ask us something
          </a>
        </p>

        <SiteFooter here="features" />
      </main>
    </div>
  );
}
