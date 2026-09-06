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
 * ## Why every picture arrives as a `blob:`, whoever is asking
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
 * route at all, so their bytes come from `/api/public/asset/…` through
 * `publicFetch` (public-api.ts) rather than `apiFetch`. **What they do not get
 * is that URL in the `src`.** Until 2026-09-06 they did, and it was the cheaper
 * answer on paper — the browser streams it rather than our holding the image in
 * memory — but it also meant the visitor's branch never looked at a response.
 * A 404 after the owner un-shared the piece, a 500 from a dangling blob, or a
 * dropped connection therefore left an `<img>` with fixed `width`/`height` over
 * a request that failed: a large blank rectangle with a broken-image glyph in
 * it, exactly where this file's own contract below promises a caption and
 * nothing else. An owner never saw it, because their branch inserts only after
 * a fetch succeeds. GPT Sol, D-1.
 *
 * So the two footings now differ in **one expression** — which fetcher, and
 * which path — and agree on everything after it. Two costs, named rather than
 * discovered:
 *
 *  - **the bytes are held**, up to `MAX_ARTICLE_FIGURE_BYTES`
 *    (src/collect-pdf-figures.ts) in the pathological case and about 5 MB on the
 *    worst real paper we hold — and, since stage E, the article's own images on
 *    top, 7.04 MB on the worst web article in the corpus. That is what an owner
 *    has always paid for their figures;
 *  - **a visitor's figures are fetched before the prose draws**, because that
 *    half is awaited on the load path. It bit within the day, for the article's
 *    own images rather than for the figures, and the answer was to stop awaiting
 *    that half — *not* to put an unverified URL back in the `src`, which is the
 *    bug above. See § The images are blanked before the prose draws.
 *
 * The alternative considered and rejected: keep the streamed URL and preload it
 * with `new Image()` + `decode()`. It blocks for exactly as long, and it costs
 * **two** fetches rather than one, because the public route answers `no-store`
 * (src/public/routes.ts § `sendBytes`) so nothing is cached between the check
 * and the `<img>`.
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
 * ## The two halves, and why they are not symmetrical
 *
 * `Assets` holds two collections and this walks both. `pdfFigures` is the
 * pictures a PDF came with, and `entries` is the article's own `<img src>`s —
 * switched on 2026-09-06 as stage E of the figures plan, which is 260829b's
 * stages C and D finished at last. The route beneath is generic already
 * (src/asset-delivery.ts § it is about an article's images) and needed no edit.
 *
 * The two are not the same job, and the difference decides three things below:
 *
 * |  | a PDF figure | an article's own image |
 * |---|---|---|
 * | in the stored html | an empty `<figure>` and a caption | a working `<img src>` at the publisher |
 * | what we do | **insert** an `<img>` | **replace** the `src` |
 * | if we cannot | a caption on its own | the publisher's URL, exactly as today |
 *
 * **So a web image always has somewhere to fall back to and a PDF figure never
 * does**, and that is the whole argument for the two draws below.
 *
 * ## An image is rehosted as a unit — the trap that makes this a no-op
 *
 * A browser handed a rewritten `src` and an untouched `srcset` prefers the
 * `srcset`, and **goes on hot-linking the publisher while the page looks
 * completely fixed**. Same for a `<source>` inside a `<picture>`, which beats
 * the `<img>` outright. So `src` is replaced and `srcset`, `sizes` and every
 * sibling `<source>` are removed together. 260829b § trap 1, src/assets.ts § 2,
 * and `tests/rehost.test.ts` asserts the *absence of the publisher's host*
 * rather than the presence of ours, because a rewritten `src` proves nothing
 * about the four other places a URL hides.
 *
 * The lookup goes through `imageSourceOf` (src/assets.ts) rather than a second
 * `getAttribute` written here, for that file's § 1: `blocks.json` stores
 * `…&amp;s=3a2bee…` and the DOM hands back `…&s=3a2bee…`, so a manifest keyed on
 * one and read with the other misses **every** entry, in silence.
 *
 * ## The images are blanked before the prose draws, and filled in after
 *
 * This runs before the article renders, and for the images it **has** to: render
 * a block with the publisher's `src` still in it and swap ours in a moment
 * later, and the browser has already fetched from the publisher. The reader has
 * already been counted; the privacy this whole feature exists for is gone, on
 * every read, invisibly, with the feature reporting success. 260829b § Two
 * readers, two paths says it in bold and it is the rule here:
 *
 * > **Do not render the publisher URL while a stored asset is resolving.** Show
 * > a placeholder and substitute the `blob:` … when it arrives.
 *
 * But *awaiting* them is not available either. Measured against the local corpus
 * on 2026-09-06, the worst real article we hold — the Wolfram *Ruliology* piece
 * — carries **102 stored images totalling 7.04 MB**, above and below the fold
 * alike, each one a request that re-reads the article's 24 KB manifest on the
 * way past. Blocking on that turns *the prose appears* into *the prose appears
 * once every image has downloaded*, which in a reading app is a worse bug than
 * the one being fixed. (Median article: 3 images, 0.16 MB. The distribution has
 * no middle, so no percentile splits the difference.)
 *
 * So `rehostImages` hands back **two** things: an article to draw now, with the
 * PDF figures in it and every image we hold a copy of stripped of its `src`, and
 * a promise of the same article with the copies in. A deadline was written first
 * and thrown away: at the deadline it would have put the publisher's URL back,
 * which is the sentence above, done deliberately. GPT Sol, 2026-09-06, and
 * independently the plan.
 *
 * **The PDF figures are still awaited outright**, because the table above says
 * they have nothing to fall back to: a figure not yet fetched is a blank space
 * under a caption, so there is nothing to be gained by drawing sooner. They are
 * also eight and not a hundred.
 *
 * The one cost of that trade, named rather than discovered: **an image we hold
 * is blank from the moment the prose draws until its bytes arrive** — a few
 * hundred milliseconds on the corpus, and `IMAGE_WAIT_MS` in the worst case
 * before the publisher's URL is allowed back. The `width`/`height` the publisher
 * wrote are left on the element precisely so a browser can reserve the box.
 */

import {
  assetIndex,
  imageSourceOf,
  imageSourcesIn,
  pdfFigureMarkersIn,
  IMAGE_SELECTOR,
  type AssetExt,
  type Assets,
  type PdfFigureEntry,
  type StoredAsset,
} from "../assets.js";
import { assetPath, publicAssetPath } from "../asset-delivery.js";
import { RESERVED_ATTRS } from "../reserved.js";
import type { Article } from "../types.js";
import { apiFetch } from "./lib/api.js";
import { publicFetch } from "./public-api.js";

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
 * **One article load's claim on the fetches it starts and the object URLs it
 * mints**, handed out by `beginArticleLoad` and handed back by `release`.
 *
 * ## Why ownership is per-load rather than per-module, since 2026-09-06
 *
 * This was a module-level `minted: string[]` and `inFlight: AbortController`,
 * swept at the top of `rehostImages` — *let go of the last article's blobs when
 * the next one arrives*. That is wrong whenever "the next one" is decided by
 * **which article payload happens to come back last**, and it is, because
 * `rehostImages` runs after `findArticle` has been awaited:
 *
 *  1. article A starts loading, slowly;
 *  2. the reader moves to B; B's payload returns first, mints B's blobs, draws;
 *  3. A's payload finally returns and takes its turn at the sweep;
 *  4. **A revokes B's object URLs and aborts B's fetches** — B is the article on
 *     screen, and its pictures go blank or fall back to the publisher.
 *
 * A's own `live` flag is false by then, so nothing stale is *rendered*; the
 * damage is done to the article that is. React's `<StrictMode>` double-invokes
 * every effect in development, so this is not a rare race. GPT Sol, 2026-09-06.
 *
 * So the claim is made **synchronously in the effect**, before any await, and
 * released by that effect's own cleanup. A load can then only ever abort and
 * revoke its own, whatever order the network answers in — and *release on
 * cleanup* also covers the four cases the sweep never reached at all: leaving
 * the reader for the shelf, an article that turns out not to be shared, a
 * payload that hangs, and an unmount while the second draw is still coming.
 */
export interface ArticleLoad {
  /** Aborted by `release`. Every fetch this load makes carries it. */
  readonly signal: AbortSignal;
  /**
   * An object URL this load owns.
   *
   * **Minting after release revokes immediately** rather than adding to a list
   * that has already been swept. The callers check `signal.aborted` first and
   * so never reach that branch today; it is here because a blob minted after
   * the sweep is an object URL *nothing can ever revoke*, and that is too
   * expensive a leak to leave resting on a caller remembering to ask.
   */
  mint(blob: Blob): string;
  /**
   * Stop this load's fetches and hand its blobs back. Idempotent, because an
   * effect's cleanup and a later abort must not double-revoke.
   */
  release(): void;
}

/**
 * Claim one load. **Call it synchronously, where the load begins** — in
 * `useArticleAccess`'s effect, not inside an async function that has already
 * awaited something. See `ArticleLoad` for what goes wrong otherwise.
 */
export function beginArticleLoad(): ArticleLoad {
  const controller = new AbortController();
  const minted: string[] = [];
  let released = false;
  return {
    signal: controller.signal,
    mint(blob: Blob): string {
      const url = URL.createObjectURL(blob);
      if (released) URL.revokeObjectURL(url);
      else minted.push(url);
      return url;
    },
    release(): void {
      if (released) return;
      released = true;
      controller.abort();
      for (const url of minted) URL.revokeObjectURL(url);
      minted.length = 0;
    },
  };
}

/**
 * A start tag, whatever follows the name — `<img>`, `<img/>`, `<img src=…>`.
 *
 * Case-insensitive although stored html is jsdom-serialised and therefore
 * lower-case, because the cost of the `i` is nothing and the cost of being
 * wrong is an image that goes on hot-linking with no symptom at all.
 */
const IMG_TAG = /<img[\s/>]/i;

/**
 * A cheap gate before the parser, in the shape `addZoomHandles` uses.
 *
 * Most blocks of most articles have neither a marker nor an image in them and
 * must not reach `innerHTML` at all: this runs over every block of the article
 * on the load path, and a parse-and-serialise of 360 paragraphs to change
 * nothing is a cost that only shows up on a long piece.
 *
 * **The same gate is asked by the walk that decides what to fetch and by the
 * pass that rewrites**, deliberately: two gates that disagree would fetch bytes
 * nothing inserts, or — the silent direction — insert nothing for bytes we hold.
 */
function mightNeedRehosting(html: string): boolean {
  return html.includes(RESERVED_ATTRS.pdfFigure) || IMG_TAG.test(html);
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
export function rehostBlockHtml(html: string, sources: RehostSources): string {
  if (!mightNeedRehosting(html)) return html;

  const parsed = inertHolder();
  parsed.innerHTML = html;
  /* Both halves run, and `||` would not do: `fillFigures` short-circuiting
     `swapImages` would leave a PDF-derived article's own images hot-linked. No
     such article exists today — a PDF has no `<img>` — which is exactly the kind
     of fact that stops being true without anybody editing this line. */
  const filled = fillFigures(parsed, sources.figure);
  const swapped = swapImages(parsed, sources.image);

  const out = filled || swapped ? parsed.innerHTML : html;
  parsed.textContent = ""; // don't hold an article's DOM alive between loads
  return out;
}

/**
 * What a block's rewrite needs to look up, and both halves are required.
 *
 * An object with two named members rather than a positional pair, because a
 * second `(ref: string) => …` beside the first is two identically-typed
 * callbacks a caller can hand over the wrong way round — and neither the
 * compiler nor a reader would notice, since the failure is *no picture appears*
 * rather than an exception.
 */
export interface RehostSources {
  /** A PDF figure's whole marker value → where its picture is, or `null`. */
  figure(ref: string): StoredSrc | null;
  /** An `<img src>` as the DOM hands it back → what is to become of it. */
  image(url: string): ImagePlacement | null;
}

/**
 * What is to become of one `<img>` we found — **and `null` is the third answer
 * and the commonest one.**
 *
 * A union rather than `string | null`, because the two non-null cases are the
 * two halves of the rule in the header and a boolean between them would be
 * exactly the wrong way to say it: *put our copy in* and *take the publisher's
 * out and put nothing in yet* differ in one attribute write and in everything
 * that attribute means.
 *
 * `null` — an image we hold no copy of, or one the manifest records as `failed`,
 * or one the step never looked at — is *leave this element completely alone*.
 * It goes on hot-linking, exactly as every image does today.
 */
export type ImagePlacement =
  /** Our copy is in hand. */
  | { kind: "ours"; src: string }
  /** We hold a copy and are fetching it; the publisher must not be asked. */
  | { kind: "waiting" };

/** The one `waiting`, since it carries nothing. */
const WAITING: ImagePlacement = { kind: "waiting" };

/** An `<img>` into every marked `<figure>` we hold bytes for. */
function fillFigures(parsed: HTMLElement, srcFor: (ref: string) => StoredSrc | null): boolean {
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
  return changed;
}

/**
 * **The publisher struck off every image we hold a copy of**, and our own copy
 * put in where there is one to put.
 *
 * `imageSourceOf` reads the attribute, for src/assets.ts § 1 — the pipeline
 * keyed the manifest through that same expression, and a `getAttribute` written
 * out here instead would miss every entry that carries an `&amp;`, silently.
 *
 * **The removals are the point, and they are the same on both branches.** Three
 * places a publisher's URL survives a rewritten `src`: `srcset`, which a browser
 * *prefers*; `sizes`, meaningless once its `srcset` is gone and misleading left
 * behind; and every `<source>` of an enclosing `<picture>`, which outranks the
 * `<img>` altogether. Miss one and the page hot-links exactly as before while
 * looking completely fixed. 260829b § trap 1.
 *
 * That is why `waiting` and `ours` share this loop rather than having one each:
 * they differ in a single attribute write, and the four lines that actually
 * close the leak must not be able to drift apart between two copies of them.
 *
 * **Attributes and void elements only, so not one character of rendered text
 * moves** — `<source>` is void and contributes none, which is what makes
 * removing it legal on a path where comment anchors are counted in characters
 * (src/web/annotate.ts). An `<img>` we hold no copy of is not touched at all.
 *
 * `closest("picture")` rather than the parent, because the spec's shape — the
 * `<img>` as a direct child — is a fact about well-formed markup rather than
 * about the html a publisher wrote and three passes have since rewritten.
 */
function swapImages(
  parsed: HTMLElement,
  placementFor: (url: string) => ImagePlacement | null,
): boolean {
  let changed = false;
  /* Static list: an element loses its `src` below and stops matching the
     selector, which would matter if this were live. */
  for (const img of parsed.querySelectorAll(IMAGE_SELECTOR)) {
    const url = imageSourceOf(img);
    if (url === null) continue;
    const placement = placementFor(url);
    if (placement === null) continue;

    if (placement.kind === "ours") img.setAttribute("src", placement.src);
    /* **No `src` at all, rather than an empty one or a transparent pixel.** An
       empty `src` resolves against the document and fetches the reading view
       itself; a placeholder pixel would be a picture we invented. The
       publisher's own `width`/`height` are left exactly as they are, so a
       browser can still reserve the box. GPT Sol, 2026-09-06. */
    else img.removeAttribute("src");
    img.removeAttribute("srcset");
    img.removeAttribute("sizes");
    for (const source of img.closest("picture")?.querySelectorAll("source") ?? []) {
      source.remove();
    }
    changed = true;
  }
  return changed;
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
 * Returns the **same article object** when there is nothing to do — an article
 * that came from no PDF *and* holds no stored images, plus every article
 * ingested before either step existed. It costs one property read and a walk of
 * the blocks that have an `<img>` or a marker in them.
 *
 * **The figures are awaited and the images are not**, which is the difference
 * the header exists to explain. So a figure never pops in after the prose has
 * settled; an image always does, and what stands in the meantime is an `<img>`
 * with no `src` rather than the publisher's URL — because the publisher's URL in
 * the markup *is* the request, and swapping it a moment later would be a moment
 * too late.
 *
 * **A figure whose bytes will not load is left exactly as it was**: an empty
 * `<figure>` with its caption. Not an error state and not a message, because the
 * manifest says the picture is there and this is a transport failure the reader
 * can do nothing about — reloading is the remedy and they already know how.
 * What *does* get a sentence is a figure the pipeline could not recover, which
 * is a different fact and is recorded in the manifest rather than discovered
 * here. PdfFigureNote.tsx.
 *
 * **An image whose bytes will not load is left exactly as it was too** — and for
 * that half "exactly as it was" is the publisher's own URL, still working, which
 * is why it needs no sentence and no state of its own. 260829b § trap 8 is the
 * correction that a delivery failure and a pipeline failure are different
 * things; for the article's own images they happen to have the same remedy.
 */
export async function rehostImages(
  article: Article,
  slug: string,
  footing: RehostFooting,
  load: ArticleLoad,
): Promise<Rehosted> {
  /* **Already released**, which is the ordinary case for an article the reader
     has moved on from before its payload came back. Nothing may be fetched and
     nothing minted; the article goes back untouched, and the caller's own guard
     will not render it anyway. */
  if (load.signal.aborted) return { article, images: NOTHING_MORE };

  const wanted = assetsToDraw(article);
  if (wanted.figures.size === 0 && wanted.images.size === 0) {
    return { article, images: NOTHING_MORE };
  }

  /* **The figures, awaited.** Nothing to draw in their place, so drawing sooner
     buys the reader nothing — the header's table. */
  const figures = await figureSources(slug, footing, wanted.figures, load);
  const figureFor = (ref: string): StoredSrc | null => figures.get(ref) ?? null;

  const first = rebuild(article, {
    figure: figureFor,
    /* Every image we hold a copy of goes out blank. `wanted.images` is already
       the intersection of *stored* and *on the page*, so `has` is the whole
       test: a `failed` entry and a URL the step never saw are both absent from
       it and are both left alone. */
    image: (url) => (wanted.images.has(url) ? WAITING : null),
  });

  if (wanted.images.size === 0) return { article: first, images: NOTHING_MORE };

  /* **Rebuilt from `article`, not from `first`** — the original html, with the
     publisher's URLs still in it. That is what makes *an image whose fetch
     failed goes back to hot-linking* fall out of the design rather than needing
     a stash: this pass simply does not touch it. */
  const images = imageSources(slug, footing, wanted.images, load).then((got) =>
    rebuild(article, {
      figure: figureFor,
      image: (url) => {
        const src = got.get(url);
        return src === undefined ? null : { kind: "ours", src };
      },
    }),
  );
  return { article: first, images };
}

/**
 * The article twice: one to draw now, one to draw when the pictures land.
 *
 * Two values rather than one because there is no honest way to make an image
 * appear later without a later DOM change, and no honest way to make one appear
 * *sooner* without asking the publisher for it. The caller
 * (App.tsx § `useArticleAccess`) renders the first and replaces it with the
 * second, as an ordinary state transition — an imperative `src` written into the
 * live DOM would be erased the next time `TableView` re-renders a block's html,
 * and would leave object URLs nothing revokes. GPT Sol, 2026-09-06.
 *
 * **What is cancellable is the render, not the work.** The caller's `live` flag
 * suppresses a second draw the reader has moved past; what stops the *fetching*
 * and hands the *blobs* back is `ArticleLoad.release`, and the two are separate
 * mechanisms on purpose — one is about React, the other about resources, and
 * conflating them is how the module-level sweep this replaced came to revoke the
 * wrong article's URLs.
 */
export interface Rehosted {
  /** The figures in, and every image we hold a copy of blanked. Draw this. */
  article: Article;
  /**
   * The same article with our copies in it — including the ones that did not
   * arrive, which go back to the publisher's URL — or `null` when there was
   * never anything more coming.
   */
  images: Promise<Article | null>;
}

/** An article with no images of ours: there is no second draw. */
const NOTHING_MORE: Promise<Article | null> = Promise.resolve(null);

/**
 * One pass of `rehostBlockHtml` over every block.
 *
 * **Returns the very same article when no block changed**, and the very same
 * block object for every block that did not — `sanitizeArticle`'s property, and
 * the thing that stops the second draw re-rendering prose nothing happened to.
 */
function rebuild(article: Article, sources: RehostSources): Article {
  let changed = false;
  const blocks = article.blocks.map((b) => {
    const html = rehostBlockHtml(b.html, sources);
    if (html === b.html) return b;
    changed = true;
    return { ...b, html };
  });
  return changed ? { ...article, blocks } : article;
}

/** What one load is going to fetch: a PDF's figures by ref, images by URL. */
interface Wanted {
  figures: Map<string, StoredFigure>;
  images: Map<string, StoredAsset>;
}

/**
 * Everything stored that this article's blocks actually point at.
 *
 * **The intersection, not the manifest.** A manifest is carried into a new
 * revision (src/store/pg-revisions.ts), so it can name figures and URLs whose
 * blocks are gone; fetching those would be bytes nobody will look at. Walking
 * the blocks is what makes each set the union of *what is on the page* and
 * *what we hold*.
 *
 * Both maps are keyed the way the reader's own lookup will be keyed — a whole
 * marker value, and a URL as `getAttribute` returns it — so the fetch and the
 * rewrite cannot disagree about what they are talking about.
 */
function assetsToDraw(article: Article): Wanted {
  const figures = new Map<string, StoredFigure>();
  const images = new Map<string, StoredAsset>();
  const storedFigs = storedFigures(article.assets);
  /* `assetIndex` is src/assets.ts's own map, written for this on 2026-08-29 and
     called for the first time on 2026-09-06. Failures and unknown URLs are
     absent from it, which is the same answer for both and the right one: leave
     the publisher's URL exactly where it is. */
  const index = assetIndex(article.assets);
  if (storedFigs.size === 0 && index.size === 0) return { figures, images };

  const holder = inertHolder();
  for (const block of article.blocks) {
    if (!mightNeedRehosting(block.html)) continue;
    holder.innerHTML = block.html;
    for (const marker of pdfFigureMarkersIn(holder)) {
      const entry = storedFigs.get(marker.ref);
      if (entry) figures.set(marker.ref, entry);
    }
    for (const url of imageSourcesIn(holder)) {
      const entry = index.get(url);
      if (entry) images.set(url, entry);
    }
  }
  holder.textContent = "";
  return { figures, images };
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
 * **How long an image may stay blank before the publisher's URL is allowed
 * back.**
 *
 * Not a first-paint budget — there is no longer one to spend, because the prose
 * does not wait for any of this. This is the point at which we stop believing a
 * fetch of ours will land: without it a single hung connection would leave every
 * image on the article blank for the rest of the read, since the second draw
 * happens once, when they have all settled.
 *
 * **Generous on purpose**, because the thing it trades away is the privacy the
 * feature exists for, and **it is a starting point rather than a measurement.**
 * The honest arithmetic: 7.04 MB — the worst article in the corpus, measured
 * 2026-09-06 — is about 14.1 s at 4 Mbit/s, so 15 s does *not* comfortably cover
 * that article; it covers it with under a second to spare for 102 round trips
 * and the server work behind them, which is to say it does not. An earlier draft
 * of this comment claimed it did, and GPT Sol did the division. What can be said
 * is that the median article (3 images, 0.16 MB) is nowhere near it, that the
 * images on a 102-image piece are overwhelmingly below the fold, and that
 * exceeding it costs the reader nothing they can see — only privacy on the
 * images that had not landed. Replace this number with a production p95 when
 * there is one.
 *
 * The known cost, named rather than discovered: **one slow image keeps the
 * others blank**, because there is a single second draw rather than one per
 * picture. That is the simplest version and it is deliberate — 102 state
 * transitions would re-render the prose 102 times. If it ever bites, the fix is
 * to deliver the second draw in batches, not to shorten this.
 *
 * The owner's route answers `private, max-age=31536000, immutable`
 * (src/routes.ts § `sendArticleAsset`), so an owner's second visit reads its
 * copies out of the browser cache and never comes near this. A visitor's does
 * not: the whole public namespace answers `no-store` deliberately, so that
 * un-sharing takes effect on the next request, and a visitor pays the full cost
 * every time.
 */
export const IMAGE_WAIT_MS = 15_000;

/**
 * The figures' bytes, by ref — **awaited outright**.
 *
 * The fetches go out together rather than one after another: eight sequential
 * round trips is a visible pause before the article draws, and eight parallel
 * ones is not.
 *
 * `Promise.allSettled` and not `all`: one figure that fails to load must not
 * take the other seven off the page with it. **A `ref` absent from the map is
 * how a failure is spelled**, which is what leaves that figure caption-only —
 * the promise in this module's header, and until 2026-09-06 a promise only the
 * owner's branch kept.
 */
async function figureSources(
  slug: string,
  footing: RehostFooting,
  wanted: Map<string, StoredFigure>,
  load: ArticleLoad,
): Promise<Map<string, StoredSrc>> {
  const figures = new Map<string, StoredSrc>();
  await Promise.allSettled(
    [...wanted].map(async ([ref, entry]) => {
      const blob = await fetchAsset(slug, footing, entry, load.signal);
      /* **Released while the bytes were arriving.** A response already in hand
         is not cancelled by aborting its request, so this is the check an
         `AbortController` alone does not make. `mint` refuses too; both, because
         a picture nobody is looking at should not be put in a map either. */
      if (load.signal.aborted) return;
      figures.set(ref, { src: load.mint(blob), width: entry.width, height: entry.height });
    }),
  );
  return figures;
}

/**
 * The images' bytes, by the URL they replace — **not awaited by the prose.**
 *
 * A URL absent from the answer is how a failure is spelled here too, and it
 * means the same thing it means everywhere else in this file: leave that
 * element as the publisher wrote it. The second draw rebuilds from the original
 * html, so *leaving it alone* is literally all that has to happen.
 *
 * **Its own `AbortController`, downstream of the load's**, for two jobs at once:
 * `IMAGE_WAIT_MS` has to stop these without stopping the figures, and the load
 * being released still has to stop them. Aborting rather than letting the
 * stragglers land is what keeps the leak closed: past the deadline this load's
 * html is built and nothing will look at another picture.
 */
async function imageSources(
  slug: string,
  footing: RehostFooting,
  wanted: Map<string, StoredAsset>,
  load: ArticleLoad,
): Promise<Map<string, string>> {
  const images = new Map<string, string>();
  /* **Released already, so start nothing** — and *nothing* is the word, rather
     than starting them against an aborted signal and letting `fetch` refuse.
     The figures above are awaited, so a load released *during* that await
     arrives here with a signal that has already fired, and `addEventListener`
     does not replay an abort that has already happened. An earlier draft
     pre-aborted the controller below instead, which left every `apiFetch` call
     being made for an article nobody is looking at — the test found it. GPT
     Sol, 2026-09-06. */
  if (load.signal.aborted) return images;

  const stop = new AbortController();
  const passOn = (): void => stop.abort();
  load.signal.addEventListener("abort", passOn, { once: true });

  const settled = Promise.allSettled(
    [...wanted].map(async ([url, entry]) => {
      const blob = await fetchAsset(slug, footing, entry, stop.signal);
      if (stop.signal.aborted) return;
      images.set(url, load.mint(blob));
    }),
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    settled,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        stop.abort();
        resolve();
      }, IMAGE_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  load.signal.removeEventListener("abort", passOn);
  return images;
}

/**
 * One asset's bytes, off whichever of the two routes this footing may use.
 *
 * **The one expression the two footings differ in.** A visitor has no token, so
 * `publicFetch` and not `apiFetch` — public-api.ts says why that is a bare
 * `fetch` and not the authenticated one, and the answer is the same reason this
 * branch exists at all.
 *
 * Structural in its `entry` rather than taking either union, because the two
 * things a fetch needs are the hash and the extension, and a figure's page
 * number and an image's publisher URL are both things this must not start
 * depending on — `StoredArticleAsset` in src/asset-delivery.ts makes the same
 * cut on the server for the same reason.
 */
async function fetchAsset(
  slug: string,
  footing: RehostFooting,
  entry: { sha256: string; ext: AssetExt },
  signal: AbortSignal,
): Promise<Blob> {
  const res =
    footing === "public"
      ? await publicFetch(publicAssetPath(slug, entry.sha256, entry.ext), signal)
      : await apiFetch(assetPath(slug, entry.sha256, entry.ext), { signal });
  /* `res.ok` before `blob()`: an error body is perfectly good bytes, and
     without this the reader gets a picture of a JSON error message.
     IllustratedView.tsx § `usePlateBytes` learned that one. */
  if (!res.ok) throw new Error(`asset ${entry.sha256} did not load (${res.status})`);
  return await res.blob();
}
