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

## What GPT Sol's review of the built code changed

Eight findings, 2026-08-28
([the review](figures-in-the-prose-review-sol.md)). It opened *"I would not ship this yet"*, and it
was right. All eight are fixed; every one of them **failed silently**, which is the pattern this
repo keeps meeting ([silent-success.md](../reusable/silent-success.md)).

1. **The sheet selector was a child selector, so it missed every captioned figure.** `.zoomable >
   :is(img, svg)` — but when the wrapper holds a `<figure>` or a `<picture>`, the media is a
   *grand*child. Loose images came right and figures went on rendering dark-on-dark, which is the
   worst possible shape for a bug: it looks fixed. It is a descendant selector now, with
   `:not(.zoom-btn *)` to keep the sheet off the enlarge control's own icon.
2. **Wrapping a `<picture>`'s `<img>` silently disabled its `<source>`s.** `<picture>` works by the
   `<img>` being its child; move the image into a wrapper and every reader gets the fallback file.
   Nothing errors and the page looks right — it is just the wrong image. `picture` is now a zoomable
   target in its own right, wrapped whole.
3. **An internal link inside an enlarged table jumped behind the overlay.** The delegated handler
   that gives every other `#spya-…` link its behaviour lives on the reading table's `<tbody>`, and
   the dialog is not inside it — so the browser did its own hash jump, landing under the sticky bars
   with `?at=` still claiming the reader had not moved. `Lightbox` now resolves them itself and
   closes first.
4. **An article could forge the enlarge control.** The sanitiser allows arbitrary `class`, and the
   click handler found the button by class alone; forbidding `<button>` does not settle ownership.
   `zoomable` and `zoom-btn` are now reserved class names in
   [`sanitize-policy.ts`](../../src/sanitize-policy.ts), `data-zoom-kind` is forbidden, the handler
   also names the tag, and `SANITIZER_VERSION` goes 2 → 3.
   **Reading that list turned up a second gap that has nothing to do with this change:** the file's
   own header has named `chat` as a reserved class since chat marks landed, and the hook's list was
   `["cmt", "term"]` the whole time. `tests/sanitize.test.ts` had a test for exactly that case which
   could not see it — it asserted `not.toContain("data-chat")`, and `class="chat"` does not contain
   the string `data-chat`. Both fixed here.
5. **The page behind could still scroll**, from a gesture starting on the backdrop or the panel's
   padding, neither of which touches the content scroller. `overscroll-behavior: contain` is on the
   dialog too now.
6. **A wrapped `<pre>` got its UA margins back.** `.prose > * { margin: 0 }` is a *child* selector,
   so a `<pre>` that gains a wrapper stops matching it and Chrome's `margin: 1em 0` returns — one
   kind of block spaced differently from every other, in a column whose whole story is that every
   gap is a multiple of `--block-pad`.
7. **`width="0"` was not treated as tiny.** `getAttribute` returns `null` when absent and
   `Number(null)` is `0`, so `w > 0` read "no width declared" and "declared as zero" as the same
   thing — and a zero-width tracker got a wrapper, a light sheet and a button.
8. **A `<button>` inside an `<a>` is invalid content model.** A picture that is *only* a link is now
   wrapped from outside the link, so the button is the link's sibling. Only when the link has no
   words of its own: a sentence-length `<a>` containing a small image is a link with a picture in it,
   not a linked picture.

It also said the tests overclaimed, naming `<picture>`, zero-width images, forged classes and
linked-image semantics. Those are all in `tests/zoomable.test.ts` and `tests/sanitize.test.ts` now.
Its one remaining objection stands and cannot be fixed from a test file: **the round-trip property is
proved in jsdom, and Chrome is a different parser.** That is what the browser pass is for.

Two things it looked for and did not find, worth recording because they are the two that would have
been worst: no offset drift from the injected icon, and no state-sync defect in the
`showModal`/Escape/`close` paths.

## What the browser pass found

A Sonnet subagent, in Chrome, on the two articles in the corpus that have anything to enlarge
(2026-08-28). Twelve checks, and the ones worth writing down:

- **The figure is readable.** `spya-jvv6qx` and `spya-ydm67n` draw dark ink on `rgb(244, 243, 240)`,
  confirmed from the computed style as well as by looking. That is the whole ask, answered.
- **The overlay is genuinely bigger**: 423px in the column, ~854 in the panel — which is the file's
  own width, so the enlargement is real pixels rather than a scaled-up 423.
- Escape, backdrop and ✕ all dismiss, and the article is scrollable after each. The masthead and the
  dock are both *under* the backdrop, so the top layer is doing what it was chosen for.
- `scrollWidth - clientWidth` is 0, and a drag-select still opens the comment dialog quoting the
  right words — which was the check that mattered most, because the injected buttons live in the
  offset space comments are anchored in.
- `td.text` pads by 5.95px, and the reader's judgement on the tighter spacing was "tighter than
  before but not cramped, not a regression worth reverting."

**And one finding, which is fixed above:** 16 buttons against 11 figures on the Noema article, and
every one of those figures is a **pull quote** — a `<blockquote>` in a `<figure>`, which is exactly
what the tag is for. A ⤢ on a paragraph that already fits the column, and which would enlarge to the
same words, is a control that does nothing while claiming otherwise. A `figure` now earns its button
only by containing something that does not reflow (`FIGURE_CONTENT` in zoomable.ts).

Two things it could **not** exercise, stated rather than glossed: there is no `<picture>` anywhere in
the corpus, so that fix is covered by the unit test alone; and no article here has an image with a
`<figcaption>`, so the "caption travels with the picture" path is likewise test-only.

## What could still be wrong

- **A photograph now has a light mat.** Nobody has looked at this corpus's photographs on a phone.
  It is one `padding` value in `styles.css` if it reads badly.
- **The sheet is unconditional.** A figure authored *for* a dark page — white ink on transparent —
  is now invisible where it used to be fine. No article in the corpus has one, and there is no way to
  detect it, but it is a real regression class rather than a hypothetical.
- **`SANITIZER_VERSION` went to 3**, so every stored artefact is re-cleaned on its next read. That
  is the stated cost of a stricter policy and it is one sanitise per article, but it is a cost.
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
