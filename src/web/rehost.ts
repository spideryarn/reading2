/**
 * **Putting our own copy of a picture into the prose**, in the browser, after
 * the sanitiser.
 *
 * Stage D of both plans that need it —
 * docs/plans/260829b-hosting-the-articles-images.md § Rewriting in the reader,
 * and docs/plans/260906a-figures-from-a-pdf-are-placeholders-with-no-image.md.
 * The pipeline stores the bytes and writes a manifest; nothing puts them on the
 * page. This does.
 *
 * ## Why it cannot be done in the pipeline, which is the first thing to know
 *
 * **A final `/api/…` URL cannot live in the stored HTML.** `stripOwnApiUrls`
 * (src/sanitize-policy.ts) *removes* any `src` that resolves to our own API —
 * host-relative, absolute and protocol-relative alike, resolved rather than
 * string-matched. That is a deliberate control: an article may not point the
 * reader's browser at our own endpoints, because a publisher's markup and ours
 * are indistinguishable once they are both in `block.html`. So a `<img
 * src="/api/asset/…">` written by stage 2 would be deleted by stage 3 and never
 * reach a reader. GPT Sol found the first draft of the figures plan proposing
 * exactly that.
 *
 * **And the tempting way round it is worse**, named here so nobody re-derives
 * it: `isOwnApi` only fires on paths under `/api/`, so a stored
 * `src="/asset/<hash>"` *would* survive the sanitiser. That is routing around a
 * guard by picking a name it does not cover, and it turns the guard into
 * something that has to be re-read every time a route is added. Don't.
 *
 * ## Why an owner's picture arrives as a `blob:` and a visitor's does not
 *
 * **A plain `<img src="/api/asset/…">` 401s.** Authentication here is an
 * `Authorization: Bearer` header (lib/api.ts § A header rather than a cookie)
 * and an `<img>` sends no headers, so the browser's own image fetch arrives
 * anonymous. What the reader sees is a broken-image glyph with nothing in the
 * console — it looks exactly like a CSS bug. `SourceLink.tsx` hit this first and
 * its header enumerates the three ways out and rejects two of them; this takes
 * the third, as `IllustratedView.tsx` does for a plate.
 *
 * A **visitor** has no token to attach and could not use the authenticated
 * route at all, so their pictures come from `/api/public/asset/…` — a plain URL
 * in the `src`, which is also the cheaper answer, since the browser streams it
 * rather than our holding the whole image in memory.
 *
 * ## Attributes only, never text
 *
 * Comment and highlight anchors live in the offset space of a block's rendered
 * text (src/web/annotate.ts), so **nothing this file inserts may contribute a
 * character of text**. An `<img>` contributes none — `alt` is not in
 * `textContent` — which is what makes an insertion legal here where a sentence
 * would not be. The sentence a reader sees when a figure could not be recovered
 * is therefore *not* here: it is client-owned UI beside the prose,
 * PdfFigureNote.tsx. GPT Sol, I-4.
 *
 * ## What flows through it today, and what stage E turns on
 *
 * `Assets` holds two collections: `entries`, the article's own `<img src>`s, and
 * `pdfFigures`, the pictures a PDF came with. **This walks only the second.**
 * The route beneath it is already generic (src/asset-delivery.ts § it is about
 * an article's images), and so is everything below `rehostBlockHtml`; what is
 * PDF-specific is the *selector* and the fact that a PDF figure has no `src` to
 * replace, only an empty `<figure>` to fill.
 *
 * **Stage E adds the other half**: for each `<img src>` in a block, look the URL
 * up in `assetIndex(article.assets)` (src/assets.ts — written for this and
 * still uncalled), and where we hold a copy, replace the `src` **and drop
 * `srcset`, `sizes` and any sibling `<source>`**, because a browser handed a
 * rewritten `src` and an untouched `srcset` prefers the `srcset` and goes on
 * hot-linking while the page looks fixed (src/assets.ts § 2). That is the change
 * that stops readers announcing themselves to publishers' CDNs, and it is
 * deliberately not in this stage: Greg, 2026-09-06 — build the mechanism
 * generic, land it PDF-only, prove it, then flip web images on.
 */

import { pdfFigureMarkersIn, type Assets, type PdfFigureEntry } from "../assets.js";
import { assetPath, publicAssetPath } from "../asset-delivery.js";
import { RESERVED_ATTRS } from "../reserved.js";
import type { Article } from "../types.js";
import { apiFetch } from "./lib/api.js";

/** A figure whose bytes we really hold — the only kind that gets an `<img>`. */
type StoredFigure = Extract<PdfFigureEntry, { status: "stored" }>;

/**
 * **Who is asking**, which decides how the bytes are reached rather than
 * whether they are.
 *
 * A union rather than a boolean, because `shared: false` and `owner: true` are
 * the same fact spelled two ways and one of them will eventually be passed
 * inverted. `resolveAccess` in App.tsx has the answer in its hand — it is the
 * branch it is already on — so it passes it rather than deriving it.
 */
export type RehostFooting = "owned" | "public";

/**
 * Every object URL this module has minted, so it can let go of the last
 * article's when the next one arrives.
 *
 * **Revoked at the start of the next call, not at the end of this one.** An
 * object URL keeps its blob alive, so eight figures at ~300 KB is ~2.4 MB held
 * for as long as the page holds the article — fine for the article being read,
 * a slow leak across a session of them. There is no unmount hook to hang this
 * on: `rehostImages` is a plain async function on the load path, deliberately,
 * because the alternative is an effect that runs after the first paint and the
 * reader watches the figures pop in.
 *
 * **Safe because of how `useArticleAccess` sequences a load** (App.tsx): the
 * effect clears the previous answer *synchronously in the render* before the
 * next `resolveAccess` is even called, so by the time this runs, nothing on
 * screen is still pointing at the URLs being revoked. If that ever stops being
 * true, the symptom is a broken image on the article you just left, which is
 * not a symptom anybody would attribute to this file — hence the paragraph.
 */
let minted: string[] = [];

function mint(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  minted.push(url);
  return url;
}

function releasePrevious(): void {
  for (const url of minted) URL.revokeObjectURL(url);
  minted = [];
}

/**
 * A cheap gate before the parser, in the shape `addZoomHandles` uses.
 *
 * Most blocks of most articles have no marker in them and must not reach
 * `innerHTML` at all: this runs over every block of the article on the load
 * path, and a parse-and-serialise of 360 paragraphs to change nothing is a
 * cost that only shows up on a long piece.
 */
function mightHaveFigure(html: string): boolean {
  return html.includes(RESERVED_ATTRS.pdfFigure);
}

/**
 * An inert document to parse into, made once and reused — the same instrument,
 * for the same reason, as `openExternalLinksInNewTab` in external-links.ts and
 * `notePreviewHtml` in notes-view.ts.
 *
 * `createHTMLDocument` has no browsing context, so nothing loads and nothing
 * runs while the html sits in it: an article's own `<img src="https://…">` is
 * not fetched by our looking at the block it is in, which on this path would be
 * the publisher hearing about a reader before the page has even drawn.
 *
 * A `<div>`, which is what the reading view itself parses this html in.
 */
let holder: HTMLElement | null = null;

function inertHolder(): HTMLElement {
  if (!holder) holder = document.implementation.createHTMLDocument("").createElement("div");
  return holder;
}

/**
 * One block's html with an `<img>` in every figure we hold bytes for, or the
 * **same string** when there was nothing to do.
 *
 * Returning the input unchanged is not only an optimisation: `sanitizeArticle`
 * hands React the very same block object when the html has not changed, and a
 * re-serialised copy that happens to be identical would still be a new string.
 *
 * Exported for its own test. The `src` is passed in rather than built here so
 * that this half — the DOM edit, which is the half with the offset rule on it —
 * is pure and synchronous, and the half that fetches is somewhere a test does
 * not have to mock a network.
 */
export function rehostBlockHtml(html: string, srcFor: (ref: string) => StoredSrc | null): string {
  if (!mightHaveFigure(html)) return html;

  const parsed = inertHolder();
  parsed.innerHTML = html;
  let changed = false;

  /* `pdfFigureMarkersIn`, not a second parser: the selection and the attribute
     read have to agree with what the pipeline did, and src/assets.ts is where
     that agreement lives. */
  for (const marker of pdfFigureMarkersIn(parsed)) {
    const src = srcFor(marker.ref);
    if (!src) continue;
    const figure = parsed.querySelector(
      `[${RESERVED_ATTRS.pdfFigure}="${cssEscape(marker.ref)}"]`,
    );
    /* A `<figure>` that already has a picture in it is left alone. Nothing
       produces one today — stage 2 writes a caption and nothing else — but this
       runs on stored html of unknown age, and stapling a second image under a
       caption is the failure Fable called worse than no figure at all. */
    if (!figure || figure.querySelector("img")) continue;

    const img = parsed.ownerDocument.createElement("img");
    img.setAttribute("src", src.src);
    /* **`alt=""`, deliberately empty.** The visible `<figcaption>` beside it
       carries the caption, so alt text would be the same sentence announced
       twice to a screen reader — and there is nothing else we could honestly
       put there, since nobody has looked at this picture. GPT Sol, I-4. */
    img.setAttribute("alt", "");
    /* The real pixel dimensions, from the manifest, so the row does not jump as
       the picture lands. */
    img.setAttribute("width", String(src.width));
    img.setAttribute("height", String(src.height));
    img.setAttribute("loading", "lazy");
    img.setAttribute("decoding", "async");
    /* **Before the caption**, which is what a `<figure>` means and what the
       lightbox copies wholesale (zoomable.ts § `figureFor`). */
    figure.insertBefore(img, figure.firstChild);
    changed = true;
  }

  const out = changed ? parsed.innerHTML : html;
  parsed.textContent = ""; // don't hold an article's DOM alive between loads
  return out;
}

/** What one figure's `<img>` needs: where the bytes are, and how big they are. */
export interface StoredSrc {
  src: string;
  width: number;
  height: number;
}

/**
 * `CSS.escape`, with a fallback for a ref this attribute selector must not
 * misread.
 *
 * A ref is `[a-z0-9]+-[0-9a-f]{32}.<page>.<ordinal>` (src/assets.ts
 * § `parsePdfFigureMarker`, which has already refused anything else), so there
 * is nothing in it that needs escaping and the fallback is unreachable today.
 * It is here because the *selector* is a place a value from a manifest meets a
 * parser, and "the regex upstream is strict" is a fact about today's code
 * rather than a property of this line.
 */
function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value;
}

/**
 * The whole article, with our own copies of its pictures in it.
 *
 * Returns the **same article object** when there is nothing to do, which is
 * every article that did not come from a PDF and every article ingested before
 * the figures step existed. That is the common case and it costs one property
 * read.
 *
 * **Awaited on the load path**, so the reader never sees a figure pop in after
 * the prose has settled. For a visitor that costs nothing at all — the `src` is
 * a URL and the browser fetches it whenever it likes — and for an owner it
 * costs one parallel round of fetches, eight of them on the article this was
 * built for.
 *
 * **A figure whose bytes will not load is left exactly as it was**: an empty
 * `<figure>` with its caption. Not an error state and not a message, because the
 * manifest says the picture is there and this is a transport failure the reader
 * can do nothing about — reloading is the remedy and they already know how.
 * What *does* get a sentence is a figure the pipeline could not recover, which
 * is a different fact and is recorded in the manifest rather than discovered
 * here. PdfFigureNote.tsx.
 */
export async function rehostImages(
  article: Article,
  slug: string,
  footing: RehostFooting,
): Promise<Article> {
  const wanted = figuresToDraw(article);
  if (wanted.size === 0) return article;

  releasePrevious();
  const srcs = await sourcesFor(slug, footing, wanted);
  if (srcs.size === 0) return article;

  const srcFor = (ref: string) => srcs.get(ref) ?? null;
  return {
    ...article,
    blocks: article.blocks.map((b) => {
      const html = rehostBlockHtml(b.html, srcFor);
      return html === b.html ? b : { ...b, html };
    }),
  };
}

/**
 * The stored figures this article's blocks actually point at, by ref.
 *
 * **The intersection, not the manifest.** A manifest is carried into a new
 * revision (src/store/pg-revisions.ts), so it can name figures whose blocks are
 * gone; fetching those would be bytes nobody will look at. Walking the blocks
 * is what makes the set the union of *what is on the page* and *what we hold*.
 */
function figuresToDraw(article: Article): Map<string, StoredFigure> {
  const stored = storedFigures(article.assets);
  const wanted = new Map<string, StoredFigure>();
  if (stored.size === 0) return wanted;

  const holder = inertHolder();
  for (const block of article.blocks) {
    if (!mightHaveFigure(block.html)) continue;
    holder.innerHTML = block.html;
    for (const marker of pdfFigureMarkersIn(holder)) {
      const entry = stored.get(marker.ref);
      if (entry) wanted.set(marker.ref, entry);
    }
  }
  holder.textContent = "";
  return wanted;
}

/**
 * Ref → the entry, for the figures that have bytes.
 *
 * **Failures are deliberately absent rather than present-and-marked**, which is
 * the call `assetIndex` in src/assets.ts already made for the article's own
 * images: a caller asking *do I have a copy of this?* gets one answer for
 * *failed* and for *never looked at*. What tells those two apart is the
 * manifest itself, read by PdfFigureNote.tsx, which is the one place the
 * difference is worth anything — because it is the one place a reader is told.
 */
function storedFigures(assets: Assets | undefined): Map<string, StoredFigure> {
  const found = new Map<string, StoredFigure>();
  for (const entry of assets?.pdfFigures ?? []) {
    if (entry.status === "stored") found.set(entry.ref, entry);
  }
  return found;
}

/**
 * Where each figure's bytes can be reached from, given who is asking.
 *
 * A visitor's answer is a URL and costs nothing; an owner's is a fetch, and
 * they go out together rather than one after another — eight sequential round
 * trips is a visible pause before the article draws, and eight parallel ones is
 * not.
 *
 * `Promise.allSettled` and not `all`: one figure that fails to load must not
 * take the other seven off the page with it.
 */
async function sourcesFor(
  slug: string,
  footing: RehostFooting,
  wanted: Map<string, StoredFigure>,
): Promise<Map<string, StoredSrc>> {
  const srcs = new Map<string, StoredSrc>();

  if (footing === "public") {
    for (const [ref, entry] of wanted) {
      srcs.set(ref, {
        src: publicAssetPath(slug, entry.sha256, entry.ext),
        width: entry.width,
        height: entry.height,
      });
    }
    return srcs;
  }

  await Promise.allSettled(
    [...wanted].map(async ([ref, entry]) => {
      const res = await apiFetch(assetPath(slug, entry.sha256, entry.ext));
      /* `res.ok` before `blob()`: an error body is perfectly good bytes, and
         without this the reader gets a picture of a JSON error message.
         IllustratedView.tsx § `usePlateBytes` learned that one. */
      if (!res.ok) throw new Error(`figure ${entry.sha256} did not load (${res.status})`);
      srcs.set(ref, { src: mint(await res.blob()), width: entry.width, height: entry.height });
    }),
  );
  return srcs;
}
