/**
 * **Sources › Links** — every web address the article's own prose links to,
 * one row per address, in the order a reader first meets it.
 *
 * ```
 *  ┌ Bibliography 42 │ Links 61 │ Reception 3 │ Claims 8 ┐          (i)
 *  │ Integrated information theory ↗
 *  │   philpapers.org · PhilPapers TONIIT   linked in 3 paragraphs: ¶ ¶ ¶   In Bibliography
 * ```
 *
 * Greg, 2026-10-10 (spya-s5mzkd): *"Maybe sources should have a submode for
 * external links as well, or perhaps include those in the bibliography
 * somehow."* A sub-mode, with *In Bibliography* on a row whose address is a
 * cited work's, rather than a fold into Bibliography: that list is works, made
 * by a model and stamped, and most links are not works. Plan
 * docs/plans/261011d-sources-links-sub-mode-the-articles-own-hyperlinks.md.
 *
 * **No model, no fetch, nothing stored, nothing armed**: the rows are the
 * blocks' own markup, read in the browser by outbound-links.ts, so the owner
 * and a visitor draw the same list. Each row says what its href says
 * (link-preview.ts § `describeLink`) and no more: no hover card, which would
 * reach our server's link preview (docs/project/links.md).
 */
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type { BlockId } from "../types.js";
import { MODE_LABEL } from "../title-text.js";
import { BlockRef } from "./BlockRef.js";
import { ModeSurface } from "./ModeSurface.js";
import type { LinkableWork, OutboundLink } from "./outbound-links.js";
import { workAt } from "./outbound-links.js";

/** A paragraph list longer than this ends in *and N more*; the rest are a scroll of the prose away. */
const MAX_PLACES = 5;
/** The other phrases one address is linked under, at most this many before *+N more*. */
const MAX_OTHER_PHRASES = 3;

/**
 * The empty list. Neutral, because the panel cannot always say why: a
 * visitor's meta carries no `source`, and an absent `url` there may be a
 * refused address rather than an upload (src/public-types.ts). GPT Sol's F5.
 */
export const LINKS_NONE = "This piece has no web links in its text.";
/** The empty list, for the owner of a PDF: a PDF's prose carries no hyperlinks (docs/project/links.md). */
export const LINKS_NONE_PDF = "This piece has no web links in its text. An article read from a PDF never does.";

/** The (i)'s paragraph on how the rows were got. */
export const LINKS_ABOUT =
  "Read off the article's own markup in your browser: no model, no search, nothing fetched. A link to another part of this piece, a footnote marker, and a link with no words of its own (around a picture) are left out.";

export function LinksPanel({
  links,
  fromPdf,
  works,
  head,
  onJump,
  onOpenWork,
}: {
  /** The rows (outbound-links.ts § `outboundLinks`), worked out once by the band for the chip's count too. */
  links: readonly OutboundLink[];
  /** The owner's `meta.source === "pdf"`; always false for a visitor, whose meta does not say. */
  fromPdf: boolean;
  /** Bibliography's works, for *In Bibliography*; empty while there is no list. */
  works: readonly LinkableWork[];
  /** Sources' chip row (SourcesMode.tsx § `SourcesViews`). */
  head: ReactNode;
  onJump(id: BlockId): void;
  /** Open Bibliography on one work (Reader.tsx § `openBibliographyWork`). */
  onOpenWork(workId: string): void;
}) {
  const about = (
    <>
      <p>{LINKS_ABOUT}</p>
      {links.length > 0 && (
        <p>
          {links.length} {links.length === 1 ? "address" : "addresses"} linked.
        </p>
      )}
    </>
  );
  return (
    <ModeSurface label={MODE_LABEL.sources} feature="gloss links sources" mode="sources" about={about} head={head}>
      {links.length === 0 ? (
        <p className="gloss-quiet">{fromPdf ? LINKS_NONE_PDF : LINKS_NONE}</p>
      ) : (
        <div className="tl-scroll">
          <ol className="tl-list cite-list">
            {links.map((link) => (
              <LinkRow key={link.url} link={link} work={workAt(link, works)} onJump={onJump} onOpenWork={onOpenWork} />
            ))}
          </ol>
        </div>
      )}
    </ModeSurface>
  );
}

function LinkRow({
  link,
  work,
  onJump,
  onOpenWork,
}: {
  link: OutboundLink;
  work: LinkableWork | null;
  onJump(id: BlockId): void;
  onOpenWork(workId: string): void;
}) {
  const [first, ...others] = link.phrases;
  const shownOthers = others.slice(0, MAX_OTHER_PHRASES);
  const moreOthers = others.length - shownOthers.length;
  const { host, citation, file, sameSite } = link.preview;
  const places = link.blockIds.slice(0, MAX_PLACES);
  const more = link.blockIds.length - places.length;
  return (
    <li className="tl-item cite-item link-item" data-link-url={link.url}>
      <p className="cite-title">
        {/* Every link that leaves the app opens a new tab, `noreferrer noopener`
            (docs/project/links.md). The full address is its tooltip. */}
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer noopener"
          data-tip={link.url}
          aria-label={`${first} — opens ${host} in a new tab`}
        >
          <span className="link-phrase">{first}</span>
          <ExternalLink size={11} aria-hidden="true" className="cite-out" />
        </a>
      </p>
      {others.length > 0 && (
        <p className="cite-by link-also">
          also linked as{" "}
          {shownOthers.map((phrase, i) => (
            <span key={phrase}>
              {i > 0 && ", "}“<span className="link-phrase">{phrase}</span>”
            </span>
          ))}
          {moreOthers > 0 && ` and ${moreOthers} more`}
        </p>
      )}
      <p className="cite-meta">
        <span className="cite-source">
          {host}
          {citation && ` · ${citation.label} ${citation.id}`}
          {file && ` · ${file}`}
          {sameSite === true && " · same site"}
        </span>
        <span className="cite-first link-places">
          {link.blockIds.length === 1 ? "linked in" : `linked in ${link.blockIds.length} paragraphs:`}{" "}
          {places.map((id, i) => (
            <span key={id}>
              {i > 0 && " "}
              <BlockRef id={id} onJump={onJump} />
            </span>
          ))}
          {more > 0 && ` and ${more} more`}
        </span>
        {work && (
          <button
            type="button"
            className="gloss-btn link-in-bib"
            data-tip="Bibliography lists a cited work at this address: open its row"
            onClick={() => onOpenWork(work.id)}
          >
            In Bibliography
          </button>
        )}
      </p>
    </li>
  );
}
