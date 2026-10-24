/**
 * **A way back to the publisher's page, beside each figure, table and image of
 * a web article** — opened at that element when the page lets us aim at it.
 *
 * Greg, 2026-10-24 (report spya-weuekx):
 *
 * > All figures and tables and anything else like that extracted from the
 * > original article should provide a subtle UI widget of some kind that
 * > enables you to go back to the original article to see that diagram. I say
 * > that because the one that I'm looking at doesn't seem like it's been
 * > imported correctly.
 *
 * A PDF's figures have had this since 2026-09-06 (PdfFigureNote.tsx), and this
 * is the web half, drawn the same way: the same `.figure-note` row after the
 * block, the same faint icon, so the two read as one control
 * (docs/project/controls.md § Controls that do the same job look the same).
 * Plan docs/plans/261024w-figures-and-tables-open-in-the-original-and-a-titled-arxiv-box-keeps-its-words.md.
 *
 * ## Where it lands
 *
 * **On an `id` the block carries from the page, first.** Stage 3 renames the
 * block's own element to our `spya-` id but keeps every id beneath it
 * (src/blocks.ts § `stampAuthorAnchors`), so arXiv's `S2.F1.g1` in our copy is
 * `S2.F1.g1` on arxiv.org too, and `#S2.F1.g1` scrolls the reader to it.
 * **Then on the caption's opening words**, as a text fragment
 * (`#:~:text=`), which a supporting browser reads and another ignores. Only a
 * caption's: a table's first cells sit in separate boxes, and a text fragment
 * cannot match across them. **Then the page itself**, at the top, which is
 * still the way back, and the tip says so rather than promising the figure.
 *
 * ## Why an anchor, when the PDF's is a button
 *
 * The PDF's original is owner-only and fetched with a token (SourceLink.tsx
 * says why that cannot be an `href`). This one is the article's public address,
 * already printed in the masthead for owner and visitor alike, so it is an
 * ordinary link and every way a browser opens one works. The address is
 * `webSource`'s, which is the `https?` allowlist this field's sinks share; the
 * fragment comes from the page, and is percent-encoded, so it can only ever be
 * a fragment.
 */

import { ExternalLink } from "lucide-react";

import { figuresOf, type FigureKind } from "../figures.js";
import { RESERVED_ATTRS } from "../reserved.js";
import type { Article, Block, BlockId } from "../types.js";
import { webSource } from "./SourceLink.js";

/** Where one block's link goes, and whether it is aimed at the element or only at the page. */
export interface OriginalLink {
  href: string;
  aim: "element" | "page";
  /** What it is — `figures.ts`'s answer — for the words on the control. */
  kind: FigureKind;
}

/** How much of a caption a text fragment carries: enough to be unique, short enough to match. */
const FRAGMENT_WORDS = 6;

/**
 * **An id that a later page of a multi-page article was given**, namespaced by
 * src/read-parts.ts § `namespaceAnchors`. It is on page N, not on the address
 * we hold, which is page 1's, so it is no use as a fragment.
 */
const LATER_PAGE_ID = /^p\d+-/u;

/**
 * Every figure, table and medium of a web article, and where its link goes.
 * Empty for anything with no web address — an upload, and a PDF, which has its
 * own control.
 *
 * **Which blocks is `figuresOf`'s answer** (src/figures.ts), the one Skim's
 * *Figures* walk and Structure's marks use, so a rule, a pull-quote's
 * `<figure>`, a layout table and a line of lettering get nothing here either.
 * With one addition: a block with no words at all whose markup draws something
 * — an inline SVG in a paragraph, which is how a box LaTeXML drew and we failed
 * to lift reaches a reader (latexml.ts § `liftBoxedPassage`). That is the very
 * block a reader most needs to check against the page.
 *
 * One link per block, aimed at the first place in it the page can be scrolled
 * to: a block holding a figure's panels is one figure.
 */
export function originalLinksIn(article: Article): Map<BlockId, OriginalLink> {
  const links = new Map<BlockId, OriginalLink>();
  /* `webSource` means "has a public HTTP address", not "came from HTML": a
     fetched PDF has both `source: "pdf"` and a URL. Its figures use page
     markers and PdfFigureNote's control; an HTML id or text directive cannot
     address the PDF. A visitor's PublicMeta deliberately withholds `source`,
     so the marker is the second proof available on that path. */
  if (isKnownPdf(article)) return links;
  const source = webSource(article.meta);
  if (source === null) return links;
  const page = withoutFragment(source);
  if (page === null) return links;

  const found = new Map<BlockId, { kind: FigureKind; caption: string | null }>();
  for (const figure of figuresOf(article.blocks)) found.set(figure.blockId, figure);
  const parser = new DOMParser();
  for (const block of article.blocks) {
    const figure = found.get(block.id) ?? (drawnWithoutWords(block) ? { kind: "figure" as const, caption: null } : undefined);
    if (figure === undefined) continue;
    const root = parser.parseFromString(block.html, "text/html").body;
    links.set(block.id, linkFor(root, figure.kind, figure.caption, page));
  }
  return links;
}

/** A PDF when either the owner metadata or its unforgeable figure markers say so. */
function isKnownPdf(article: Article): boolean {
  if (article.meta.source === "pdf") return true;
  return article.blocks.some((block) => block.html.includes(RESERVED_ATTRS.pdfFigure));
}

/** No words, and something drawn: an SVG or a picture the stage-3 rules did not call media. */
function drawnWithoutWords(block: Block): boolean {
  return block.text.trim() === "" && /<(?:svg|img|picture|canvas)\b/iu.test(block.html);
}

function linkFor(root: HTMLElement, kind: FigureKind, caption: string | null, page: string): OriginalLink {
  const ids = Array.from(root.querySelectorAll("[id]")).map((el) => el.getAttribute("id") ?? "");
  /* A block from a later page aims at nothing in particular: page 1 has neither its ids nor its words. */
  if (ids.some((id) => LATER_PAGE_ID.test(id))) return { href: page, aim: "page", kind };
  const id = ids.find((value) => value !== "" && !value.startsWith("spya-"));
  if (id !== undefined) return { href: `${page}#${encodeURIComponent(id)}`, aim: "element", kind };

  /* Only a caption: a table's first cells sit in separate boxes, and a text fragment cannot match across them. */
  const words = (caption ?? "").trim().split(/\s+/u).filter(Boolean).slice(0, FRAGMENT_WORDS);
  if (words.length >= 2) return { href: `${page}#:~:text=${textDirective(words.join(" "))}`, aim: "element", kind };

  return { href: page, aim: "page", kind };
}

/** The control's words: what it opens, and how sure it is of landing there. */
export function originalLinkName(link: OriginalLink): string {
  if (link.aim === "page") return "Open the original page";
  return link.kind === "media" ? "Open this in the original" : `Open this ${link.kind} in the original`;
}

/**
 * A text directive's value: percent-encoded, and `-` too, which the syntax
 * reserves along with `,` and `&` and which `encodeURIComponent` leaves alone.
 */
function textDirective(text: string): string {
  return encodeURIComponent(text).replace(/-/gu, "%2D");
}

/** The address with any fragment of its own removed, or `null` if it will not parse. */
function withoutFragment(source: string): string | null {
  try {
    const url = new URL(source);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The icon, in its own `.figure-note` row after the block's prose — outside
 * `.prose`, so it is in no comment's offset space (PdfFigureNote.tsx says why
 * that matters).
 */
export function OriginalLinkNote({ link }: { link: OriginalLink | undefined }) {
  if (link === undefined) return null;
  const name = originalLinkName(link);
  return (
    <p className="figure-note">
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer noopener"
        className="figure-note-icon"
        data-tip={name}
      >
        <ExternalLink size={12} aria-hidden="true" />
        <span className="sr-only">{name}</span>
      </a>
    </p>
  );
}
