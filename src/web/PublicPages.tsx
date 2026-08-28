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
 * thread would be. Both draw from what the visitor already has —
 * `GET /api/public/article/:slug` and `GET /api/public/metadata/:slug` — and
 * neither fetches anything of its own.
 */
import { ArrowLeft } from "lucide-react";

import type { Article } from "../types.js";
import type { PublicArtefacts } from "../public-types.js";
import { SHARING_WHAT_VISITORS_SEE } from "../messages.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { carriedSearch, readHref, type ArticleView } from "./router.js";
import { articleStats } from "./stats.js";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import { SharedNotice, VisitorNotice } from "./PublicChrome.js";
import { markedModes, type VisitorGap } from "./visitor.js";

/** Room for the bottom bar, so the last line of a page is not under it. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-h)_+_2rem)]";

/**
 * What a visitor is told about the article, which is a different question from
 * what the owner's page answers.
 *
 * The owner's metadata page answers *which stage ran, when, into which column,
 * over how many bytes, and would we write it again today* — internal paths,
 * column names and run times, none of it a visitor's business and most of it
 * about our pipeline rather than about the piece. `PublicMetadata` replaces the
 * lot with five booleans, and this page is those five booleans plus what is
 * already in the article payload. src/public-types.ts.
 */
export function PublicMetadataPage({
  slug,
  article,
  available,
  signedIn,
}: {
  slug: string;
  article: Article;
  available: PublicArtefacts | null;
  /** For the call to action only — reader-capability.ts § signedIn. */
  signedIn: boolean;
}) {
  const { meta } = article;
  const stats = articleStats(article);
  useDocumentTitle(pageTitle({ kind: "read", title: meta.title, view: "metadata" }));

  const facts = [meta.byline, meta.siteName, meta.lang].filter(Boolean) as string[];

  return (
    <>
      <main className={`tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-14 tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1 className="tw:m-0 tw:mb-2 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {meta.title}
        </h1>
        {facts.length > 0 && (
          <p className="tw:m-0 tw:mb-6 tw:text-sm tw:text-ink-faint">{facts.join(" · ")}</p>
        )}

        <SharedNotice signedIn={signedIn} />

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
              `PublicMetadata` is five booleans rather than a projection of
              `ArticleMetadata`. */}
          {available === null ? (
            /* The metadata request did not land. Say so rather than drawing five
               "no"s, which would be a claim about somebody's article made out of
               a network failure. docs/reusable/silent-success.md. */
            <p className="tw:m-0 tw:text-sm tw:text-ink-faint">
              We could not check which of these this piece has.
            </p>
          ) : (
            <ul className="tw:m-0 tw:list-none tw:p-0 tw:text-sm tw:text-ink-faint">
              <Artefact name="An arc through the argument" has={available.arc} />
              <Artefact name="A summary" has={available.summary} />
              <Artefact name="A glossary" has={available.glossary} />
              <Artefact name="A list of ideas" has={available.ideas} />
              <Artefact name="A tweet thread" has={available.tweets} />
            </ul>
          )}
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
  signedIn,
}: {
  slug: string;
  article: Article;
  view: ArticleView;
  gap: VisitorGap;
  /** For the call to action only — reader-capability.ts § signedIn. */
  signedIn: boolean;
}) {
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view }));
  return (
    <>
      <main className={`tw:mx-auto tw:max-w-2xl tw:px-6 tw:pt-14 tw:font-sans ${DOCK_CLEARANCE}`}>
        <BackToArticle slug={slug} />
        <h1 className="tw:m-0 tw:mb-4 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {article.meta.title}
        </h1>
        <VisitorNotice gap={gap} signedIn={signedIn} />
      </main>
      <VisitorDock slug={slug} view={view} available={null} signedIn={signedIn} />
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
  available: PublicArtefacts | null;
  signedIn: boolean;
}) {
  return (
    <Dock slug={slug} view={view} marked={markedModes(available)} signedIn={signedIn} />
  );
}
