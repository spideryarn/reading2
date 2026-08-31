# Code review: figures in the prose (light sheet, enlarge overlay, tighter paragraphs)

You are reviewing **built code**, not a plan. Please be adversarial and concrete. For each finding
give: the file and line, what actually goes wrong, and the smallest correct fix. Rank by severity.
Say explicitly if you think a finding is speculative.

## The project

Spideryarn: a React 19 + TypeScript + Vite reading app, **dark-mode only** (near-black page,
off-white text), no SSR. The reading view renders an article as a table, one row per block, with the
verbatim prose in the right-hand column via `dangerouslySetInnerHTML`. Article HTML is sanitised
with DOMPurify twice — once in Node at ingest, once in the browser at article ingress — and the
policy **forbids `<button>`, `<style>` and `style=` in article markup**.

Two invariants matter more than anything else here:

1. **Block ids.** Every block has a stable id (`spya-k3m9qt`) and everything — the table of contents,
   scroll position (`?at=`), internal links, comments — addresses text by that id via
   `getElementById`. Two elements with the same id in the document is a silent, intermittent bug.
2. **Comment anchoring is by character offset into the block's RENDERED TEXT.** `annotateHtml`
   parses the block html and splits text nodes at mark boundaries; `readSelection` measures a
   selection with `Range.toString().length` over the rendered DOM. So **anything injected into the
   prose that contributes even one character of text moves every comment in that block**, silently.

## What was asked for

Greg, 2026-08-28: "Improve how we display tables, equations. They seem to be being displayed in dark
text on a black background. … And add a button to tables and images (and anything else that you
think would be helpful for the user) to display them in a nearly-full-screen panel/overlay that's
easy to dismiss. Also reduce the vertical gap between paragraphs."

## What was found, and what was built

The dark-on-black "table" is not a table. The block is `<p><img src="…wolfram…png" width="423"></p>`
and every image in that article is a PNG with an alpha channel carrying near-black ink — drawn for a
white page. Alpha cannot be read from CSS, and cannot be read from JS either: the images are
hot-linked cross-origin with no `crossorigin` attribute, so a canvas drawn from one is tainted.

So:

1. **A light sheet** (`--figure-sheet: #f4f3f0`) behind article images/SVGs, unconditionally.
2. **`src/web/zoomable.ts`** — a pure `html → html` pass, run in `TableView`'s `proseHtml` memo
   AFTER `annotateHtml`, wrapping each `figure`/`table`/`pre`/`img`/`svg` in
   `<span class="zoomable">` and appending `<button class="zoom-btn">` (an SVG icon, **no text**).
3. **`src/web/Lightbox.tsx`** — one native `<dialog>` per article, opened with `showModal()`, showing
   a copy of the figure's `outerHTML` with all `id`s stripped.
4. `--block-pad` from `--rhythm/3` to `--rhythm/4` (paragraph gap 15.9px → 11.9px).

## Please look especially hard at

- **The `<span>` wrapper and HTML parser round-tripping.** The claim is that `<span>` around a
  `<table>`, `<pre>` or `<figure>` survives serialise → parse → serialise unchanged, where a `<div>`
  would not (because `<div>` closes an open `<p>`). Is that right for every case, in Chrome as well
  as jsdom? What about a `<table>` whose parent chain does something unusual, foster parenting,
  `<pre>`'s leading-newline rule, or an `<svg>` (foreign content) round trip?
- **Whether anything injected can move a comment's offsets.** Is "an SVG inside a button" really
  zero characters of rendered text in every engine? What about `<title>`/`<desc>` in SVG, or
  `alt`/`aria-label`?
- **`figureFor` stripping ids.** Is stripping enough? What else could collide — `name`, an `<svg>`
  `<defs>` referenced by `url(#…)` from elsewhere, a duplicated `<mark data-comment>` that a
  delegated handler might now see twice?
- **The native `<dialog>`.** The open/close effect, the `closingOurselves` ref, React 19's `onClose`,
  the backdrop-click test `e.target === ref.current`, focus restore, and the decision NOT to lock
  body scroll (relying on `overscroll-behavior: contain` instead). Any way to get the dialog into a
  state where it is open but the React state says closed, or vice versa?
- **The `[open]` guard on `display: flex`.** This stylesheet is inside `@layer app`, which beats the
  UA sheet, so a bare `.lightbox { display: flex }` would show a closed dialog permanently. Is the
  guard complete? Are there other UA `dialog` rules being clobbered?
- **The delegated click handler in TableView.** Ordering against the existing link handling, the
  selection/mouseup handler, modified clicks, touch, and a picture inside an `<a>`.
- **Cost.** `addZoomHandles` runs per block on every re-annotation (which happens on every glossary
  press and every search). Is the `mightHaveFigure` regex guard enough? Is anything O(n²)?
- **The light sheet.** Is scoping it to `.zoomable >` right? What breaks for an image that is
  deliberately white-on-transparent, an `<svg>` with `currentColor`, a `<video>` poster, or an image
  whose `alt` text shows because the file 404s?
- **Anything the tests in `tests/zoomable.test.ts` claim to prove but do not.**

Note the diffs below are only MY hunks — other agents have unrelated uncommitted work in
`styles.css` and `tokens.css`, which is not shown and is not under review.


A browser pass over the same change is running concurrently (does the sheet make the
figure readable, does the overlay open above everything, do the three dismissals work).
Please review the code rather than trying to predict what that pass will see.
---

## NEW FILE: src/web/zoomable.ts

```typescript
/**
 * Putting an **enlarge** button on the figures in an article.
 *
 * A pure `html → html` pass over one block, run by `TableView`'s `proseHtml`
 * memo *after* `annotateHtml`. Every `figure`, `table`, `pre`, `img` or `svg`
 * gets wrapped in `<span class="zoomable">` with a `<button class="zoom-btn">`
 * after it; the delegated click handler on the table body turns a press into an
 * open of `Lightbox.tsx`.
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
 * What can be enlarged, in the order a walk finds them. `figure` is first on
 * purpose: it is the only one that can *contain* another, and taking the figure
 * means the caption is enlarged with the picture it belongs to.
 */
export const ZOOMABLE_SELECTOR = "figure, table, pre, img, svg";

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
  return /<(figure|table|pre|img|svg)[\s>/]/i.test(html);
}

/** An `<img>` small enough to be a spacer or an icon rather than a figure. */
function isTiny(el: Element): boolean {
  if (el.tagName.toLowerCase() !== "img") return false;
  const w = Number(el.getAttribute("width"));
  return Number.isFinite(w) && w > 0 && w < MIN_IMG_WIDTH;
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
    // A picture inside a figure, or a table inside one: the outermost wins, so
    // the caption travels with what it captions. `closest` from the parent,
    // because `el` matches the selector itself.
    if (el.parentElement?.closest(ZOOMABLE_SELECTOR)) continue;
    if (isTiny(el)) continue;

    const wrap = document.createElement("span");
    wrap.className = ZOOM_WRAP_CLASS;
    wrap.setAttribute("data-zoom-kind", el.tagName.toLowerCase());
    el.parentNode?.insertBefore(wrap, el);
    wrap.appendChild(el);

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
 * The element a press on `button` is asking to enlarge, or null.
 *
 * The wrapper's first child by construction — read back from the DOM rather
 * than carried in an attribute, so there is one description of the structure
 * (the wrap above) instead of two that can disagree.
 */
export function zoomTargetOf(button: Element): Element | null {
  const wrap = button.closest(`.${ZOOM_WRAP_CLASS}`);
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
```

## NEW FILE: src/web/Lightbox.tsx

```tsx
/**
 * One figure, as big as the window will allow.
 *
 * Press the ⤢ on a picture, a table or a code block in the article and it opens
 * here — see `zoomable.ts` for how the button gets there, and
 * docs/plans/260828az-figures-in-the-prose.md for why this exists at all (the short
 * version: a data table rendered as a 423px-wide image is not readable, and the
 * file behind it is usually twice that).
 *
 * ## It is a native `<dialog>`, and that is the whole design
 *
 * The three panels this app already has — CommentDialog, ChatDialog,
 * AnnotateDialog — are hand-rolled `<aside role="dialog">`, deliberately: you
 * are meant to keep reading behind them. This one is the opposite. It covers the
 * article, and being a real modal is the point, so it is worth being the one
 * place that uses the platform's own.
 *
 * `showModal()` gives four things for free that the others each hand-roll:
 *
 * - **Escape closes it.** No `window` listener, so nothing to race with the
 *   drawer's or CommentDialog's (Dock.tsx § Escape closes the drawer has the
 *   story of two of those fighting).
 * - **The background goes `inert`** — not reachable by Tab, not clickable, not
 *   read by a screen reader.
 * - **Focus is trapped, and restored to the button that opened it** when the
 *   dialog closes. Both by spec, neither by us.
 * - **It is in the top layer**, so it paints above the spine (45), the dock
 *   (96), the colour picker (99) and the tooltip (100) *without joining the
 *   z-index budget at all* (design-css-overview.md § What is not written down
 *   yet calls that budget the most likely thing to break next; this adds
 *   nothing to it).
 *
 * Two things `<dialog>` does **not** do, and both are handled below:
 *
 * - **A click on the backdrop does not close it.** The `closedby="any"`
 *   attribute that would is still not everywhere in 2026, so the manual
 *   `e.target === dialog` test is the real mechanism and the attribute is left
 *   out rather than half-relied on.
 * - **The page behind can still scroll.** `overscroll-behavior: contain` on the
 *   scroller stops the chaining, which is the case that actually happens (a
 *   trackpad flick inside a tall figure). Locking `body` was rejected: this view
 *   writes the reading position from the scroll (`?at=`), and an overflow change
 *   that clamps `scrollTop` would move the reader's place in the article as a
 *   side effect of looking at a picture.
 *
 * The survey behind that choice — yet-another-react-lightbox, PhotoSwipe,
 * react-medium-image-zoom, react-zoom-pan-pinch — is in the plan. Every
 * image-first library assumes a gallery of pictures; the content here is
 * arbitrary sanitised HTML, which is exactly what a bare dialog takes.
 */
import { useEffect, useRef } from "react";
import { X } from "lucide-react";

import type { ZoomedFigure } from "./zoomable.js";

interface Props {
  /** The figure to show, or null when nothing is open. */
  figure: ZoomedFigure | null;
  onClose(): void;
}

export function Lightbox({ figure, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  /**
   * Whether *we* are the ones closing it.
   *
   * `close()` fires the same `close` event Escape does, so without this the
   * parent's own "shut the lightbox" would come straight back as a second
   * `onClose` — harmless today, and exactly the kind of loop that stops being
   * harmless the moment `onClose` does anything but clear a state.
   */
  const closingOurselves = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (figure && !dialog.open) {
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!figure && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [figure]);

  return (
    /* biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is
       the backdrop, whose keyboard equivalent is Escape — which the element
       implements itself. A keydown listener would be a second, worse copy. */
    <dialog
      ref={ref}
      className={`lightbox lightbox-${figure?.kind ?? "none"}`}
      aria-label="Figure, enlarged"
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      /* Light dismiss. The <dialog> box fills the viewport and the panel sits
         inside it, so "the target is the dialog itself" means "the press landed
         outside the panel" — including on the dimmed area, which is the
         ::backdrop painted underneath. */
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="lightbox-panel">
        <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={1.75} />
        </button>
        {/* `.prose` so a table keeps the article's own table styling rather
            than needing a second description of it here. The html is the
            article's, sanitised at ingress (src/web/sanitize.ts) and stripped
            of its `id`s by the caller so nothing in the document is duplicated
            while this is open. */}
        {figure && (
          <div
            className="lightbox-content prose"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: the article's own html, sanitised at ingress
            dangerouslySetInnerHTML={{ __html: figure.html }}
          />
        )}
      </div>
    </dialog>
  );
}
```

## NEW FILE: tests/zoomable.test.ts

```typescript
// @vitest-environment jsdom
/**
 * The enlarge button that `zoomable.ts` injects into the article's own HTML.
 *
 * Three of the four things checked here fail **silently** — the page renders,
 * nothing throws, and the damage is somewhere else entirely:
 *
 * - a wrapper that the HTML parser does not put back where we serialised it
 *   splits a paragraph in two, in a view whose whole contract is that a block
 *   is one addressable thing (docs/project/block-ids.md);
 * - one character of text inside the button shifts every comment anchored in
 *   that block, because anchoring counts characters of rendered text
 *   (src/web/selection.ts);
 * - a button on a tracking pixel is a light square in the middle of a
 *   paragraph, since the same wrapper carries the figure's light sheet.
 *
 * jsdom rather than the default node environment (vitest.config.ts), for the
 * reason annotate.test.ts gives: the module under test is a DOM pass over an
 * html string, and reimplementing one here would be testing the reimplementation.
 *
 * The round-trip test is the one worth reading: it is a *property* — serialise,
 * parse, serialise again, and the two strings must be equal — rather than a
 * comparison against an expected string, because what it is defending against
 * is precisely the case where our idea of the markup and the parser's differ.
 */
import { describe, expect, it } from "vitest";
import {
  addZoomHandles,
  figureFor,
  MIN_IMG_WIDTH,
  ZOOM_BTN_CLASS,
  ZOOM_WRAP_CLASS,
  zoomTargetOf,
} from "../src/web/zoomable.js";

/** The text a reader (and `Range.toString()`) sees, which must never move. */
function renderedText(html: string): string {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent ?? "";
}

function parse(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

/** Every shape a block can be, and the tags that make a parser reconsider. */
const SHAPES: Record<string, string> = {
  "an image inside a paragraph": '<p id="spya-aaaaaa">before <img src="x.png" width="400"> after</p>',
  "an image alone in a paragraph": '<p id="spya-bbbbbb"><img src="x.png" width="400"></p>',
  "a table as the whole block":
    '<table id="spya-cccccc"><thead><tr><th>n</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
  "a code block": '<pre id="spya-dddddd"><code>let x = 1;\nlet y = 2;</code></pre>',
  "a figure with a caption":
    '<figure id="spya-eeeeee"><img src="x.png" width="400"><figcaption>What it shows</figcaption></figure>',
  "an inline svg": '<p id="spya-ffffff"><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg></p>',
};

describe("addZoomHandles", () => {
  for (const [name, html] of Object.entries(SHAPES)) {
    describe(name, () => {
      it("puts exactly one button on it", () => {
        const out = parse(addZoomHandles(html));
        expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
        expect(out.querySelectorAll(`.${ZOOM_WRAP_CLASS}`)).toHaveLength(1);
      });

      /* **The property, not an expected string.** React writes this back with
         `innerHTML`, so the tree the browser builds has to be the tree we
         serialised. A `<div>` wrapper would pass every other test in this file
         and fail here: `<p>…<div>` makes the parser close the paragraph, and the
         block silently becomes two. */
      it("survives being parsed and re-serialised", () => {
        const once = addZoomHandles(html);
        const twice = parse(once).innerHTML;
        expect(twice).toBe(once);
      });

      /* Comment anchoring lives in the offset space of the rendered text
         (src/web/annotate.ts, src/web/selection.ts). One label, one space, one
         zero-width anything, and every comment in the block moves. */
      it("does not change the rendered text by one character", () => {
        expect(renderedText(addZoomHandles(html))).toBe(renderedText(html));
      });

      it("leaves the figure's own attributes alone", () => {
        const out = parse(addZoomHandles(html));
        expect(out.querySelector("[id^=spya-]")).not.toBeNull();
      });
    });
  }

  it("returns the very same string when there is no figure", () => {
    const html = "<p id=\"spya-gggggg\">Just words, and <a href=\"https://x.test\">a link</a>.</p>";
    expect(addZoomHandles(html)).toBe(html);
  });

  /* The outermost wins, so the caption is enlarged with the picture it captions
     rather than separately from it. */
  it("puts one button on a figure, not one on the figure and one on its image", () => {
    const out = parse(addZoomHandles(SHAPES["a figure with a caption"] as string));
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
    expect(out.querySelector(`.${ZOOM_WRAP_CLASS}`)?.firstElementChild?.tagName.toLowerCase()).toBe(
      "figure",
    );
  });

  /* A 1x1 GIF given a wrapper gets the light sheet with it (styles.css § the
     light sheet under them), which is a pale square in the middle of a
     sentence. The floor is on the declared width because this runs on a string
     with no layout. */
  it("skips an image too small to be a figure", () => {
    const tiny = `<p id="spya-hhhhhh">x<img src="p.gif" width="1" height="1"></p>`;
    expect(addZoomHandles(tiny)).toBe(tiny);
  });

  it("keeps an image that declares no width at all", () => {
    const out = parse(addZoomHandles('<p id="spya-iiiiii"><img src="x.png"></p>'));
    expect(out.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(1);
  });

  /* The floor has to sit well below the narrowest real figure in the corpus —
     Wolfram's 232px inline equation, which is the case the feature exists for. */
  it("keeps an image exactly on the floor and drops the one below it", () => {
    const at = `<p><img src="x.png" width="${MIN_IMG_WIDTH}"></p>`;
    const below = `<p><img src="x.png" width="${MIN_IMG_WIDTH - 1}"></p>`;
    expect(addZoomHandles(at)).not.toBe(at);
    expect(addZoomHandles(below)).toBe(below);
  });
});

describe("zoomTargetOf", () => {
  it("finds the figure a press belongs to", () => {
    const out = parse(addZoomHandles(SHAPES["a table as the whole block"] as string));
    const button = out.querySelector(`.${ZOOM_BTN_CLASS}`);
    expect(button).not.toBeNull();
    expect(zoomTargetOf(button as Element)?.tagName.toLowerCase()).toBe("table");
  });
});

describe("figureFor", () => {
  /* A block whose root element IS the table carries the block's own id. Two
     copies in one document give `getElementById` two answers, and the spine,
     `?at=`, every internal link and every jump resolve through exactly that. */
  it("strips every id, so the copy cannot shadow the original", () => {
    const out = parse(addZoomHandles(SHAPES["a table as the whole block"] as string));
    const table = out.querySelector("table") as Element;
    expect(table.id).toBe("spya-cccccc"); // the original still has it
    const copy = parse(figureFor(table).html);
    expect(copy.querySelectorAll("[id]")).toHaveLength(0);
  });

  it("strips the enlarge buttons, so the copy does not offer to enlarge itself", () => {
    const out = parse(addZoomHandles(SHAPES["a figure with a caption"] as string));
    const figure = out.querySelector("figure") as Element;
    const copy = parse(figureFor(figure).html);
    expect(copy.querySelectorAll(`.${ZOOM_BTN_CLASS}`)).toHaveLength(0);
    expect(copy.querySelector("figcaption")?.textContent).toBe("What it shows");
  });

  it("reports the kind, which is what the panel sizes itself by", () => {
    const out = parse(addZoomHandles(SHAPES["an image alone in a paragraph"] as string));
    expect(figureFor(out.querySelector("img") as Element).kind).toBe("img");
  });

  it("does not touch the element it copies", () => {
    const out = parse(addZoomHandles(SHAPES["a code block"] as string));
    const pre = out.querySelector("pre") as Element;
    figureFor(pre);
    expect(pre.id).toBe("spya-dddddd");
    expect(pre.textContent).toBe("let x = 1;\nlet y = 2;");
  });
});
```

## DIFF: src/web/TableView.tsx (my hunks only — a peer's `supplement` work in the same file is excluded)

```diff
diff --git a/src/web/TableView.tsx b/src/web/TableView.tsx
index 2722765..bff6817 100644
--- a/src/web/TableView.tsx
+++ b/src/web/TableView.tsx
@@ -36,12 +36,21 @@ import { currentIndex, itemsFromCells, levelList, type ContextItem } from "./con
 import { ContextPanel } from "./ContextPanel.js";
 import { useColumnContext } from "./useColumnContext.js";
 import { BlockRange, BlockRef } from "./BlockRef.js";
 import { MessageSquare } from "lucide-react";
 import { SWIPE_ATTR } from "./swipe.js";
 import type { AnchoredThread } from "./useChatAnchors.js";
+import { Lightbox } from "./Lightbox.js";
+import {
+  addZoomHandles,
+  figureFor,
+  ZOOM_BTN_CLASS,
+  ZOOM_WRAP_CLASS,
+  zoomTargetOf,
+  type ZoomedFigure,
+} from "./zoomable.js";
 
 interface Props {
   article: Article;
   /** Built once in App, because the reading-position code needs it too. */
   geometry: Geometry;
   /** Visible column depths, coarse to fine. Chosen by layout.ts § fitView. */
@@ -183,12 +192,20 @@ export function TableView({
 }: Props) {
   useRenderCount("TableView");
   const { blocks } = article;
   const [hoveredRow, setHoveredRow] = useState<number | null>(null);
   /** The panel entry under the pointer, if any — see activeChain below. */
   const [hoveredNode, setHoveredNode] = useState<NodeId | null>(null);
+  /**
+   * The figure the reader asked to see larger, or null. A *copy* of the html
+   * rather than the node itself, because the node belongs to injected markup
+   * that React replaces wholesale on the next re-annotation — holding a
+   * reference would leave the overlay pointing at a detached element, which is
+   * the bug useHoverCard.ts records having had twice.
+   */
+  const [zoomed, setZoomed] = useState<ZoomedFigure | null>(null);
   const bodyRef = useRef<HTMLTableSectionElement>(null);
 
   /**
    * Column context — see docs/project/column-context.md. In reading mode
    * every gist column is drawn by a ContextPanel laid over it, and the cells
    * underneath draw only their boundaries; the panel's current entry carries
@@ -396,13 +420,20 @@ export function TableView({
           : found),
         ...(hitMarks?.get(block.id) ?? []),
       ];
       /* The unmarked majority never reaches the parser at all. `annotateHtml`
          has this test too; doing it here as well is what keeps an unmarked
          block out of the Map's churn as well as out of the parse. */
-      if (marks.length > 0) byBlock.set(block.id, annotateHtml(block.html, marks));
+      const marked = marks.length > 0 ? annotateHtml(block.html, marks) : block.html;
+      /* The enlarge buttons go on LAST, and `addZoomHandles` returns its input
+         unchanged when there is no figure in it — so the Map still holds only
+         the blocks that differ from their own html, and a paragraph of plain
+         prose costs one regex. See zoomable.ts § the four load-bearing things,
+         the third of which is this ordering. */
+      const withHandles = addZoomHandles(marked);
+      if (withHandles !== block.html) byBlock.set(block.id, withHandles);
     }
     return byBlock;
   }, [blocks, marksByBlock, termMarksByBlock, hitMarks, openTerm]);
 
   /**
    * The back-link that leads to where the reader came from, marked.
@@ -523,13 +554,41 @@ export function TableView({
           // A modified click is the reader asking for a new tab or window, and
           // that works: the href is a real fragment, and main.tsx turns an
           // arriving `#spya-…` into `?at=` before React mounts. Taking it over
           // would break the one case where the browser's own answer is right.
           if (e.defaultPrevented || e.button !== 0) return;
           if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
+          /* Enlarge, before anything else looks at this press.
+             Ahead of the link test on purpose: a picture inside a link gets
+             both a button and a link, and pressing the *button* has to mean the
+             button. The link keeps the picture itself — see below. */
+          const target = e.target as Element;
+          const zoomButton = target.closest?.(`.prose .${ZOOM_BTN_CLASS}`);
+          if (zoomButton) {
+            e.preventDefault();
+            const figure = zoomTargetOf(zoomButton);
+            if (figure) setZoomed(figureFor(figure));
+            return;
+          }
           const link = (e.target as Element).closest?.("a[href]");
+          /* A picture is its own button. There is nothing to select inside an
+             `<img>`, so a plain click on one is unambiguous — which is why this
+             is offered for pictures and not for tables or code, where a click is
+             someone starting a selection.
+
+             A picture inside a link is left to the link: following it is what
+             the author wrote, and the ⤢ in the corner is still there for the
+             reader who wanted the other thing. */
+          if (!link) {
+            const picture = target.closest?.(`.prose .${ZOOM_WRAP_CLASS} > :is(img, svg)`);
+            if (picture) {
+              e.preventDefault();
+              setZoomed(figureFor(picture));
+              return;
+            }
+          }
           if (!link) return;
           /* A drag that ended inside a link is a selection, and the mouse-up
              handler below has already turned it into a question. Stopping the
              click is not optional here: merely declining to jump would leave the
              browser to follow the fragment natively, which throws the reader
              away from the passage they just chose. */
@@ -831,12 +899,18 @@ export function TableView({
         activeChain={activeChain}
         crumbFor={crumbFor}
         onJump={onJump}
         onHoverNode={setHoveredNode}
       />
     )}
+    {/* One overlay for the whole article, always mounted and empty until a
+        figure is pressed. Mounted rather than conditionally rendered because
+        `showModal()` has to be called on an element that is already in the
+        document, and a `<dialog>` that is not open occupies no space and paints
+        nothing. */}
+    <Lightbox figure={zoomed} onClose={() => setZoomed(null)} />
     </>
   );
 }
 
 /* ---------------------------------------------------- the gist panels ------
```

## DIFF: src/web/styles.css (my three hunks only)

```diff
diff --git a/src/web/styles.css b/src/web/styles.css
index ea46679..f32b8f4 100644
--- a/src/web/styles.css
+++ b/src/web/styles.css
```

## DIFF: styles/tokens.css

```diff
diff --git a/styles/tokens.css b/styles/tokens.css
index 7c17a3e..d4c0d94 100644
--- a/styles/tokens.css
+++ b/styles/tokens.css
@@ -72,12 +72,35 @@
        *whatever was already there* rather than failing. That is precisely what
        it did on /design until a GPT Sol review caught it, 2026-08-26 — a swatch
        showing the wrong colour, and a measured contrast ratio for something
        else entirely. */
     --hit-wash: rgb(var(--hit-wash-rgb));
 
+    /* The sheet an article's pictures are printed on, and the one deliberately
+       LIGHT surface in a dark-only app.
+
+       Article images are routinely PNGs with an alpha channel carrying
+       near-black ink — equations, line diagrams, and data tables rendered as
+       pictures. Every one of Wolfram's seven images in the sample article is
+       one. They were drawn for a white page, and on ours the ink lands on
+       black: docs/plans/260828az-figures-in-the-prose.md has the alpha extrema.
+
+       Nothing can tell those apart from an opaque photograph. Not CSS, which
+       cannot see an alpha channel; and not JavaScript either, because the
+       images are hot-linked cross-origin with no `crossorigin` attribute, so a
+       canvas drawn from one is tainted and `getImageData` throws. So the sheet
+       is unconditional, which is where Wikipedia's night mode also ended up
+       after two years of trying to be clever about it — their `skin-invert` is
+       scoped by hand to images an editor has certified as pure black, precisely
+       because `filter: invert()` wrecks anything with a real hue.
+
+       An opaque photograph covers its own sheet exactly, so the only visible
+       cost is the mat around it. Off-white rather than white: a pure #fff
+       rectangle on a near-black page glares. */
+    --figure-sheet: #f4f3f0;
+
     /* ---- surfaces and text (dark only; see the header) ---------------- */
     /* Not literally #000 on #fff inverted: the page is all-but-black and the text is off-white,
        because pure white on pure black haloes at reading sizes. That was first noticed in Georgia,
        and it did not go away when the reading face became Geist — light-on-dark bloom is about the
        contrast, not the face. The other half of the same fix is --reading-weight below. */
     --background: oklch(0.145 0 0);
@@ -199,17 +222,23 @@
 
     /* Half the gap between two blocks — each row of the reading table pads by this much top
        and bottom, so two neighbouring rows make a gap of two. **This is the number to change
        if the article wants more or less air**, and changing it here moves the heading spacing
        with it, because those are written as multiples of this rather than of --rhythm.
 
-       A third of a unit rather than a half: the gap between paragraphs went from one unit to
-       two thirds on 2026-08-27, when Greg asked for less (it had been a full unit since the
-       column was built). The ratios are untouched — a heading still gets twice the space above
-       it that it gets below, which is the part that carries meaning. */
-    --block-pad: calc(var(--rhythm) / 3);
+       A quarter of a unit. The gap between paragraphs has now come down twice on Greg's
+       asking: a full unit until 2026-08-27, two thirds until 2026-08-28, half a unit
+       (11.9px) now. The ratios are untouched both times — a heading still gets twice the
+       space above it that it gets below, which is the part that carries meaning.
+
+       There is a floor somewhere below this and it is not arithmetic. The prose is 17px at
+       1.6, so the whitespace *between two lines of one paragraph* is around 10px; once the
+       gap between paragraphs stops clearly exceeding that, the column reads as one
+       undifferentiated block and the paragraph stops being a unit the eye can see. At a
+       quarter we are at 11.9 against ~10, which is close. A fifth would be past it. */
+    --block-pad: calc(var(--rhythm) / 4);
 }
 
 /* The article column. Every zoom level renders into this, so the measure never changes
    under the reader as they scroll left/right — see docs/project/granularity-zoom.md.
    The `margin-inline: auto` centres the column, which is right for a full-width reading
    view and wrong inside a table cell or a pane — in those, apply the four custom
```

## DIFF: src/web/DesignPage.tsx

```diff
diff --git a/src/web/DesignPage.tsx b/src/web/DesignPage.tsx
index b6abc04..f9547ac 100644
--- a/src/web/DesignPage.tsx
+++ b/src/web/DesignPage.tsx
@@ -78,12 +78,23 @@ import { LIBRARY_HREF } from "./router.js";
 const SWATCHES: { group: string; names: string[] }[] = [
   {
     group: "Reading surface",
     names: ["--page", "--panel", "--surface-raised", "--muted", "--rule", "--rule-strong"],
   },
   { group: "Ink", names: ["--ink", "--ink-soft", "--ink-faint"] },
+  {
+    /* The one deliberately LIGHT surface in a dark-only app, and the one whose
+       contrast figure is meaningless as printed: the ratio measured beside it is
+       against our ink, and nothing of ours is ever drawn on it. What sits there
+       is a stranger's picture, whose ink we do not choose and cannot see (the
+       images are cross-origin, so a canvas drawn from one is tainted). It is on
+       this page because a token nobody can look at is a token that drifts —
+       design-css-overview.md § the light sheet under a figure. */
+    group: "The sheet an article's figures are printed on",
+    names: ["--figure-sheet"],
+  },
   {
     group: "The orange",
     names: ["--highlight", "--highlight-ink", "--highlight-wash"],
   },
   {
     group: "shadcn surfaces (CAREFUL: --accent is a surface, not the orange)",
```

## THE PLAN: docs/plans/260828az-figures-in-the-prose.md

```markdown
# Figures in the prose: a light sheet, a way to enlarge them, and less air

**Status: built 2026-08-28.** Three changes to the reading column, asked for together by Greg:

> Improve how we display tables, equations. They seem to be being displayed in dark text on a black
> background. … And add a button to tables and images (and anything else that you think would be
> helpful for the user) to display them in a nearly-full-screen panel/overlay that's easy to
> dismiss. Also reduce the vertical gap between paragraphs.
>
> — Greg, 2026-08-28

## 1. The dark-on-black figures are not a CSS bug

The screenshot Greg sent looks like a table styled in the wrong colour. It is not a table at all.
The article is Wolfram's *What If We Had Bigger Brains?*, and the block is a `<p>` containing one
`<img>`:

```
<p id="spya-jvv6qx"><img src="https://content.wolfram.com/sites/43/2025/05/sw05202025catsbimg1.png"
   width="423" height="144"></p>
```

Downloading three of that article's seven images and reading their headers:

| file | mode | alpha extrema |
|---|---|---|
| `sw05192025computationalimg2.png` | `LA` | 0 – 255 |
| `sw05192025sensorsimg1.png` | `RGBA` | 0 – 255 |
| `sw05202025catsbimg1.png` | `LA` | 0 – 255 |

Every one is **transparent, carrying near-black ink**. They were authored for a white page. Our page
is `oklch(0.145 0 0)`, so the ink lands on black and the only thing you can see is the grey grid
lines. The same is true of the equations, which are also PNGs.

Nothing in the stylesheet can distinguish these from an opaque photograph, because **the alpha
channel cannot be read from CSS, and it cannot be read from JavaScript either**: the images are
hot-linked cross-origin with no `crossorigin` attribute, so drawing one to a canvas taints it and
`getImageData` throws. Detecting transparency would mean proxying or re-hosting every image, which is
stage 1's job and not this change.

So the fix is the blunt one that every dark reader ends up at: **give article media a light sheet to
sit on.** An opaque photograph covers its own sheet exactly, so the only visible cost is the small
padding around it, which reads as a mat. A transparent figure becomes readable. The one case it makes
worse is white-ink-on-transparent, which is rare because the web's default page is white.

`--figure-sheet` goes in `styles/tokens.css` beside the other colours, and applies to `img`, `svg`
and `video` inside `.prose`. Not to `iframe` (an embed paints its own ground) and not to the
article's real `<table>` elements, whose text is already `--ink`.

While we are here, an HTML `<table>` in an article had `th` and `td` drawn identically. The header row
now gets `--muted` and a heavier rule beneath it.

## 2. Enlarging a figure

**One `<button>` per figure, injected into the prose HTML; one overlay for the whole page.**

`src/web/zoomable.ts` is a pure `html → html` function. It wraps each `figure`, `table`, `pre`, `img`
or `svg` in `<span class="zoomable">` and appends a `<button class="zoom-btn">` after it. Called from
`TableView`'s `proseHtml` memo, **after** `annotateHtml`.

Four things make that safe, and each is the reason an obvious alternative was rejected:

- **After annotation, never before.** `resolveMark` anchors comments in the offset space of the
  block's *rendered text*. Injecting first would not actually move any offsets (see the next bullet)
  but it would put our button through `annotateHtml`'s text-node splitter for no reason.
- **The button holds an SVG and no text**, so `element.textContent` is unchanged and
  `readSelection`'s `Range.toString().length` arithmetic (selection.ts) cannot drift. This is checked
  in `tests/zoomable.test.ts` rather than left as a comment.
- **`<span>`, for every kind, including tables.** A `<div>` inside a `<p>` would make the parser
  close the paragraph, so `React`'s `innerHTML` would produce a different tree from the one we
  serialised — a block silently splitting in two. A `<span>` closes nothing: in the "in body"
  insertion mode `<table>`, `<pre>` and `<figure>` close an open `<p>`, not an open `<span>`. The
  test asserts serialise → parse → serialise is a fixed point for all five shapes.
- **`<button>` is on the sanitiser's `FORBID_TAGS`** (`src/sanitize-policy.ts`), so an article can
  never ship one of its own. A `.zoom-btn` in the prose is ours by construction.

Images are also clickable directly (`cursor: zoom-in`), except when they sit inside an `<a>` — there
the link wins, because that is what the author meant. Tables and code are button-only: a click inside
them is someone selecting text.

Images narrower than 64 declared pixels get no button. That is the spacer/icon/tracking-pixel floor;
the narrowest real equation in the corpus is 232px.

### The overlay

`src/web/Lightbox.tsx`, one instance, rendered by `TableView`. It is a native `<dialog>` opened with
`showModal()`, which is the boring 2026 answer and buys four things we would otherwise hand-roll:
Escape closes it, the background goes `inert`, focus is trapped and restored, and the dialog is in
the **top layer** — so it is above the spine (45), the dock (96) and the tooltip (100) without
joining the z-index budget at all. Dismiss by Escape, by the ✕, or by clicking the backdrop.

The content is the zoomed element's own `outerHTML`, already sanitised at ingress, rendered into a
`.prose` container so a table keeps the article's own table styling. The panel is
`min(96vw, …) × 92dvh` and scrolls in both directions, which is the point for a wide table.

## 3. Less air between paragraphs

`--block-pad` was `--rhythm / 3` (7.9px), so the gap between two paragraphs was two of them, 15.9px.
It is now `--rhythm / 4` (5.95px), gap 11.9px — half a rhythm unit. Every other gap in the column is
written as a multiple of `--block-pad`, so the heading proportions (twice as much space above as
below) come along unchanged. This is the second time this number has come down; see the note in
`styles/tokens.css`.

## What could still be wrong

- **A photograph now has a light mat.** Nobody has looked at this corpus's photographs on a phone.
  It is one `padding` value in `styles.css` if it reads badly.
- **The sheet is unconditional.** A figure authored *for* a dark page — white ink on transparent —
  is now invisible where it used to be fine. No article in the corpus has one, and there is no way to
  detect it, but it is a real regression class rather than a hypothetical.
- **`<dialog>` is a third modal pattern** in a codebase that already has hand-rolled
  `role="dialog"` panels (`CommentDialog`, `ChatDialog`, `AnnotateDialog`) and Radix under shadcn.
  Justified here because this is the only *modal* one — the others deliberately let you keep reading
  behind them — but if a fourth arrives, the three should converge.

## The research behind the two library choices

Done by a Sonnet subagent, 2026-08-28, following
[third-party-library-selection.md](../reusable/third-party-library-selection.md).

**The sheet.** Wikipedia's night mode is the best-documented version of this exact fight. Their
[recommendations](https://www.mediawiki.org/wiki/Recommendations_for_night_mode_compatibility_on_Wikimedia_wikis)
apply a `skin-invert` class **by hand**, only to images an editor has certified as "completely black
or dark grey", and say in as many words that inversion "should be avoided in any case where any
colours other than black are used" — a hazard diamond or a flag comes out wrong. Their
[write-up of the rollout](https://diff.wikimedia.org/2024/07/17/dark-modes-bright-future-how-dark-mode-will-transform-wikipedias-accessibility/)
gives the reasoning. GitHub does nothing automatic and pushes the problem back to authors via
`<picture>`; Obsidian's answer is a per-image opt-in plugin; Pocket, Instapaper and the browsers'
own reader modes do nothing at all. Nobody has a better answer than a light card. The canvas
tainting that rules out detection is
[MDN, CORS-enabled image](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image).

**The overlay.** `react-medium-image-zoom` (~936k/wk) and PhotoSwipe (~551k/wk) are image viewers and
assume a gallery; `yet-another-react-lightbox` has a custom-slide escape hatch for arbitrary content
but still carries the slideshow model; `react-zoom-pan-pinch` is a pan-zoom wrapper, not a modal.
None of them wants a `<table>`. Against that,
[`<dialog>` + `showModal()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)
has been Baseline-widely-available since 2022 and gives the focus trap, the Escape, the `inert`
background and the [top layer](https://www.htmhell.dev/adventcalendar/2025/1/) for nothing. Its two
gaps — backdrop click, and background scroll — are the two things handled explicitly in
`Lightbox.tsx`. The download figures above came to the agent through search summaries rather than a
fetched npm page, so treat them as approximate; nothing about the decision turns on them.

## See also

- [design-css-overview.md](../project/design-css-overview.md) — where a style lives, the vertical
  rhythm, and § Content that cannot reflow, which this extends
- [reading-view-overview.md](../project/reading-view-overview.md)
- [security.md](../project/security.md) — why `<button>` is forbidden in article markup
- [comments.md](../project/comments.md) — the offset space the injected button must not disturb
```
