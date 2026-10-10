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
 * The six tall band shots, which were the worst of the height, take one screen
 * between them instead of six.
 *
 * ## Every mode, and the tag — 2026-10-02
 *
 * By October the page described Outline, which was gone, and none of the seven
 * modes that had arrived since. Every mode in `MODES` now has a tile, a portrait
 * or a showcase carrying its `mode`, and tests/features-page-modes.test.tsx goes
 * red when the next one does not. Which ones are behind the experimental switch
 * is not written into any caption: SiteBits.tsx § `ExperimentalTag` reads it
 * from MODE_CATALOG, and one `[tissue]` line under the lede says what the tag
 * means. Cross-references and maths are not modes and carry no `mode`; reading
 * time is left off, being neither a mode nor for everyone.
 * docs/plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md.
 *
 * Styled with the `site-*` classes in styles/site.css — SiteBits.tsx's header
 * says which mechanism owns what.
 */
import { Link } from "./Link.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { useRevealOnce } from "./reveal-once.js";
import { WebsitePlans } from "./PlanCards.js";
import { PublicShowcase } from "./PublicShowcase.js";
import { PRICING_HREF } from "./router.js";
import { SHOTS } from "./shots.js";
import { SiteFooter } from "./SiteFooter.js";
import {
  Gallery,
  H2,
  Portrait,
  SHELL,
  Showcase,
  SiteNav,
  Tile,
} from "./SiteBits.js";

/**
 * **`signedIn` is threaded in rather than asked for here**, because App.tsx
 * already knows: this page is mounted from both of its branches, and the two
 * differ in what the top bar may honestly offer. Before the dedicated sign-in
 * page, `/#sign-in` from a signed-in reader landed on the shelf, which had no
 * such panel — a link that visibly did nothing, and the older half of GPT Sol's
 * stage 2 finding 1. It is a boolean and not a reader id because nothing on
 * this page reads a reader's data.
 */
export function FeaturesPage({ signedIn }: { signedIn: boolean }) {
  useDocumentTitle(pageTitle({ kind: "features" }));
  /* Each `.site-reveal` rises in once and stays — reveal-once.ts. */
  useRevealOnce();

  return (
    <div className="site tw:font-sans tw:text-muted-foreground">
      <SiteNav here="features" signedIn={signedIn} />

      <header className="tw:relative tw:overflow-hidden tw:pt-16 tw:pb-2">
        <div className="site-glow" />
        <div className={`${SHELL} tw:relative`}>
          <h1 className="site-display tw:max-w-[18ch]">What Spideryarn Reading does</h1>
          {/* Greg, 2026-09-03, answer 1. */}
          <p className="site-lede tw:mt-6">
            It highlights, annotates, orients and explains, but keeps you in the text itself.
          </p>
          {/* [tissue] What the tag on some modes below means. The second half
              was the Diagram caption's last sentence until 2026-10-02, moved up
              here when SiteBits.tsx began drawing the tag from MODE_CATALOG, so
              it is said once for every experimental mode. */}
          <p className="tw:mt-4 tw:max-w-[62ch] tw:text-sm tw:text-ink-faint">
            A mode tagged Experimental is one of the Experimental Features; signed-in readers turn
            these on from the bar or their profile.
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
          Adding an article sends its text to AI providers, to prepare it and to make the summaries,
          the glossary and the rest — so add things you are allowed to share
          with a third party, not a confidential manuscript.
        </p>

        {/* --------------------------------------- the landscape, and where you are --
            Greg, 2026-09-03, answer 4. */}
        <H2 eyebrow="Orient">The landscape, and where you are in it.</H2>
        {/* Structure took Outline's place on 2026-09-10 and this showcase on
            2026-10-02. Greg, 2026-09-08 (the two columns where the window is
            wide, the nested list where it is narrower) and 2026-10-01 (Fisheye
            the default, Expanded showing everything), both in
            docs/project/structure.md; the faces and the chips' words checked in
            src/web/modes/structure/StructureMode.tsx and STRUCTURE_SUB_MODES in
            src/web/sub-modes.ts. */}
        <Showcase shot={SHOTS.structure} title="Structure." mode="structure" eager under>
          The article’s parts, and the sections of the one you are reading, in two columns beside
          the text — or, where the window is narrower, one nested list. Fisheye, the default, opens
          up around where you are; Expanded shows everything, every summary visible.
        </Showcase>
        {/* Greg, 2026-09-28, docs/project/skim.md: "help the user to skim
            through the paper as effectively as possible in increasing depth",
            and "a trajectory through quotes". The three passes, the quotes as
            stops and the one-line cue are src/skim.ts (DEPTH_CAPS, the GIST /
            MORE / MOST depths, `cue`: "what to look for in that passage"). A
            picture rather than a tile since the 2026-10-02 retake: Greg,
            2026-09-29, "I'm increasingly thinking of the trajectory mode as one
            of the main modes". */}
        <Showcase shot={SHOTS.skim} title="Skim." mode="skim" offset under>
          Skim the paper in increasing depth: a route through its quotes, walked three times — the
          gist, then more, then most — with a question to read a stop with where one helps.
        </Showcase>
        {/* Alone rather than in a Gallery: one portrait in a three-column grid
            sits in the left third with two empty cells beside it, which reads as
            a layout that lost something. Centred for the same reason — hard
            left, it strands two thirds of the row. */}
        <div className="site-reveal tw:mx-auto tw:my-12 tw:max-w-sm">
          {/* Greg, 2026-08-26, the diagram request, trimmed, and 2026-09-03
              for Illustrated. The five names are DIAGRAMS in src/web/diagram.ts
              and the picture is the first of them. Counted in the code: this
              said "the other three" on the afternoon there were four. The
              mode went behind the switch on 2026-09-29; since 2026-10-02 the
              tag says so, and the sentence that did is under the lede. */}
          {/* Pictured is `sketch` since the 2026-10-02 retake — the one kind an
              ordinary reader's band offers (src/web/sub-modes.ts); it was
              `force`. The sentences were reordered to match, not rewritten. */}
          <Portrait shot={SHOTS.sketch} title="Diagram." mode="diagram">
            Maps of the structure of the piece, with where you are marked on each. Pictured:{" "}
            <strong className="tw:text-foreground">sketch</strong>, drawn by the model. The other
            four: <em>force</em>, the sections as dots, joined where they share distinctive words;{" "}
            <em>drift</em> and <em>trail</em>, one dot per paragraph placed by what it is about; and{" "}
            <em>illustrated</em>, that same scene painted.
          </Portrait>
        </div>
        <div className="site-bento site-reveal tw:mt-4">
          {/* Greg, 2026-08-26, the summary request; 2026-09-30, the plain-words
              levels; 2026-10-01, the outline removed (spya-b3ggv4, plan 261001p).
              Summary mode, src/web/modes/summary/SummaryMode.tsx. */}
          <Tile name="Summary." mode="summary" span="wide">
            The piece in plain words — brief or a little fuller — each paragraph linked to the
            passages it rests on, beside the prose, never instead of it.
          </Tile>
          {/* Plain mode: the article alone, with the band closed. */}
          <Tile name="Or just the article." mode="plain" span="wide">
            Plain mode is the prose and nothing else. Every other mode is a step away from it and a
            step back.
          </Tile>
        </div>

        {/* ------------------------------------ the text, with a friend's notes in it -- */}
        <H2 eyebrow="Annotate">The text, with a clever friend’s notes in it.</H2>
        {/* Greg, 2026-09-03, follow-up to answer 4; docs/project/vision.md. */}
        <Showcase shot={SHOTS.glossary} title="Glossary." mode="glossary" under>
          Notes in the margin that explain and remind you about anything you might find tricky: the
          terms this piece uses in a non-obvious way, defined from the piece itself, underlined
          wherever they occur. Point at one and the card comes to you.
        </Showcase>
        {/* Greg, 2025-07-14, and docs/project/search.md. */}
        <Showcase shot={SHOTS.meaning} title="Search by meaning." mode="search" offset under>
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
          <Portrait shot={SHOTS.ideas} title="Ideas." mode="ideas">
            The new ideas the text introduces, and the key ideas it requires you to understand —
            split into what you need to bring and what this piece adds.
          </Portrait>
          {/* Greg, 2026-08-31, the quotes request. */}
          <Portrait shot={SHOTS.quotes} title="Quotes." mode="quotes">
            The most central, helpful, interesting quotes, in the author’s own words. In order by
            default, or by importance, or by how memorable, striking or lyrical they are.
          </Portrait>
          {/* docs/project/search.md, the confidence rule. */}
          <Portrait shot={SHOTS.meaningPanel} title="Every hit says how sure." mode="search">
            The number is the model’s own guess rather than a measurement, so the panel says so and
            gives you the slider. Run several searches at once, each in its own colour.
          </Portrait>
        </Gallery>
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-31, the timeline request; product fact from timeline.md. */}
          <Tile name="Timeline." span="wide" mode="timeline">
            When the piece says things happened — dealing with ambiguity about dates by falling back
            to order, and showing the uncertainty rather than hiding it.
          </Tile>
          {/* Greg, 2026-08-27, the links request. */}
          <Tile name="Links." span="wide">
            Hover the author’s own hyperlinks and see something about the destination before you
            leave.
          </Tile>
          {/* Greg (the admin who filed it), 2026-09-11, SPIDERYARN-READING2-2Y,
              the citations request in docs/project/bibliography.md, rephrased to
              the reader. "Where there is one", because not every work gets an
              address (src/public/dto.ts § `publicCitationUrl`, and the
              80-work cap in docs/project/bibliography.md). The orders are
              `orderOptions` in src/web/BibliographyPanel.tsx: prioritised, first
              cited, relevance, influence. Sources' Bibliography since
              2026-10-09, titled with the sub-mode's name (plan 261009l). */}
          <Tile name="Bibliography." span="wide" mode="sources">
            The works the piece cites — in its bibliography, its footnotes or the text itself — with a
            link out where there is one, in the order it first cites them, by how relevant or
            influential each is, or prioritised.
          </Tile>
          {/* Greg, 2026-09-30 (SPIDERYARN-READING2-7E): "marginalia-snippets
              that scrolls with the text, i.e. anchored to the blocks visible on
              screen", with "socratic-questions for what each section is
              answering"; and 2026-10-01 (7K), the right-hand column "for
              annotations anchored to the blocks". Both in
              docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
              What it draws is src/web/marginalia/notes.ts: one question per
              part, and a stamp where an idea occurs — only once the article's
              Ideas exist, because Marginalia never starts that job. */}
          <Tile name="Marginalia." span="wide" mode="marginalia">
            Notes in a column to the right of the text, anchored to the paragraphs they sit beside and
            scrolling with them: the question each part is answering and, once its Ideas have been
            made, where each idea first appears.
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
          <Tile name="A chat that cites." span="wide" mode="chat">
            Ask a longer question, and whenever the answer says what the article says, it links to
            the passage. It can search the piece, your library or the web — and it does not
            summarise the article unless you ask it to. You are reading it.
          </Tile>
          {/* Greg, 2026-08-31, the live-conversation request. */}
          <Tile name="Or say it out loud." span="wide" mode="chat">
            Switch into a live conversation for a bit, then type or dictate for a while, then talk
            again. The audio goes straight to the voice provider and never touches our server.
          </Tile>
          {/* Greg, 2026-09-29 (SPIDERYARN-READING2-5D), in docs/project/faq.md:
              each question rated "for something like how difficult and how
              central", "a prioritized ordering by default with a threshold".
              That every answer is the piece's own passages is src/faq.ts and
              src/web/FaqPanel.tsx; the order is `centrality × (1 − difficulty)`
              there. Not MODE_CATALOG's description, which an agent wrote (Sol
              plan review #5). */}
          <Tile name="FAQ." span="wide" mode="faq">
            Questions about the piece, each answered with the piece’s own passages — rated for how
            difficult and how central, and shown in a prioritised order with a threshold.
          </Tile>
          {/* Greg, 2026-09-05, the debate request: "gathers from the wider web
              about the article, e.g. reviews, critiques, etc (ideally from
              authoritative sources)", with "citation/linking"; and 2026-09-30
              (SPIDERYARN-READING2-6M), "key themes" and "key nodes". Both in
              docs/project/reception.md; the themes and key sources are
              src/reception-themes.ts. Sources' Reception since 2026-10-09,
              titled with the sub-mode's name (plan 261009l). */}
          <Tile name="Reception." span="wide" mode="sources">
            What the wider web says about the piece — reviews and critiques, ideally from
            authoritative sources, each linked — with the key themes and the key sources drawn out.
          </Tile>
        </div>

        {/* --------------------------------------------------- what you kept -- */}
        <H2 eyebrow="Internalise">Find out what you kept.</H2>
        <Gallery>
          {/* Greg, 2026-08-27, the review-mode request, rephrased to the reader. */}
          <Portrait shot={SHOTS.learn} title="Learn." mode="learn">
            Type or talk about what you remember of the piece. Short replies correct what comes apart
            from it, link the passage, and usually nudge you to remember a little more — filling the
            gap when you are stuck rather than making you fail. Written not to be annoying,
            patronising or superior. Or choose Tutorial: short turns that teach a little of the piece
            at a time and ask you to put it in your own words. Or Explore, one of the Experimental
            Features, which starts from what you have marked and helps you work out what you think.
          </Portrait>
          {/* Greg, 2026-08-31, the quiz request; and 2026-09-29
              (SPIDERYARN-READING2-5W, quoted in src/quiz.ts's header), which
              replaced its order: questions where "only a sentence or two is
              needed", that "build on one another gradually" towards "the key
              takeaways". The first sentence was false since 2026-09-30 — "a
              dozen at a time" and "ordered by a combination of ease and value"
              were the retired batch of twelve sorted by band and value; it is
              now a path of up to MAX_QUESTIONS = 20 that nothing re-sorts.
              Only that sentence changed. A Learn sub-mode, so `learn`. */}
          <Portrait shot={SHOTS.quiz} title="Quiz." mode="learn">
            Questions that need a sentence or two each, up to twenty at a time, each building on the
            one before towards the piece’s key takeaways. Marked against the article, not an answer
            key.
          </Portrait>
        </Gallery>

        {/* ------------------------------------------------- for peer reviewers -- */}
        <H2 eyebrow="A mode for one job">For peer reviewers.</H2>
        {/* docs/project/referee-mode.md, its title and its five sub-modes; the
            confidentiality sentence is the one the mode itself shows. */}
        <Showcase shot={SHOTS.referee} title="Referee mode." mode="referee" offset under>
          Helps a referee read a paper without reading it for them. Your own criteria, streamed
          against the paper with every matching passage marked; the paper’s claims pulled out with
          where each is taken up; and a mirror that rereads your own draft comments. Nothing here
          forms the judgment for you. For preprints, open review and drafts shared with consent —
          the text goes to AI providers, so not a confidential submission.
        </Showcase>

        {/* -------------------------------------------- your shelf, and everyone's -- */}
        <H2 eyebrow="Your library">Your shelf, and everyone’s.</H2>
        {/* Greg, 2026-08-25 (library) and 2026-09-03, answer 2's postscript.
            **Corrected 2026-10-02, because it was false**: the last sentence
            said "your own comments, chats and searches stay yours", while
            src/public/dto.ts (`publicComments`; `searches` in
            src/public-types.ts) gives a
            public article's visitors the owner's comments and searches, and
            PrivacyPage.tsx said so. Only the chats and the profile stay
            behind. The list of what is shared lost "gists", and follows
            PrivacyPage's names. This must keep agreeing with PrivacyPage.tsx;
            tests/marketing-public-sharing.test.tsx asks. */}
        <Showcase shot={SHOTS.library} title="The library." under>
          Every article you have added, one click from where you left off. Make one public-readable
          and it shares its expensive AI annotations — the outline, summaries, glossary, ideas,
          quotes and the rest — so that everyone who opens it can benefit from them. Your comments
          and searches go with it; your chats and your profile are not shared.
        </Showcase>
        {/* **The claim above, with the evidence under it.** The paragraph in
            that showcase is the strongest thing this page says about public
            articles, and until 2026-09-05 a stranger had no way to check it
            short of signing up. Every link in the block is derived from the
            listing `/read/public` draws, so an article Greg unshares leaves
            nothing behind here — PublicShowcase.tsx has the argument and the
            two mechanisms it was chosen over. */}
        <PublicShowcase />
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-26, the reader-profile request, rephrased. */}
          <Tile name="It knows who is reading." span="wide">
            Say once who you are and what you know, and for any article why you are reading it, and
            what the AI writes is written for you.
          </Tile>
          {/* Greg, 2026-09-01: "It's the reader's data." docs/project/export.md. */}
          <Tile name="It’s the reader’s data." span="wide">
            One button exports everything Spideryarn holds about an article — the text, the ids, and
            every note and summary — as plain files.
          </Tile>
        </div>

        {/* -------------------------------------------------------- elsewhere --
            [tissue] heading. Tweets is a mode and out from behind the switch;
            cross-references and maths are not modes and are drawn for every
            reader in every mode (src/web/useCrossrefs.ts from
            src/web/article/ArticlePage.tsx unconditionally;
            `renderArticleMaths` in src/web/article/access.ts). */}
        <H2 eyebrow="Elsewhere">And a few more.</H2>
        <div className="site-bento site-reveal">
          {/* Greg, 2026-08-25, "the Tweet Thread view"; 2026-09-12, that it
              starts writing when opened; 2026-09-29, a column alongside the
              text with block links back to relevant passages. The two limits
              are product facts from src/web/useTweets.ts (only an owner's
              absent thread auto-runs) and src/tweets.ts § `checkBlocks` plus
              src/web/Tweets.tsx § `UnlinkedNote` (a post can have no surviving
              passage id, and threads from before tweets/5 have none). GPT Sol's
              code review caught the first draft promising both without the
              limits; "the passages they came from" is unqualified because a
              post with no surviving id says so in place (`UnlinkedNote`).
              2026-10-03: the thread is Summary's Thread view, so the tile is
              tagged with Summary and says where to find it (plan 261003l). */}
          <Tile name="Thread." mode="summary">
            The piece as a thread, in Summary’s Thread view: a column beside the text, written the
            first time you open it on an article of your own. Posts link back to the passages they
            came from.
          </Tile>
          {/* Greg, 2026-09-30, docs/project/cross-references.md, rephrased to
              the reader: "if it describes a result, then it would create an
              anchor link to the block that actually [has] the results in
              detail … So you can always jump around the paper to get to the
              thing being described", with "a rich tooltip … that would preview
              that linked-to block". */}
          <Tile name="Cross-references.">
            Where the piece describes a result it reports in detail elsewhere, the phrase links to
            that passage, with a preview when you point at it. So you can always jump around the
            paper to get to the thing being described.
          </Tile>
          {/* Greg, 2026-09-12 (SPIDERYARN-READING2-30), docs/project/maths.md:
              equations and formulae shown as raw LaTeX — "Can we somehow render
              them … to display them nicely within the text?" Drawn as MathML,
              src/web/maths.ts. */}
          <Tile name="Maths.">
            Equations and formulae written in LaTeX are displayed as maths, nicely, within the text.
          </Tile>
        </div>

        {/* [tissue]; "reading is never gated" is Greg, 2026-09-02, and the
            rule PlanCards.tsx states in full. */}
        <H2 eyebrow="Plans">Simple, and reading is never gated.</H2>
        <div className="site-reveal">
          {/* **Only for a stranger.** Signed in, this row is three facts about
              an account the reader already has; a *Recommended* eyebrow over
              the middle one is then either a downgrade or the plan they are on.
              PlanCards.tsx § `recommended`. */}
          <WebsitePlans recommend={!signedIn} />
          {/* [tissue] The same link, in the same shape, as the one under the
              plans on the landing page — added here on 2026-09-04 when
              `/pricing` became the page you buy on. These cards carry no
              buttons (no `action` is passed, on either marketing page), so
              without this the one page that can take the press is reachable
              only from the bar and the footer. */}
          {/* Greg, 2026-09-30 (SPIDERYARN-READING2-6C): High-powered AI "should
              double the processing cost per-article". Priced in articles, never
              in money. docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md. */}
          <p className="tw:mt-6 tw:max-w-[62ch] tw:leading-relaxed">
            <strong className="tw:text-foreground">High-powered AI.</strong> Claude Opus instead of
            Sonnet for one article, when the reading is hard (plain-words summaries are on Opus
            already). Switching it on counts as one more
            article against your allowance, half of one while it is public.
          </p>
          <p className="tw:mt-6 tw:text-sm">
            <Link
              href={PRICING_HREF}
              className="tw:text-highlight-text tw:no-underline tw:hover:underline"
            >
              Pricing, and what a month’s allowance means →
            </Link>
          </p>
        </div>

        {/* **This page used to end twice**, and the second ending is gone since
            2026-09-08. An orange *← Back to the front page · Ask us something*
            row sat exactly here, immediately above a footer that already offers
            Home and Contact — so a reader got the same two destinations twice in
            fifty pixels, the second time in a louder colour.

            Its right-hand half was also a `mailto:hello@spideryarn.com`, which
            is the thing Greg took out of the footer on 2026-09-06: *"Remove the
            hello@spideryarn.com from the footer — just keep the Contact page,
            which already points to that — that's sufficient."* That decision was
            made about the footer and this row survived it one page over, which
            is what an inventory pinned in a test catches and a rule in a comment
            does not.

            No `here`: this page's route says `features`, so the row drops its
            own link without being told. Only the two pages `App.tsx` uses as
            fallbacks have to declare themselves — SiteFooter.tsx § `here`. */}
        <SiteFooter>
          {/* [tissue]. It began *"Spideryarn Reading — beta. Every screenshot…"*, which
              was right when the footer was one grey line and this was the only
              thing in it naming the product. Since 2026-09-08 the row carries a
              wordmark above this sentence and a `© … · beta` colophon below it,
              so the old prefix said the name twice and "beta" twice inside forty
              pixels. The claim about the pictures — the part that is actually
              this page speaking about itself — is untouched. */}
          Every screenshot here is of a real article read in Spideryarn.
        </SiteFooter>
      </main>
    </div>
  );
}
