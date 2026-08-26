/**
 * The article-level chrome: what the piece is, before you start reading it.
 *
 * Greg, 2026-08-25:
 *
 * > Let's add the title etc (along with any other metadata we have and useful
 * > related UI) to the top masthead row, perhaps with a down-arrow to expand
 * > that to show more information.
 *
 * This is where the *constant* facts about the article live, and that word is
 * doing the work. The reading view's horizontal axis means granularity and its
 * vertical axis means position, so anything that varies along neither belongs
 * in chrome rather than in a column — which is exactly what the old L0 column
 * got wrong (tree.js § the arc). Title, byline, source, counts: all constant,
 * all here.
 *
 * What is here is only the half you want *before* deciding to read: title, who
 * wrote it and where, and the one-sentence gist of the whole piece.
 *
 * The other half — provenance and shape, the source link, the counts, which
 * model built the tree — used to be here too, behind a `▾`. It moved to the
 * bottom drawer on 2026-08-25 (Dock.tsx), and the reason is the paragraph
 * below: **this element scrolls away.** Its disclosure was therefore only
 * reachable from the very top of the article, and opening it pushed the whole
 * table down. The facts you want when something looks wrong are exactly the
 * facts you want *without* going back to the top first.
 *
 * It moved once more the same day, out of the drawer and onto a page of its
 * own — Metadata.tsx, `/read/<slug>/metadata`, reached from the bar's Metadata
 * button (docs/plans/metadata-page.md). So there are two superseded spellings
 * of it in old links, `?about=1` and `?panel=about`, and main.tsx rewrites both
 * to the page.
 *
 * Whether this masthead should link there is open — it shows the title and
 * byline, and a reader who wants more currently has to find the bottom bar.
 *
 * Note the masthead scrolls away by design (it is `position: sticky` only on
 * the horizontal axis, so it stays put when the table scrolls sideways). What
 * stays with you as you read is the spine and the arc column, not this.
 */
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import type { Article } from "../types.js";
import { Link } from "./Link.js";
import { SourceLink } from "./SourceLink.js";
import { LIBRARY_HREF } from "./router.js";
import { articleStats } from "./stats.js";

interface Props {
  article: Article;
}

export function Masthead({ article }: Props) {
  const { meta, tree } = article;
  // The counts live in stats.ts now, because the drawer's About panel needs the
  // same arithmetic and two copies of it would drift.
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  // Only the parts of the facts line this article actually has. Joining a
  // filtered list beats a chain of `&&`s that can leave a stranded separator.
  const facts = [
    meta.byline,
    meta.siteName,
    `${stats.words.toLocaleString()} words`,
    `~${stats.minutes} min`,
    `${stats.parts} parts`,
    `${stats.sections} sections`,
  ].filter(Boolean) as string[];

  return (
    <div className="masthead">
      <div className="masthead-inner">
        {/* The way back to the shelf. Here rather than in the sticky controls
            bar because it belongs with the article's identity, not with the
            granularity controls — and because the bar is measured by
            `stickyOffset()`, so anything added to it changes where every deep
            link and arrow jump lands (scroll.ts). Browser Back does the same
            job; this is for the reader who arrived by pasted link and has no
            Back to press. The bottom bar had a Home button too until
            2026-08-26; the way home is the wordmark fixed in the top-left
            corner of the window now (HomeLogo.tsx), and this is still not a
            duplicate of it for the reason it was not a duplicate of the
            button: this one is named after where it goes and scrolls away with
            the title, and that one is a brand mark that is always there.
            Utilities rather than a rule in styles.css: chrome is what Tailwind
            is here for (web-client.md#tailwind-and-shadcn-components). */}
        <Link
          href={LIBRARY_HREF}
          className="tw:mb-1.5 tw:inline-flex tw:items-center tw:gap-1 tw:font-sans tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
        >
          <ArrowLeft size={13} />
          Library
        </Link>
        <h1>
          {meta.url ? (
            <a href={meta.url} target="_blank" rel="noreferrer noopener">
              {meta.title}
            </a>
          ) : (
            meta.title
          )}
        </h1>

        <p className="facts">
          {facts.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line, rebuilt whole, no child state
            <span key={i}>{f}</span>
          ))}
        </p>

        {/* **Where this article came from, when the answer is not "a web page".**
            A PDF was read by a model, and the reader is entitled to know that
            before they trust a sentence in it.

            Two states, and the difference between them is the whole point. A
            born-digital PDF has its own text layer, so every page was checked
            against it and the number says how well — that is a fact, and it is
            stated quietly. A scan has no text layer at all, so nothing checked
            anything, and saying so needs a sentence rather than a badge: a
            reader who sees a word like "unverified" and no explanation will
            either ignore it or over-read it.

            The link is the part that matters most. A second machine's opinion
            would not be verification; a person looking at the ink is. So the
            original is one click away. docs/plans/pdf-ingestion.md § A scan
            with no text layer. */}
        {meta.source === "pdf" && (
          <p className="source-note">
            {meta.unverified ? (
              <>
                Transcribed by a machine from a scanned image. There was no text in the file to
                check it against, so nothing has verified it.{" "}
                <SourceLink slug={meta.slug}>View the scanned pages</SourceLink>
                .
              </>
            ) : (
              <>
                Transcribed by a machine from a PDF, and checked against the file's own text on{" "}
                {meta.pagesChecked ?? 0} of {meta.pages ?? 0} pages.{" "}
                <SourceLink slug={meta.slug}>View the original</SourceLink>
                .
              </>
            )}
          </p>
        )}

        {/* The whole piece in one sentence — the coarsest thing there is, and
            constant, so it belongs here rather than in a column. */}
        {root?.gist && <p className="root-gist">{root.gist}</p>}
      </div>
    </div>
  );
}
