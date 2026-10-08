# Typography

Up: [design-css-overview.md](design-css-overview.md)

> **Split out of [design-css-overview.md](design-css-overview.md) on 2026-09-07**, verbatim apart
> from the heading levels and a couple of "see above" links that had to become cross-doc ones. That
> doc is still the map — the stylesheets in load order, which mechanism owns what, the colour
> tokens. This is one area of the territory.

**Geist is the base face and the chrome.** It is self-hosted from
`@fontsource-variable/geist`, imported at the top of
[`tailwind.css`](../../src/web/tailwind.css) with the system stack behind it. Author, model and
reader words override that base with the faces in [fonts.md](fonts.md).

| Token | Used for |
|---|---|
| `--font-sans` | Geist — the family itself. Nothing should name this directly; use one of the two below |
| `--font-reading` | the default reading stack before a voice-specific override |
| `--font-ui` | chrome: controls, masthead facts. The table's column headers wore it until 2026-09-05, when that row lost its height — it is still in the DOM for the fisheye panels' geometry and for a screen reader, and sets no type at all |
| `--font-mono` | Geist Mono — counts, and anything that wants to line up |
| `--font-id` | Courier — block ids, and only block ids (Greg's ask) |
| `--font-brand` | Geist — the wordmark, and only the wordmark. Trebuchet MS until 2026-09-08 |

`--font-reading` and `--font-ui` both resolve to `--font-sans` today. They remain separate base
tokens so changing the unvoiced reading stack is one decision. Visible provenance is a different
decision, carried by `--font-author`, `--font-ai` and `--font-reader` as [fonts.md](fonts.md)
describes.

**Georgia was here until 2026-08-25, and it should not have been.** The story is worth knowing
because it is a documentation failure rather than a design one. Our own notes on the previous app
([original-version/typography.md](original-version/typography.md)) reported a research doc
recommending Georgia at 17px on an x-height argument, and that recommendation was carried into
`tokens.css` as though it were what the previous app had shipped. Checking the actual repo shows it
never shipped: `app/globals.css` sets `body { font-family: Arial, Helvetica, sans-serif }`, Geist
Sans sits behind Tailwind's `--font-sans`, and Georgia appears nowhere in it. Its reading surface
was sans, headings and body in the same face. Greg, 2026-08-25, asked to *"follow how we were doing
fonts in the previous version"* — so we now follow what they did rather than what they wrote down.

That 2026-08-25 decision still supplies the base tokens. Since 2026-10-02 the article, model and
reader voices deliberately differ from the chrome; [fonts.md](fonts.md) owns the current rule.

Two numbers from that research doc *are* worth keeping, because they are independently attested:

- **65ch**, the reading measure — which the previous app really did ship, as `max-w-[65ch]`. Since
  2026-09-04 it also **sits in the middle of whatever cell it is given**, in every mode and at every
  width — Greg: *"Always centre the Text view within its column when visible, no matter which mode
  is active."* Three rules carry it and each is commented where it lives:
  [`styles/prose.css`](../../src/web/styles/prose.css) § text centres `.prose`;
  [`styles/gutter.css`](../../src/web/styles/gutter.css) § the gutter moves the reader's
  icon column the same distance; and
  [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css) § the title over the column
  puts the masthead on the prose's own left edge wherever the two share a box. (There was a
  fourth, § the header over the article's column, which did the same for `Text verbatim`. The column-header row lost its height on
  2026-09-05 and its labels became `.sr-only` spans, so there is no heading left to align and the
  rule went with it.) **Everything that names the text follows it; nothing
  that names the row does** — the search bar and `row-active` stay at the cell's edge on purpose,
  and the footnotes opt out as a block, both for reasons given in place. All three are self-limiting:
  below about 900px the measure is wider than the cell and none of them does anything. The separate
  mechanism that centres the whole *table* when the article is the only thing on the page is
  `.reader.text-alone table.zoom` in [`styles/narrow-window.css`](../../src/web/styles/narrow-window.css), and
  `PROSE_ALONE_MAX_REM` in [`layout.ts`](../../src/web/layout.ts) — **its
  masthead follows the prose too, and learning that it did not was the expensive part.** Two correct
  changes landing on two branches, one moving the prose within its cell and one widening the cell,
  each left that rule re-centring a box it no longer described; the errors added rather than
  cancelling and the title ended up 22.5px out. Neither branch's tests could see it, because neither
  branch was wrong. [260904b-gutter-help-button-and-detached-streaming-chat.md § the merge](../plans/260904b-gutter-help-button-and-detached-streaming-chat.md#the-merge).
- **Space above a heading exceeds space below it** — `mt-6` against `mb-4` in their document
  viewer. We had lost this; every block here is a table row and every row had the same padding, so
  a heading sat exactly halfway between the section it ended and the one it introduced. It is back,
  as `td.text.kind-heading` in [`styles/prose.css`](../../src/web/styles/prose.css).

`TableView` writes `kind-<the splitter's kind>` onto every cell, so that hook now carries two more:
`kind-callout`, an indent and a big faint quote mark ([260831ae-callouts-the-box-the-author-drew.md](../plans/260831ae-callouts-the-box-the-author-drew.md)),
and `kind-caption`, which had never been styled at all.

## A face per voice

For every reader, on every page, since 2026-10-02: the author, the model and the reader each get
their own face — a serif, IBM Plex Mono and Arial — and Geist stays the chrome. The rule,
the tokens, and how to put a new element in its voice: **[fonts.md](fonts.md)**.

## Text roles in a band

The same jobs recur in every mode band's rows, and until 2026-10-08 each mode gave them its own rem —
a row's main line anywhere from 0.88 to 0.96. Greg, 2026-10-08 (`q-dhnbhw`):

> I think as much as anything, I'm trying to lay foundations so that development goes faster and is
> more likely to produce good results without too many rounds of iteration going forwards.

So six tokens, named by job, in [`src/web/styles/tokens.css`](../../src/web/styles/tokens.css):

| Token | Job | Value |
|---|---|---|
| `--type-item` | a row's main line, the thing you scan down | 0.92rem |
| `--type-quote` | verbatim source words under a row — the article's, or a cited page's | 0.88rem |
| `--type-body` | a sentence under the row that explains it | 0.85rem |
| `--type-meta` | a small line: where, when, from whom | 0.78rem |
| `--type-count` | a number standing for how many | 0.83rem |
| `--type-label` | a group's small uppercase heading | 0.77rem |

**The rule: a line in a band that does one of these jobs uses its token; anything else may pick its
own.** A button, a status line or a number in a chip keeps its odd value — the aim is that the six
jobs are settled, not that every number is. `/design` § Text roles shows each against the voices it
meets.

**A role is decided by the line's job in its row, not by whose words they are.** In Quotes the
quotation *is* the row, so it is `--type-item`; under a Debate title, a quotation is `--type-quote`.
Search's results are Quotes' case. Face is a separate decision, [fonts.md](fonts.md)'s.

**Exceptions, each with a comment beside the rule:** Quiz's one question stays 1.03rem; Debate's
foldable claim quotation stays 0.85rem; Mirror's reader-written criterion and block-id fallback stay
0.88rem. They occupy similar places without doing one of the six jobs.

**Left out on purpose:** Timeline's and Ideas' group blurbs (small explanatory copy, neither meta
nor body); Marginalia, drawn small beside the prose; Structure and the outline, which size rows by
distance on their own `--structure-tier-*` scale; Diagram, Sketch and Illustrated, whose type is
part of a fixed composition; Chat, whose turns are prose; and everything outside the band.

[`tests/type-roles.test.ts`](../../tests/type-roles.test.ts) holds each moved line to its token and
each exception to its literal; a line that never joins its registry is not caught. The plan, the
measurements and what was passed over:
[261008i](../plans/261008i-text-styles-for-the-recurring-lines-in-a-mode-band.md).

## Weight, and the variable axis

`--reading-weight` is **450, not 400**. Light text on a dark ground optically thins; the previous
app's own wishlist named the fix — *"add ~50 to the weight axis in dark mode"* — and could not use
it, having no variable face. Geist's axis runs 100–900, so we can. It is 400 on the light theme
(`:root[data-theme="light"]` in [`styles/tokens.css`](../../styles/tokens.css)), since 2026-10-03.

## Vertical rhythm

`--rhythm` is `17px × 1.4 ≈ 23.8px`. Theirs, and it is arithmetic rather than evidence — but good
arithmetic, and the thing that makes a page look considered rather than assembled.

Every vertical gap **in the article column** is a multiple of `--block-pad`, which is a quarter of a
unit: one pad above and below each block (so two pads — half a unit, 11.9px — between paragraphs),
two above a heading, half a pad below. **`--block-pad` is the one number to change** if the article
wants more or less air; every rule is written as a multiple of it, so the heading spacing keeps its
proportions on its own. It has come down twice on Greg's asking — half a unit until 2026-08-27, a
third until 2026-08-28 — and there is a floor below this that is not arithmetic: at 17px/1.6 the
whitespace *between two lines of one paragraph* is around 10px, and once the gap between paragraphs
stops clearly exceeding that, the paragraph stops being a unit the eye can see. A fifth would be
past it.

**The column ends with a mark**: a short hairline, a small diamond, a short hairline, in a footer
row after the last block, six pads above it and eight below. Greg, 2026-10-04 (report
`spya-zgf8p2`): *"Add some subtle pleasant visual marker at the very end of the article in the text
column to show that it is the end."* It is a `<tfoot>` and not a block, so nothing that finds a
block can find it; `TableView.tsx` § Where the article ends and `prose.css` § the end of the article
say why, and the plan is
[261005e](../plans/261005e-an-end-of-article-mark-and-the-publication-date-on-the-shelf-card.md).

**Scoped to the reading column on purpose.** The chrome keeps its per-rule `rem` values; sweeping
1,800 lines onto a scale is a different job, and Greg scoped this one to the article. Do not reach
for `--rhythm` or `--block-pad` outside `.prose` / `td.text` — the one exception is the section of
`/design` that exists to display them.

## Content that cannot reflow

A code block or a data table in an article is as wide as its widest line and neither will wrap.
`.prose pre` and `.prose table` now scroll inside their own box. Until 2026-08-25 nothing stopped
either, and the consequence was worse here than in most layouts: the *page* scrolls horizontally in
this view by design, and the masthead, the spine and every sticky bar are pinned to that scroll —
so one wide code sample in one paragraph dragged the whole article's furniture off to the left.

`display: block` on the `<table>` is load-bearing and is not a typo: `overflow` does nothing on
`display: table`.

## Content that cannot be read at all: the light sheet under a figure

Added 2026-08-28. Greg, looking at Wolfram's *What If We Had Bigger Brains?*: *"Improve how we
display tables, equations. They seem to be being displayed in dark text on a black background."*

They were, and **it was not a colour bug.** The block is a `<p>` containing one `<img>`, and all
seven of that article's images are PNGs with an alpha channel carrying near-black ink — equations
and data tables, drawn for a white page and served onto ours. The alpha extrema are in
[260828az-figures-in-the-prose.md](../plans/260828az-figures-in-the-prose.md).

So `.prose .zoomable > :is(img, svg)` sits on `--figure-sheet`, an off-white, with a small mat of
padding. Three things about that are worth knowing before changing it:

- **It is unconditional, and it has to be.** CSS cannot see an alpha channel, and JavaScript cannot
  either: article images are hot-linked cross-origin with no `crossorigin` attribute, so a canvas
  drawn from one is tainted and `getImageData` throws. Per-image detection would mean proxying every
  image, which is stage 1's job. Wikipedia's night mode reached the same conclusion the long way
  round — their `skin-invert` class is applied *by hand*, to images an editor has certified as pure
  black, precisely because `filter: invert()` wrecks anything with a real hue.
- **An opaque photograph covers its own sheet exactly**, so the only visible cost is the mat. The
  case this makes worse is white-ink-on-transparent, which is rare because the web's default page is
  white — but it is a real regression class, not a hypothetical.
- **The scope is `.zoomable >`, and that is a guard, not a coincidence.** A 1×1 tracking GIF given
  this rule is a pale square in the middle of a sentence.
  [`zoomable.ts`](../../src/web/zoomable.ts) already decides what counts as a figure (it skips an
  `<img>` under 64 declared pixels), so hanging the sheet off its wrapper makes that judgement once,
  in the only place that can see the width attribute.

The same wrapper carries the **⤢** that opens [`Lightbox.tsx`](../../src/web/Lightbox.tsx) — one
figure, near-full-screen. That is a native `<dialog>` opened with `showModal()`, so it is in the
browser's **top layer** and so does not appear in the z-index budget at all
([design-css-overview.md § the stacking order](design-css-overview.md#the-stacking-order-which-is-real-even-though-it-is-not-a-scale));
its header says what else the platform's modal gives for free, and what it does not.

## See also

- [design-css-overview.md](design-css-overview.md) — the map this was split out of:
  the stylesheets in load order, which mechanism owns which rule, and the colour tokens
- [original-version/typography.md](original-version/typography.md) — where Geist, the 65ch
  measure and the Georgia that never shipped came from
