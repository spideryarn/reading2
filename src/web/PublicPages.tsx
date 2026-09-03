/**
 * **The two article pages a visitor gets instead of the owner's.**
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
import { ArrowLeft, ExternalLink } from "lucide-react";

import type { Article } from "../types.js";
import type { PublicArtefacts, PublicTweets } from "../public-types.js";
import { SHARING_WHAT_VISITORS_SEE } from "../messages.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { carriedSearch, readHref, type ArticleView } from "./router.js";
import { webSource } from "./SourceLink.js";
import { articleStats } from "./stats.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SharedNotice, VisitorNotice } from "./PublicChrome.js";
import { markedModes, notBuiltGap, NOUN, type VisitorGap } from "./visitor.js";
import { ThreadCounts, ThreadPosts } from "./Tweets.js";
import { useExperimental } from "./useExperimental.js";

/**
 * The link out to the publisher, or nothing.
 *
 * Nothing rather than a line saying there is no link: this page is short and a
 * visitor has no way to act on the difference. The owner's page does say it,
 * because on that one the absence is a fact about their own library
 * (src/web/Metadata.tsx § `Origin`).
 */
function SourceRow({ url }: { url: string | null }) {
  if (url === null) return <div className="tw:mb-6" />;
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

/** Room for the bottom bar, so the last line of a page is not under it. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-space)_+_2rem)]";

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
      <main className={`tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1 className="tw:m-0 tw:mb-2 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
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
            here means an upload *or* an address the policy withheld, and this
            page cannot tell which — src/web/Masthead.tsx § `OriginMark`. */}
        <SourceRow url={webSource(meta)} />

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
          <p className="tw:m-0 tw:text-sm tw:text-ink-faint">{SHARING_WHAT_VISITORS_SEE}</p>
        </section>
      </main>
      <VisitorDock slug={slug} view="metadata" available={available} signedIn={signedIn} />
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

/**
 * A page that exists for the owner and is not carried on a shared link.
 *
 * Today that is the tweet thread, whose public endpoint is slice 1b. Written as
 * one component taking a `gap` rather than as a tweets page, because the
 * *shape* of this — a title, the sentence, the ask — is the same for whatever
 * lands here next.
 */
export function VisitorPage({
  slug,
  article,
  view,
  gap,
  available,
  signedIn,
  sessionUnconfirmed,
}: {
  slug: string;
  article: Article;
  /* Never the reading view: this page exists *instead of* an article the link
     does not carry. Narrower than `ArticleView` on purpose — the wide type let
     it be built for the reading view, which would have put a mode-less tab on a
     mode-bearing page. */
  view: Exclude<ArticleView, "article">;
  gap: VisitorGap;
  /**
   * Which artefacts this piece has, for the bar's marked modes.
   *
   * It was hardcoded `null` here until slice 1b — the "we could not check"
   * answer, on a page that had the article in hand — so every dimmed button on
   * this page said *we could not check* about an article we knew everything
   * about. There is no `null` to pass now.
   */
  available: PublicArtefacts;
  /** For the call to action only — reader-capability.ts § signedIn. */
  signedIn: boolean;
  /** For the notice at the foot — reader-capability.ts § sessionUnconfirmed. */
  sessionUnconfirmed: boolean;
}) {
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view }));
  return (
    <>
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1 className="tw:m-0 tw:mb-4 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {article.meta.title}
        </h1>
        <VisitorNotice gap={gap} signedIn={signedIn} />
        {/* **The read-only chrome, which this page went without until
            2026-09-02** — and it was the only one of the four visitor pages
            missing it (`PublicMetadataPage` above, and the thread arm below).
            A comment here called that deliberate, on the grounds that
            `VisitorNotice` is about the artefact rather than about the page.
            Both of those are true and the conclusion did not follow: a reader
            whose session could not be confirmed lost the fact *and* the
            *Continue signed out* button by clicking Tweets on a piece that has
            no thread — the default state of most articles. `VisitorArticle`
            states the opposite guarantee in as many words (App.tsx §
            `sessionUnconfirmed`: the explanation goes to all three views
            precisely because the other two are one click away), so the comment
            was claiming a gap was a decision. GPT Sol, reviewing stage 1b.

            **Below the sentence above it, not beside the title**, which is where
            the metadata page puts it. Two reasons, and the second is the one
            that decided it. The thread arm below puts it at the foot too, so the
            two halves of `/read/:slug/tweets` differ by whether there is a
            thread rather than by where the chrome sits. And stacked the other
            way — *we couldn't confirm you're signed in* directly above *nobody
            has built a tweet thread* — the page invites the reader to read the
            second as a consequence of the first, which is the one thing it must
            not say. `SharedNotice`'s own ordering rule, one level up: the thing
            the reader came for first, the news about their session second. */}
        <div className="tw:mt-8 tw:border-t tw:border-border tw:pt-4">
          <SharedNotice signedIn={signedIn} sessionUnconfirmed={sessionUnconfirmed} />
        </div>
      </main>
      <VisitorDock slug={slug} view={view} available={available} signedIn={signedIn} />
    </>
  );
}

/**
 * **The tweet thread, for somebody who does not own the article** — and since
 * slice 1b it is the real thread rather than a notice about one.
 *
 * `Tweets` is not reachable from here and that is the seam rather than an
 * omission: it fetches `GET /api/tweets/:slug` and mounts `useJobs`, which
 * polls the private job list for ever. What a visitor gets instead is the two
 * presentational halves of that page — `ThreadCounts` and `ThreadPosts`, the
 * same components the owner's page draws — with the thread that arrived inside
 * `GET /api/public/article/:slug`. src/web/Tweets.tsx.
 *
 * **The branch is on the artefact itself, not on a flag beside it.** `thread`
 * being absent *is* what `available.tweets` was computed from
 * (src/web/public-artefacts.ts), so branching on the key is what keeps *there
 * is no thread* and *we say there is no thread* the same fact. The constant this
 * replaces claimed a thread existed whatever the wire said — GPT Sol,
 * 2026-08-28 — and the sentence still comes from the one table every other gap
 * uses.
 */
export function VisitorTweetsPage({
  slug,
  article,
  thread,
  available,
  signedIn,
  sessionUnconfirmed,
}: {
  slug: string;
  article: Article;
  /** Absent when nobody has written one for this piece. */
  thread: PublicTweets | undefined;
  available: PublicArtefacts;
  signedIn: boolean;
  /**
   * For the notice at the foot of the page — reader-capability.ts §
   * sessionUnconfirmed. **Both arms take it**: the no-thread one draws
   * `VisitorNotice` about the artefact *and* this about the page, for the reason
   * written where it lands in `VisitorPage`.
   */
  sessionUnconfirmed: boolean;
}) {
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "tweets" }));

  if (thread === undefined) {
    return (
      <VisitorPage
        slug={slug}
        article={article}
        view="tweets"
        gap={notBuiltGap("tweets")}
        available={available}
        signedIn={signedIn}
        sessionUnconfirmed={sessionUnconfirmed}
      />
    );
  }

  return (
    <>
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-[calc(3.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {article.meta.title}
        </h1>
        {/* No `children`: the owner's provenance label reads `profileHash`,
            which never leaves the server. src/public-types.ts. */}
        <ThreadCounts thread={thread} article={article} />
        <ThreadPosts thread={thread} />
        {/* No provenance footer and no rewrite button: both are the owner's, and
            one of them spends a model call. What a visitor gets instead is the
            notice card, which says what a shared link is and what it carries. */}
        <div className="tw:mt-8 tw:border-t tw:border-border tw:pt-4">
          <SharedNotice signedIn={signedIn} sessionUnconfirmed={sessionUnconfirmed} />
        </div>
      </main>
      <VisitorDock slug={slug} view="tweets" available={available} signedIn={signedIn} />
    </>
  );
}

function BackToArticle({ slug }: { slug: string }) {
  return (
    <Link
      href={readHref(slug, carriedSearch(location.search), "article")}
      className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
    >
      <ArrowLeft size={13} />
      Back to the article
    </Link>
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
  signedIn,
}: {
  slug: string;
  view: ArticleView;
  available: PublicArtefacts;
  signedIn: boolean;
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
      signedIn={signedIn}
      /* These pages mount no drawer, so the bar cannot infer footing from its
         shape — and inferring from its absence is what left them calling
         somebody else's comments "Your comments". Dock.tsx § visitor. */
      visitor
    />
  );
}
