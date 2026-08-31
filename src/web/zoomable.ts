/**
 * Putting an **enlarge** button on the figures in an article.
 *
 * A pure `html → html` pass over one block, run by `TableView`'s `proseHtml`
 * memo *after* `annotateHtml`. Every `figure`, `picture`, `table`, `pre`, `img`
 * or `svg` gets wrapped in `<span class="zoomable">` with a
 * `<button class="zoom-btn">` after it; the delegated click handler on the
 * table body turns a press into an open of `Lightbox.tsx`.
 *
 * Two of those are there to stop the wrapper *breaking* something rather than
 * because anyone wants to enlarge them — `picture`, whose `<source>` selection
 * depends on the `<img>` staying its child, and the bare `<a>` around a picture
 * (see `outermost`), which must not end up containing our button. Both are on
 * `ZOOMABLE_SELECTOR` / `outermost` with the reasoning.
 *
 * See docs/plans/260828az-figures-in-the-prose.md. Four things here are load-bearing and
 * every one of them fails silently:
 *
 * 1. **`<span>` wraps everything, tables included.** A `<div>` inside a `<p>`
 *    makes the HTML parser close the paragraph, so the string we serialise and
 *    the tree React's `innerHTML` builds from it would differ — a block quietly
 *    splitting in two. `<span>` closes nothing: `<table>`, `<pre>` and
 *    `<figure>` close an open `<p>` in the "in body" insertion mode, not an open
 *    `<span>`. `tests/zoomable.test.ts` pins serialise → parse → serialise as a
 *    fixed point for all five shapes, because that is the property that matters
 *    and it is not obvious from reading this file.
 * 2. **The button contains an SVG and no text.** Comment anchoring works in the
 *    offset space of the block's rendered text — `Range.toString().length` in
 *    selection.ts, `textContent` in annotate.ts — so one character of label here
 *    would shift every comment in every block that has a figure in it. Nothing
 *    would throw; the marks would just land a few characters to the left.
 * 3. **This runs after `annotateHtml`, never before.** Same reason, from the
 *    other end: the annotator splits text nodes at mark boundaries, and there is
 *    no gain in walking it through ours.
 * 4. **`button` is on the sanitiser's `FORBID_TAGS`** (src/sanitize-policy.ts),
 *    so an article can never ship one of its own. A `.zoom-btn` inside `.prose`
 *    is ours by construction, which is what lets the click handler trust it.
 */

/** The wrapper the button is positioned against. */
export const ZOOM_WRAP_CLASS = "zoomable";

/** The button itself — the delegated handler in TableView tests for this. */
export const ZOOM_BTN_CLASS = "zoom-btn";

/**
 * What can be enlarged. The walk is in document order and the **outermost
 * wins** (see `addZoomHandles`), which is what puts a caption in the overlay
 * with the picture it captions.
 *
 * **`picture` is in this list for a reason that is invisible if you leave it
 * out.** `<picture><source …><img …></picture>` works by the `<img>` being a
 * child of the `<picture>`; move the image into a wrapper of ours and the
 * `<source>` candidates silently stop applying, so every reader gets the
 * fallback image instead of the one meant for their screen. Nothing errors and
 * the page looks fine — it is just the wrong file. GPT Sol, 2026-08-28.
 */
export const ZOOMABLE_SELECTOR = "figure, picture, table, pre, img, svg";

/**
 * What makes a `<figure>` worth enlarging: something inside it that does not
 * reflow.
 *
 * **`<figure>` is not a picture element.** The browser pass over the Noema
 * article, 2026-08-28, found 16 buttons against 11 figures and the figures were
 * every one of them a *pull quote* — a blockquote in a `<figure>`, which is
 * exactly what the tag is for and which this feature has nothing to offer. A ⤢
 * on a paragraph of text that already fits the column, and which would enlarge
 * to the same words, is a control that does nothing and says it does something.
 *
 * So `figure` earns its button only by holding one of these. Everything else on
 * `ZOOMABLE_SELECTOR` is its own evidence.
 */
const FIGURE_CONTENT = "img, svg, picture, video, canvas, table, pre";

/**
 * Images narrower than this get no button.
 *
 * The floor for spacers, tracking pixels and inline icons. It is deliberately
 * on the *declared* width rather than a measured one, because this runs on a
 * string with no layout — and an author who declares no width at all keeps the
 * button, since the common reason to omit it is that the image is big.
 *
 * The narrowest real figure in the corpus is Wolfram's 232px inline equation,
 * which is exactly the case this feature exists for, so the floor has to sit
 * well below it.
 */
export const MIN_IMG_WIDTH = 64;

/**
 * Lucide's `expand`, at the app's own stroke weight (docs/project/icons.md).
 *
 * Written out rather than rendered from `lucide-react`, because this is injected
 * HTML: there is no React element here to put a component into. It is the one
 * icon in the app that has to be a string, and it must stay visually identical
 * to `<Expand size={16} strokeWidth={1.75} />` if the icon set is ever updated.
 *
 * `aria-hidden` — the accessible name is the button's `aria-label`.
 */
const EXPAND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"' +
  ' fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"' +
  ' stroke-linejoin="round" aria-hidden="true" focusable="false">' +
  '<path d="m15 15 6 6"/><path d="m15 9 6-6"/><path d="M21 16v5h-5"/><path d="M21 8V3h-5"/>' +
  '<path d="M3 16v5h5"/><path d="m3 21 6-6"/><path d="M3 8V3h5"/><path d="M9 9 3 3"/></svg>';

/** Does this block contain anything worth putting a button on? */
function mightHaveFigure(html: string): boolean {
  return /<(figure|picture|table|pre|img|svg)[\s>/]/i.test(html);
}

/**
 * An `<img>` small enough to be a spacer, an icon or a tracking pixel rather
 * than a figure.
 *
 * **A missing `width` and `width="0"` are different answers**, and conflating
 * them is easy to do by accident: `getAttribute` returns `null` for an absent
 * attribute and `Number(null)` is `0`, so the obvious `Number(...) > 0` test
 * reads "no width declared" and "declared as zero" as the same thing. The first
 * should keep its button (an author who omits the width usually has a big
 * picture); the second is a 1×1 tracker by another name, and giving it a
 * wrapper gives it the light sheet too — a pale square in the middle of a
 * sentence. GPT Sol, 2026-08-28.
 *
 * A non-numeric width (`"50%"`, `"auto"`) is not a judgement either way, so it
 * keeps the button.
 */
function isTiny(el: Element): boolean {
  const img = el.tagName.toLowerCase() === "picture" ? el.querySelector("img") : el;
  if (img?.tagName.toLowerCase() !== "img") return false;
  const declared = img.getAttribute("width");
  if (declared === null) return false;
  const w = Number(declared);
  return Number.isFinite(w) && w < MIN_IMG_WIDTH;
}

/**
 * What to wrap, given what we found: `el` itself, or the bare link around it.
 *
 * **A `<button>` inside an `<a>` is invalid content model** — interactive
 * content nested in interactive content — and although a delegated click can be
 * made to behave, focus order and what an assistive technology reports are the
 * browser's business at that point, not ours. So a picture that is *only* a
 * link gets the wrapper around the link, which leaves the button a sibling of
 * the `<a>` rather than a child of it. GPT Sol, 2026-08-28.
 *
 * **Only when the link has no words of its own.** A sentence-length `<a>` that
 * happens to contain a small image is a link with a picture in it, not a linked
 * picture: hoisting the wrapper there would enlarge the link's text and park the
 * button in the middle of a sentence.
 */
function outermost(el: Element, host: Element): Element {
  const link = el.parentElement?.closest("a");
  if (!link || !host.contains(link)) return el;
  return link.textContent?.trim() ? el : link;
}

/**
 * `html` with an enlarge button on every figure in it.
 *
 * Returns the input unchanged — the same string, not a re-serialised copy —
 * when there is nothing to do, which is the overwhelming majority of blocks.
 * That matters: `TableView` calls this per block on every re-annotation, and a
 * parse-and-serialise of 160 paragraphs to add nothing is the kind of cost that
 * only shows up on a long article.
 */
export function addZoomHandles(html: string): string {
  if (!mightHaveFigure(html)) return html;

  const host = document.createElement("div");
  host.innerHTML = html;

  const found = [...host.querySelectorAll(ZOOMABLE_SELECTOR)];
  let wrapped = 0;
  for (const el of found) {
    // A picture inside a figure, or an image inside a picture: the outermost
    // wins, so the caption travels with what it captions and a `<source>` keeps
    // the `<img>` it selects between. `closest` from the parent, because `el`
    // matches the selector itself.
    if (el.parentElement?.closest(ZOOMABLE_SELECTOR)) continue;
    if (isTiny(el)) continue;
    // A pull quote is a <figure> too — see FIGURE_CONTENT.
    if (el.tagName.toLowerCase() === "figure" && !el.querySelector(FIGURE_CONTENT)) continue;
    const target = outermost(el, host);
    /* The safety net for both "already wrapped" cases: a link holding two
       pictures reaches this twice, and the second time the link is already
       inside a wrapper from the first. Cheap, and it cannot be reasoned wrong
       the way an ordering argument can. */
    if (target.closest(`.${ZOOM_WRAP_CLASS}`)) continue;

    const wrap = document.createElement("span");
    wrap.className = ZOOM_WRAP_CLASS;
    wrap.setAttribute("data-zoom-kind", target.tagName.toLowerCase());
    target.parentNode?.insertBefore(wrap, target);
    wrap.appendChild(target);

    const button = document.createElement("button");
    button.type = "button";
    button.className = ZOOM_BTN_CLASS;
    button.setAttribute("aria-label", "View larger");
    button.innerHTML = EXPAND_SVG;
    wrap.appendChild(button);
    wrapped += 1;
  }
  return wrapped === 0 ? html : host.innerHTML;
}

/**
 * The figure a press on `from` is asking to enlarge, or null.
 *
 * `from` is the enlarge button, or the picture itself, or anything else inside
 * the wrapper — the answer is always the wrapper's first child. That indirection
 * is the point rather than an inconvenience: for a loose `<img>` the node under
 * the pointer *is* the figure, but inside a `<picture>` it is one candidate of
 * several and inside a `<figure>` it is the half without the caption. Reading
 * the wrapper's own child gives the same answer in all three.
 *
 * Read back from the DOM rather than carried in an attribute, so there is one
 * description of the structure (`addZoomHandles` above) instead of two that can
 * disagree.
 */
export function zoomTargetOf(from: Element): Element | null {
  const wrap = from.closest(`.${ZOOM_WRAP_CLASS}`);
  return wrap?.firstElementChild ?? null;
}

/** What the overlay is showing. */
export interface ZoomedFigure {
  /** The figure's own `outerHTML`, already sanitised at article ingress. */
  html: string;
  /** `img`, `table`, `pre`, `figure` or `svg` — the panel sizes itself by it. */
  kind: string;
}

/**
 * A copy of `el` fit to be rendered a second time, somewhere else in the page.
 *
 * **Every `id` comes off**, and that is not tidiness. A block whose root element
 * *is* the table carries the block's own `spya-…` id (src/blocks.ts), so a
 * second copy in the document would give `getElementById` two answers — and the
 * spine, `?at=`, every internal link and every jump resolve through exactly that
 * (docs/project/block-ids.md). Nothing would throw; the reader would just find
 * that jumping to that block sometimes went to the wrong one of the two, and
 * only while a figure happened to be open.
 *
 * The enlarge buttons come off too: a nested one would offer to enlarge what is
 * already enlarged.
 */
export function figureFor(el: Element): ZoomedFigure {
  const clone = el.cloneNode(true) as Element;
  clone.removeAttribute("id");
  for (const node of clone.querySelectorAll("[id]")) node.removeAttribute("id");
  for (const button of clone.querySelectorAll(`.${ZOOM_BTN_CLASS}`)) button.remove();
  return { html: clone.outerHTML, kind: el.tagName.toLowerCase() };
}
