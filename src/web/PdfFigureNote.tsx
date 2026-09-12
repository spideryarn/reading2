/**
 * **What a reader is told about a figure that came out of a PDF** — the one
 * that could not be recovered, and the way back to the page it was on.
 *
 * Stage D of
 * docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md, and
 * the first thing in that plan a reader can see. Greg opened a paper with eight
 * captions and eight blank spaces and read it as a bug:
 *
 * > it seemed to ingest ok, but the images aren't showing
 *
 * It was not a bug — v1 shipped figures as caption-only placeholders on purpose
 * — but *a designed placeholder that says nothing is indistinguishable from a
 * failure*, and Fable's call on it is the reason this file exists:
 *
 * > The reader should be told, in one muted line inside the empty figure, when
 * > nothing was recovered. Greg read a designed placeholder as a bug; a
 * > stranger will too.
 *
 * ## Why this is a React sibling and not markup inside the block
 *
 * **Because `block.html` is an offset space, not a canvas.** `annotate.ts`
 * anchors every comment and highlight at a character offset into the
 * concatenated text nodes of a block, and `selection.ts` measures a new one
 * with `Range.toString().length` inside `td.text .prose`. A generated sentence
 * written into the block's html would shift every anchor in that block —
 * silently, with nothing thrown and the marks landing a few characters to the
 * left. GPT Sol, I-4.
 *
 * So it is rendered **outside `.prose`**, as a sibling in the same cell, which
 * is exactly where `TableView` already puts the two other pieces of chrome it
 * owns: the *Notes* heading the source never wrote, and the note number in the
 * margin. `selection.ts` roots at `td.text .prose`, so nothing here is in any
 * offset space at all.
 *
 * ## The copy, and why it carries no bracketed code
 *
 * docs/project/copy.md § The bracketed code lists three families that have
 * none — the import-state sentences, the dictation errors and the error
 * boundaries — and this is a fourth, for the import states' reason rather than
 * the boundaries': **it is not a failure the reader triggered**, or one they
 * can act on, or one a re-run would change. A code exists so somebody can quote
 * four characters when reporting a problem, and a code here would invite a bug
 * report about a PDF whose figure is a vector drawing.
 *
 * **And it does not name a cause**, which is the harder discipline. The
 * extraction caps a decode at 12 megapixels, and pdf.js answers a refusal by
 * *dropping the image operation entirely* — so a figure too big to decode is
 * indistinguishable from a figure that was never a bitmap (the plan § Two of
 * Sol's P0s). "This figure is vector art" would be a confident guess. What we
 * can say is that we looked and could not get it, so that is what it says.
 *
 * **Since 2026-09-12 a figure that *is* vector art is often recovered** — drawn
 * from the page itself on one narrow kind of page
 * (docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md) — and the ones it
 * refuses (`not-located`, `too-complex`, `render-failed`) get this same
 * sentence. The eligibility check does now know when a page holds no image at
 * all, so naming the cause for those is possible; it is deferred in that plan
 * rather than done here, because a reason under a figure is a claim the reader
 * will quote back to us.
 */

import { FileText } from "lucide-react";

import { parsePdfFigureMarker, type Assets } from "../assets.js";
import { RESERVED_ATTRS } from "../reserved.js";
import type { Article, BlockId } from "../types.js";
import { SourceLink } from "./SourceLink.js";

/**
 * **The sentence**, in the caption's voice: short, plain, and about the figure
 * rather than about us.
 *
 * Not in `src/messages.ts`, which is about failures a model call can return —
 * the same reason the `mic-` family and the three error boundaries live beside
 * their own code. Exported so a test can match on it without pinning a spelling
 * in two places.
 */
export const FIGURE_NOT_RECOVERED = "We couldn't recover this figure from the PDF.";

/**
 * What became of the picture behind one marker, as far as the reader is
 * concerned.
 *
 * Three states and not two, and the third is the one worth naming.
 * `"unknown"` is a marker with **no entry in the manifest at all**, which means
 * the assets step has never run on this article — every PDF ingested before it
 * existed. That reader must see exactly what they see today: a caption and a
 * space. Saying "we couldn't recover this" about a picture nobody has looked
 * for would be a claim we have not earned, and it is the same distinction
 * `Assets` itself is built to keep (src/assets.ts § Absent is a third state).
 */
export type FigureOutcome = "stored" | "failed" | "unknown";

/** One `<figure>` in one block, and what the reader is owed about it. */
export interface PdfFigureNote {
  ref: string;
  /** 1-based, the way a reader counts pages — straight off the marker. */
  page: number;
  outcome: FigureOutcome;
}

/**
 * Every PDF figure in every block, by block.
 *
 * **Read out of the blocks rather than out of the manifest**, because the
 * question is *what is on this page* and a manifest is carried into new
 * revisions (src/store/pg-revisions.ts) — it can name figures whose blocks are
 * gone. The manifest is then consulted for the outcome, keyed by the marker's
 * whole attribute value, which is what makes a lookup **fail closed** once the
 * PDF underneath has changed: the ref folds in the raw PDF's sha256, so nothing
 * matches and every figure reads as `"unknown"`.
 *
 * A regex over the raw html rather than a parse, for the reason
 * `addZoomHandles` gates on one: this walks every block of the article and
 * almost none of them contain a marker. What it *finds* still goes through
 * `parsePdfFigureMarker` — the one parser — so a value this file cannot explain
 * is a value it does not carry.
 */
export function pdfFigureNotesIn(article: Article): Map<BlockId, PdfFigureNote[]> {
  const byBlock = new Map<BlockId, PdfFigureNote[]>();
  const outcomes = outcomesOf(article.assets);
  const attr = RESERVED_ATTRS.pdfFigure;
  /* Matched on the attribute rather than on the element, because the element is
     a `<figure>` today and the rule is about the marker. Double or single
     quotes: `blocks.json` is serialised by jsdom, which writes double, and a
     re-serialisation by any other parser is not a thing to depend on. */
  const marker = new RegExp(`${attr}=["']([^"']+)["']`, "g");

  for (const block of article.blocks) {
    if (!block.html.includes(attr)) continue;
    const notes: PdfFigureNote[] = [];
    const seen = new Set<string>();
    for (const [, value] of block.html.matchAll(marker)) {
      const parsed = parsePdfFigureMarker(value ?? "");
      if (!parsed || seen.has(parsed.ref)) continue;
      seen.add(parsed.ref);
      notes.push({
        ref: parsed.ref,
        page: parsed.page,
        outcome: outcomes.get(parsed.ref) ?? "unknown",
      });
    }
    if (notes.length) byBlock.set(block.id, notes);
  }
  return byBlock;
}

/** ref → what the manifest says happened to it. Absent means nobody looked. */
function outcomesOf(assets: Assets | undefined): Map<string, FigureOutcome> {
  const found = new Map<string, FigureOutcome>();
  for (const entry of assets?.pdfFigures ?? []) found.set(entry.ref, entry.status);
  return found;
}

/**
 * **Is there an original to open?** — the whole of what "if available" means.
 *
 * `meta.source === "pdf"` is two facts at once, and both are needed:
 *
 *  - **this article came from a PDF**, so `GET /api/source/:slug` has something
 *    to serve. An uploaded HTML document has nothing a reader would want opened
 *    as a document, and a fetched web page has its address instead;
 *  - **this reader owns it.** The public payload withholds the whole PDF
 *    provenance block — `source`, `method`, `pages`, `rawSha256` and the rest
 *    (src/public-types.ts) — so this field is `undefined` for a visitor, and
 *    that is exactly right, because `/api/source/:slug` is owner-only. An
 *    ungated control could only ever open a blank tab and fail.
 *
 * Leaning on the second is deliberate rather than lucky, and it is written down
 * here because it is the sort of coincidence that gets refactored away: if
 * `PublicMeta` ever gains `source`, this needs an explicit ownership test.
 * `Origin` in Metadata.tsx gates the same control on `uploaded && owner` and is
 * the place to copy from if that day comes.
 *
 * A source that is *gone* — the row says PDF and the bucket has nothing — is
 * not covered here and does not need to be: the control fetches before it
 * navigates, so the reader gets `SourceLink`'s own sentence rather than a blank
 * tab.
 */
export function hasOriginalPdf(article: Article): boolean {
  return article.meta.source === "pdf";
}

/**
 * The muted line, the icon, or both — for one block's figures.
 *
 * **Nothing at all is the common case** and the component says so by returning
 * `null`: a recovered figure on an article with no openable original has
 * nothing to add, and the reader gets the picture and its caption exactly as
 * the piece had them.
 *
 * Rendered per block rather than per figure because that is the unit `TableView`
 * has — one cell, one block — and a block can hold more than one `<figure>`.
 */
export function PdfFigureNotes({
  notes,
  slug,
  canOpenSource,
}: {
  notes: PdfFigureNote[];
  slug: string;
  canOpenSource: boolean;
}) {
  const worth = notes.filter((n) => n.outcome === "failed" || canOpenSource);
  if (worth.length === 0) return null;
  return (
    <>
      {worth.map((note) => (
        <p key={note.ref} className="figure-note">
          {note.outcome === "failed" && <span>{FIGURE_NOT_RECOVERED}</span>}
          {canOpenSource &&
            (note.outcome === "failed" ? (
              /* **Words, when there is nothing to look at.** The reader has just
                 been told a picture is missing; the way out has to be legible in
                 the same breath, and "View the original" is the phrase this app
                 already uses for it (Metadata.tsx § `Origin`). */
              <SourceLink
                slug={slug}
                fragment={`page=${note.page}`}
                className="figure-note-link"
                title={`Open page ${note.page} of the PDF`}
              >
                View the original
              </SourceLink>
            ) : (
              /* **An icon, when there is.** This sits in the prose and the prose
                 is the point, so a recovered figure gets the quietest thing that
                 can still be pressed. The accessible name is a real sentence in
                 an `.sr-only` span rather than a `title`, which is a tooltip
                 first and a name only by accident — and it is outside `.prose`,
                 so its text is in no offset space. */
              <SourceLink
                slug={slug}
                fragment={`page=${note.page}`}
                className="figure-note-icon"
                title={`Open page ${note.page} of the PDF`}
              >
                <FileText size={12} aria-hidden="true" />
                <span className="sr-only">Open page {note.page} of the PDF</span>
              </SourceLink>
            ))}
        </p>
      ))}
    </>
  );
}
