/**
 * **The article page a visitor gets instead of the owner's** — two until the
 * thread became a mode on 2026-09-29 and got a visitor band instead.
 *
 * `Metadata` and `Tweets` are not reachable from `VisitorArticle`, and that is
 * the seam rather than an omission. Between them they mount the profile boxes,
 * the "why you're reading this one" textarea, the Delete button, a fetch of
 * `GET /api/metadata/:slug` and — in `Tweets` — `useJobs`, which polls the
 * private job list for ever. Every one of those is an authenticated request a
 * visitor would make and be refused, which is the stream of 401s behind a
 * correct-looking page that the capability seam exists to prevent.
 *
 * So: a different, smaller metadata page, and a plain notice where the tweet
 * thread would be. Both draw from what the visitor already has — the one
 * `GET /api/public/article/:slug` the reading view made — and neither fetches
 * anything of its own. There was a second public route until 2026-09-02; this
 * page never called it either.
 */
import { ExternalLink } from "lucide-react";

import type { Article, SourceGuess } from "../types.js";
import type { PublicArtefacts } from "../public-types.js";
import {
  BANNER_SOURCE_GUESS_CANONICAL,
  BANNER_SOURCE_GUESS_MATCHING,
  SHARED_LINK_CARRIES,
  TAKEDOWN_LINK,
} from "../messages.js";
import { Dock } from "./Dock.js";
import { BackLink } from "./BackLink.js";
import { Link } from "./Link.js";
import { carriedSearch, readHref, TAKEDOWN_HREF, type ArticleView } from "./router.js";
import { webSource } from "./SourceLink.js";
import { articleStats } from "./stats.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SharedNotice } from "./PublicChrome.js";
import { GuessedSourceLink } from "./Masthead.js";
import { markedModes, NOUN } from "./visitor.js";
import { useExperimental } from "./useExperimental.js";
import { articleTitleVoice, withVoice } from "./voice.js";

/**
 * The link out to the publisher, the source page found for an upload, or
 * nothing.
 *
 * Nothing rather than a line saying there is no link: this page is short and a
 * visitor has no way to act on the difference. The owner's page does say it,
 * because on that one the absence is a fact about their own library
 * (src/web/Metadata.tsx § `Origin`).
 */
function SourceRow({ url, guess }: { url: string | null; guess: SourceGuess | undefined }) {
  if (url !== null) {
    return (
      <p className="tw:m-0 tw:mb-6 tw:text-xs">
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="tw:inline-flex tw:items-center tw:gap-1 tw:break-all tw:text-highlight"
        >
          {url}
          <ExternalLink size={12} className="tw:shrink-0" />
        </a>
      </p>
    );
  }
  if (guess?.status !== "found") return <div className="tw:mb-6" />;
  return (
    <p className="tw:m-0 tw:mb-6 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-1.5 tw:text-xs tw:text-muted-foreground">
      <span>
        {guess.kind === "canonical" ? BANNER_SOURCE_GUESS_CANONICAL : BANNER_SOURCE_GUESS_MATCHING}
      </span>
      <GuessedSourceLink guess={guess} className="origin-link origin-guess" viewer="visitor" />
    </p>
  );
}

/** Room for the bottom bar, so the last line of a page is not under it. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-space)_+_2rem)]";

/**
 * And room at the top, which is `--safe-top` for the clock and 2.5rem of
 * ordinary breathing space — Metadata.tsx carries the whole note.
 *
 * **It was 3.5rem in three places until 2026-09-06**, the extra rem being room
 * for the corner wordmark, which these pages draw in their `Dock` now. Three
 * copies is how it came to be missed when the plan was written: it counted the
 * two owner-side `main`s and not these (GPT Sol, G4,
 * docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md).
 * One name, so the next reader has one thing to change.
 */
const TOP_CLEARANCE = "tw:pt-[calc(2.5rem_+_var(--safe-top))]";

/**
 * What a visitor is told about the article, which is a different question from
 * what the owner's page answers.
 *
 * The owner's metadata page answers *which stage ran, when, into which column,
 * over how many bytes, and would we write it again today* — internal paths,
 * column names and run times, none of it a visitor's business and most of it
 * about our pipeline rather than about the piece. `PublicArtefacts` replaces
 * the lot with five booleans, and this page is those five booleans plus what is
 * already in the article payload. src/public-types.ts.
 */
export function PublicMetadataPage({
  slug,
  article,
  available,
  signedIn,
  sessionUnconfirmed,
}: {
  slug: string;
  article: Article;
  available: PublicArtefacts;
  /** For the call to action only — reader-capability.ts § signedIn. */
  signedIn: boolean;
  /** For the notice below only — reader-capability.ts § sessionUnconfirmed. */
  sessionUnconfirmed: boolean;
}) {
  const { meta } = article;
  const stats = articleStats(article);
  useDocumentTitle(pageTitle({ kind: "read", title: meta.title, view: "metadata" }));

  const facts = [meta.byline, meta.siteName, meta.lang].filter(Boolean) as string[];

  return (
    <>
      <main className={`tw:mx-auto tw:max-w-3xl tw:px-6 ${TOP_CLEARANCE} tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1
          className={withVoice("tw:m-0 tw:mb-2 tw:text-2xl tw:leading-snug tw:text-foreground", articleTitleVoice(false))}
        >
          {meta.title}
        </h1>
        {facts.length > 0 && (
          <p className="tw:m-0 tw:mb-2 tw:text-sm tw:text-ink-faint">{facts.join(" · ")}</p>
        )}
        {/* **Where the piece came from, for a visitor too.** Greg, 2026-08-30:
            *"I think Public-readable articles should show their provenance-url
            to all reader[s]."* The owner's page grew this the same day and this
            one was missed — the two pages answer the same question about the
            same article, so a fact that is a visitor's business on one of them
            is a visitor's business on both. GPT Sol found the gap.

            `meta.url` here is `PublicMeta.url`, already through
            `publicSourceUrl` on the server (src/urls.ts); `webSource` is the
            client's own refusal of anything that is not `http(s)`, said once for
            this page and the masthead.

            **And no "uploaded" arm**, unlike the owner's page. An absent url
            here means an upload *or* an address the policy withheld. Only a
            separately projected found guess can add a source link; it still
            does not disclose which absence was behind it. */}
        <SourceRow url={webSource(meta)} guess={article.sourceGuess} />

        <SharedNotice signedIn={signedIn} sessionUnconfirmed={sessionUnconfirmed} />

        <section className="tw:mt-8">
          <h2 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">The piece</h2>
          <p className="tw:m-0 tw:text-sm tw:text-ink-faint">
            {stats.words.toLocaleString()} words · about {stats.minutes} min · {stats.parts} parts ·{" "}
            {stats.sections} sections
          </p>
        </section>

        <section className="tw:mt-8">
          <h2 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            What has been built for it
          </h2>
          {/* **Only what exists, never how it was made.** No paths, no
              timestamps, no byte counts, no generator versions — that is the
              whole difference between this page and the owner's, and the reason
              `PublicArtefacts` is five booleans rather than a projection of
              `ArticleMetadata`. */}
          {/* **No "we could not check" arm any more**, and its absence is the
              slice. These five used to come from a second request whose failure
              was swallowed to `null`; they are derived from the article payload
              this page is already drawing, so either it arrived or the reader is
              looking at *this document isn't shared*.
              src/web/public-artefacts.ts. */}
          {/* **Walked, not written out**, since 2026-09-02. Four of the five
              were listed here by hand and `quotes` was missing — so a visitor
              reading a shared article that has quotes was told nothing about
              them, under a heading promising what has been built. Nothing was
              wrong with the flag; the list simply did not mention it. `NOUN`
              (src/web/visitor.ts) is the same table the reading view's gap
              sentences come from, so the two cannot call one artefact by two
              names, and a sixth appears here without anybody remembering to
              come back. */}
          <ul className="tw:m-0 tw:list-none tw:p-0 tw:text-sm tw:text-ink-faint">
            {(Object.keys(NOUN) as (keyof typeof NOUN)[]).map((key) => (
              <Artefact key={key} name={sentenceCase(NOUN[key])} has={available[key]} />
            ))}
          </ul>
        </section>

        <section className="tw:mt-8">
          <h2 className="tw:m-0 tw:mb-2 tw:text-sm tw:font-semibold tw:text-ink">
            What a shared link carries
          </h2>
          {/* **The only place this sentence is drawn, since 2026-09-03**, and
              it is now written to the person reading it. It was shared with the
              owner's Access & Sharing card until then, in the owner's second
              person — so this page told a visitor that a shared link never
              carries *"your comments, your conversations"*, about a reader who
              has none. The owner's card says the same thing as a list and no
              longer needs the sentence. src/messages.ts § SHARED_LINK_CARRIES. */}
          <p className="tw:m-0 tw:text-sm tw:text-ink-faint">{SHARED_LINK_CARRIES}</p>
        </section>

        {/* **The way to complain about this article**, for whoever wrote it.
            src/messages.ts § TAKEDOWN_LINK, and the section it points at is on
            `/privacy` — PrivacyPage.tsx argues there for a section over a route.

            **On this page rather than in the reading view.** This is the page
            about where the piece came from — it already shows the address it was
            published at, three lines up — and it is one press of the bottom bar
            away from the article, so it is findable without being loud. The
            reading view is the wrong place twice over: a report link in the
            prose chrome would shout at every reader of an article that is almost
            certainly shared legitimately, and that bar is measured by
            `stickyOffset` (src/web/scroll.ts), so anything added to it moves
            where every deep link and arrow jump lands.

            **Quiet, and last.** A visitor came here to read; the person this is
            for is looking for it.

            **The paragraph above was overruled on 2026-10-02, on purpose.**
            Greg asked for the offer on every public-readable article, in the
            visitor's banner (`SharedNotice`, PublicChrome.tsx; plan 261002g),
            so the reading view carries it now too — in that box under the
            masthead, which is not the sticky bar and moves no deep link. This
            page draws the same banner above, so this line is a second way to
            the same section; it stays because it is where somebody who
            scrolled past the box will look. */}
        <p className="tw:mt-10 tw:mb-0 tw:text-xs tw:text-ink-faint">
          <Link href={TAKEDOWN_HREF} className="tw:text-ink-faint tw:hover:text-highlight">
            {TAKEDOWN_LINK}
          </Link>
        </p>
      </main>
      <VisitorDock slug={slug} view="metadata" available={available} />
    </>
  );
}

/**
 * `NOUN` is written for the middle of a sentence — *"nobody has built **a
 * glossary** for this piece yet"* — and this list wants it at the start of a
 * line. One capital, rather than a second table of the same five nouns with
 * different capitals, which is the shape that let `quotes` go missing.
 */
function sentenceCase(noun: string): string {
  return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function Artefact({ name, has }: { name: string; has: boolean }) {
  return (
    <li className="tw:py-0.5">
      <span className={has ? "tw:text-ink" : "tw:text-ink-faint"}>
        {has ? "✓" : "—"} {name}
      </span>
    </li>
  );
}

function BackToArticle({ slug }: { slug: string }) {
  return (
    <BackLink href={readHref(slug, carriedSearch(location.search), "article")} label="Back to the article" className="tw:mb-6" />
  );
}

/**
 * The bar, with the modes a visitor cannot have marked.
 *
 * No `drawer`: off the reading view the Comments button is a link back to it
 * anyway, and there is nothing here to fetch. `marked` is what makes the dimmed
 * buttons honest — the reason itself is on the page the button leads to, never
 * only in the tooltip. PublicChrome.tsx § two rules from the research.
 */
function VisitorDock({
  slug,
  view,
  available,
}: {
  slug: string;
  view: ArticleView;
  available: PublicArtefacts;
}) {
  /* **The switch, for a reader who almost certainly does not have one.** A
     signed-out visitor is forcibly off and the store issues no request for
     them, so this subscription costs a stranger nothing — which is the point of
     the store rather than a side effect (experimental-store.ts). A signed-in
     reader looking at somebody else's article gets their own answer here, the
     same one the reading view uses. */
  const experimental = useExperimental();
  return (
    <Dock
      slug={slug}
      view={view}
      experimental={experimental}
      marked={markedModes(available)}
      /* These pages mount no drawer, so the bar cannot infer footing from its
         shape — and inferring from its absence is what left them calling
         somebody else's comments "Your comments". Dock.tsx § visitor. */
      visitor
    />
  );
}
