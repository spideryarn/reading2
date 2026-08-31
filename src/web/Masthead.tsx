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
 * Since 2026-08-27 the title here is **editable**: a pencil beside it opens the
 * same in-place editor the shelf has, because the page you are reading is the
 * place you notice the title is wrong. The editor, the request and the three
 * outcomes a rename has are all in TitleEditor.tsx — this file only says where
 * the heading is and what it looks like. docs/project/library.md § The pencil
 * is on three pages now.
 *
 * Note the masthead scrolls away by design (it is `position: sticky` only on
 * the horizontal axis, so it stays put when the table scrolls sideways). What
 * stays with you as you read is the spine and the arc column, not this.
 */
import { useMemo, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { Article, Meta } from "../types.js";
import { isWebUrl } from "../urls.js";
import { Link } from "./Link.js";
import { SourceLink } from "./SourceLink.js";
import { LIBRARY_HREF } from "./router.js";
import { articleStats } from "./stats.js";
import { EditableTitle, useArticleRename } from "./TitleEditor.js";

interface Props {
  article: Article;
  /**
   * **The address, not `meta.slug`.**
   *
   * They are usually the same and once in a while they are not, which is the
   * whole reason this prop exists: an address with no article of its own is
   * answered with the committed fixture, meta.json and all, so `/read/anything`
   * hands this component a `meta.slug` of `noema-mythology-of-conscious-ai`
   * (src/api.ts § loadArticle, example/meta.json). Renaming through that would
   * have PATCHed the real Noema article's shelf row while appearing to rename
   * the thing on screen. GPT Sol, 2026-08-27.
   *
   * The route slug is also what `loadShelf` used to pick the title being drawn
   * here in the first place, so it is the only slug this heading is about.
   */
  slug: string;
  /**
   * The article has been renamed — take this title.
   *
   * Owned by `OwnedArticle` in App.tsx, which holds the payload this masthead
   * is drawing, so one write updates the heading, the tab and every other view
   * of the same article at once. A masthead that kept the new title to itself
   * would disagree with the metadata page one click away.
   *
   * **Absent for a visitor reading a shared document**, and its absence is what
   * hides the pencil. A rename is a PATCH against a shelf row a visitor does
   * not have, so the button could only ever fail, and a button that can only
   * fail is worse than no button because pressing it is how you find out —
   * the same rule Delete follows on the metadata page. 2026-08-28.
   */
  onRenamed?: ((slug: string, title: string) => void) | undefined;
}

export function Masthead({ article, slug, onRenamed }: Props) {
  const { meta, tree } = article;
  /* The same rename the shelf offers, from the page you are actually reading —
     Greg, 2026-08-27. See TitleEditor.tsx for why the request lives in a hook
     rather than here, and why this site cannot say whether the title on screen
     is the reader's own.

     **Mounted only for an owner, since 2026-08-28.** It used to be called
     unconditionally with a no-op and `offer={false}` under it — which worked,
     and was a convention rather than a seam: the hook holding an authenticated
     `PATCH` was one careless `offer` away from being reachable by somebody who
     could not use it. GPT Sol asked for the boundary and it costs one
     component. reader-capability.ts says why a boolean cannot do this job. */
  // The counts live in stats.ts now, because the drawer's About panel needs the
  // same arithmetic and two copies of it would drift.
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /** The heading itself, which is the same either way. */
  /* **`isWebUrl`, since 2026-08-31, and it is not decoration.** `meta.url` is
     the revision's `final_url`, which the fetcher validates — but an *imported*
     article's metadata is written straight into the row, so a `javascript:` or
     `data:` value is reachable here and this anchor would be an active URL sink.
     It is the allowlist the rest of the app already uses for exactly this
     (src/urls.ts, docs/project/security.md). GPT Sol found it while reviewing
     the plan that added a *second* link to the same field, 2026-08-31 — the new
     one is in the controls bar (SourceLink.tsx § TheOriginal) and checks the
     same way. A `file://` URL, which a PDF read off a local path carries, falls
     out here too and correctly: it is not an address anybody else can follow. */
  const heading = (
    <h1 className="tw:min-w-0 tw:flex-1">
      {meta.url && isWebUrl(meta.url) ? (
        <a href={meta.url} target="_blank" rel="noreferrer noopener">
          {meta.title}
        </a>
      ) : (
        meta.title
      )}
    </h1>
  );

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
        {/* The title, and the pencil beside it — TitleEditor.tsx owns where the
            pencil hides, what replaces the heading, and what a failed write
            says, because the metadata page needs all three the same way. */}
        {onRenamed ? (
          <RenameableTitle slug={slug} meta={meta} onRenamed={onRenamed}>
            {heading}
          </RenameableTitle>
        ) : (
          /* A visitor's title, with no rename hook mounted anywhere near it. */
          <div className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">{heading}</div>
        )}

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
                <SeeTheOriginal slug={meta.slug} offer={onRenamed !== undefined}>
                  View the scanned pages
                </SeeTheOriginal>
              </>
            ) : (
              <>
                Transcribed by a machine from a PDF, and checked against the file's own text on{" "}
                {meta.pagesChecked ?? 0} of {meta.pages ?? 0} pages.{" "}
                <SeeTheOriginal slug={meta.slug} offer={onRenamed !== undefined}>
                  View the original
                </SeeTheOriginal>
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

/**
 * **The way to the original file — offered only to the reader who may have it.**
 *
 * `SourceLink` fetches `GET /api/source/:slug`, which is authenticated, and
 * stage 1 deliberately does not serve it publicly: *"Serving somebody's
 * uploaded bytes to the world is a separate decision from serving the extracted
 * text. Hide the link rather than 404 it."*
 * docs/plans/public-read-only-access.md § What a public visitor gets.
 *
 * That decision was written down and then not built. Every visitor to a shared
 * **PDF** mounted the control, so pressing it — or tabbing to it and pressing
 * Enter, which is the half that is easy to forget — opened a blank tab, issued
 * a private request, was refused, and left the reader looking at nothing. GPT
 * Sol, second pass, 2026-08-28.
 *
 * **The sentence stays and only the control goes.** A visitor is entitled to
 * know the article was transcribed from a scan and how much of it was checked
 * — that is a fact about how much to trust what they are reading, and the whole
 * reason the note exists (docs/plans/pdf-ingestion.md § A scan with no text
 * layer). What they cannot have is somebody else's uploaded file.
 *
 * `offer` keyed on `onRenamed`, which is this component's existing stand-in for
 * *is this yours* — see the prop's own comment. One question, asked once.
 */
function SeeTheOriginal({
  slug,
  offer,
  children,
}: {
  slug: string;
  offer: boolean;
  children: ReactNode;
}) {
  /* Not a disabled control and not a marked one: there is nothing here a
     visitor could ever be given, so a dimmed button would be advertising a
     door that does not exist. The bands mark what an account would unlock;
     this is not that. */
  if (!offer) return null;
  return (
    <>
      <SourceLink slug={slug}>{children}</SourceLink>.
    </>
  );
}

/**
 * **The title, with the pencil — and the hook behind it, mounted only here.**
 *
 * `useArticleRename` holds an authenticated `PATCH /api/library/:slug`. It used
 * to be called unconditionally in `Masthead`, with a no-op callback and
 * `offer={false}` under it. That worked, and GPT Sol was right to call it a
 * convention rather than a seam: nothing structural stopped the trigger being
 * reachable, only a boolean somebody could flip while thinking about something
 * else.
 *
 * A hook cannot be skipped conditionally, so the condition is this component
 * existing — the same construction `OwnedReader` uses for comments, chat and
 * the glossary read, and `WithLinkFacts` for the hover lookups.
 * reader-capability.ts.
 *
 * TitleEditor.tsx owns where the pencil hides, what replaces the heading, and
 * what a failed write says, because the metadata page needs all three the same
 * way.
 */
function RenameableTitle({
  slug,
  meta,
  onRenamed,
  children,
}: {
  slug: string;
  meta: Meta;
  onRenamed: (slug: string, title: string) => void;
  children: ReactNode;
}) {
  const rename = useArticleRename(slug, onRenamed);
  return (
    <EditableTitle
      rename={rename}
      title={meta.title}
      inputClassName="tw:font-prose tw:text-2xl tw:leading-snug"
    >
      {children}
    </EditableTitle>
  );
}
