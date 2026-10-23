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

- **The reading measure** — which the previous app really did ship, as `max-w-[65ch]`, and which
  is `56ch` since 2026-10-22, because a `ch` is not a character (§ The measure, counted in real
  characters, next). Since
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

## The measure, counted in real characters

> I did a rough count of the number of characters visible horizontally, and I think it was more like
> 70. … between sort of about 45 and 65. … where we can, stay within these bounds. … I think it's
> important that when we have space, that we are optimizing the reading experience.
>
> — Greg, 2026-10-21 (`spya-vywcpu`)

**The rule: when the window has room, a line of the article holds about 60 characters (the median,
spaces counted), and at most about 65 on nine lines in ten.** Where the window is narrower than
that, the column takes the window and holds fewer — a phone in portrait gets about 42, and that is
the screen's limit, not a choice. A mode beside the prose can take it below 45 too; that trade is
the mode's to make.

**`ch` is the width of a "0", not of a character.** In Source Serif 4, the author's face, a zero is
8.82px at 17px and the average prose character 8.19px, so `65ch` — the number carried from the
previous app — held a median of 70 characters, and its longest lines 80. Nobody had counted until
Greg did. `--reading-measure` is `56ch` ([`styles/tokens.css`](../../styles/tokens.css)), which
counts out at median 60, 90th percentile 64.

- **Change the measure only by counting it**, never by writing the number of characters you want as
  `ch`: `scripts/measure-line-length.ts` counts the non-final lines of prose paragraphs at least
  three lines long, in Playwright at Greg's iPad (725 wide, at Default, Large and Largest), an 820
  iPad, a 1194 iPad in landscape, a 1440 desktop at all four text sizes, and two phones. It exits 1 when a column at the measure is below median 45,
  over median 62, or over 66 at the 90th percentile. **Change the author's face and you have changed
  the measure**, so run it then too.
- **`PROSE_ALONE_MAX_REM` in [`layout.ts`](../../src/web/layout.ts) was a copy of the measure** in
  rem, for the layout's arithmetic, and must never be *narrower* than it: the script fails when a
  window 1000px or wider has a column narrower than the measure, which is that copy clipping it.
  It is deliberately looser than the measure: 42rem against the ~34 the measure and its pads need,
  because bringing it down also widens the mode bands on mid-sized windows and brings Marginalia's
  notes closer to the text. Greg, asked
  ([q-z3j0ep](../user-feedback/questions/q-z3j0ep.md)): *"Maybe somewhere in the middle? Dunno.
  Take screenshots, use your judgment."* (2026-10-22). So it is a middle chosen from screenshots
  ([261023a](../plans/261023a-reading-column-cap-a-middle-value.md)), not a stale number to fix.
- **The text size keeps the count**, because `ch` grows with the type: Large holds the same ~60 in
  a wider column, and only when the window runs out does a bigger size mean fewer characters.
- **Narrower things are written relative to it**: a quotation and a callout are
  `calc(var(--reading-measure) - 7ch)`, so they stay narrower whatever the measure is. A fixed
  58ch, as they were, would have come out wider than the body at 56.
- **On a phone the margins are already the minimum we can give**: at 390 wide on a touch screen the
  first glyph is 21.6px in (the 12px spine and 0.6rem) and the last ends 20px from the edge, which
  holds the reading mark and its inset
  ([narrow-window.css § a no-hover screen](../../src/web/styles/narrow-window.css)). What is left is
  a few pixels, under half a character.

**Leading and paragraph spacing were checked against the evidence and left alone.** 1.6 sits inside
the flat optimum the studies find (roughly 1.2–1.6; 1.8 measured worse), and there is no screen
evidence on paragraph gaps at all, so § Vertical rhythm stays Greg's call. The one leading fault
found was a footnote mark or exponent opening up its own line by about 4px; `.prose :is(sup, sub)`
is `line-height: 0` now. The evidence, and the one citation of ours it corrected:
[261022a](../research/261022a-reading-measure-line-spacing-and-paragraph-spacing-evidence.md); the
plan, [261022d](../plans/261022d-reading-measure-in-real-characters.md).

## A face per voice

For every reader, on every page, since 2026-10-02: the author, the model and the reader each get
their own face — a serif, iA Writer Quattro and Arial — and Geist stays the chrome. The rule,
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
0.88rem. They occupy similar places without doing one of the six jobs. Skim's question before a
quote (`.skim-cue`) does a body line's job but stays 0.78rem: Greg asked that it be smaller than the
quote, and in the model's typed face, wider than the serif, a body-sized line reads larger than the quote beside it (plan
[261009j](../plans/261009j-skim-question-optional-and-the-border.md)). The open Skim stop's section heading
(`.skim-row.current .skim-place`) is 0.82rem rather than `--type-item`, so the quote under it is
read first; the other rows keep the role (plan [261009m](../plans/261009m-skim-quieter-open-stop.md)).

**Left out on purpose:** Timeline's and Ideas' group blurbs (small explanatory copy, neither meta
nor body); Marginalia, drawn small beside the prose; Structure and the outline, which size rows by
distance on their own `--structure-tier-*` scale; Diagram, Sketch and Illustrated, whose type is
part of a fixed composition; Chat, whose turns are prose; and everything outside the band.

[`tests/type-roles.test.ts`](../../tests/type-roles.test.ts) holds each moved line to its token and
each exception to its literal; a line that never joins its registry is not caught. The plan, the
measurements and what was passed over:
[261008k](../plans/261008k-text-styles-for-the-recurring-lines-in-a-mode-band.md).

## The smallest text

> I like the way it cites all of its sources, but the font is too small and they're too close
> together for an iPhone. … make a minimum size, especially on an iPhone, but maybe in general, and
> make a minimal update to our sort of design system documentation to avoid this problem going
> forwards.
>
> — Greg, 2026-10-20 (`spya-y4yhnp`)

**On a touch screen, no text comes out under 13px.** Write any size that might go under it as
`font-size: max(var(--text-min), <the size>)`. `--text-min` lives in
[`tokens.css`](../../src/web/styles/tokens.css). It is 0px with a mouse. Under
`any-pointer: coarse` it is `max(13px, 0.8125rem)`: 13px at the browser's own root, growing with a
reader's larger text size, so a tiny id grows with everything else instead of sitting at 13px
through every setting. A size that is already bigger keeps its value, and desktop is unchanged.
It uses `any-pointer`, as the 16px field rule does
([touch.md](touch.md#how-big-a-thing-has-to-be-to-press-it)), because type is not rationed
chrome.

The six text roles above take the floor in their token definitions, and so does Tailwind's
`tw:text-xs`, once, in [`tailwind.css`](../../src/web/tailwind.css)'s `@theme inline`. An
arbitrary `tw:text-[0.68rem]` does not, so write those as a token or a class.

[`tests/minimum-text-size.test.ts`](../../tests/minimum-text-size.test.ts) holds an exact baseline
of every small literal size that skips the floor: in a stylesheet (`font-size` or `font:`), or as
an arbitrary `tw:text-[…]`. A new one fails, and so does a floored one left in the list. It cannot
see an `em` that comes out small against a small parent, so a computed sweep at 390 is the real
check. Most of what it still lists is Diagram, Sketch and Illustrated, whose type is part of a
drawing, and the dense admin and feedback pages. Plan
[261021c](../plans/261021c-minimum-text-and-touch-target-sizes-on-a-phone.md) has the
measurements.

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

**A model's answer has its own gap between paragraphs: `--answer-gap`, one em**
([`tokens.css`](../../src/web/styles/tokens.css)). Anything that draws a model's answer as
paragraphs puts it between them, rather than picking a number: Chat (and every mode that draws a
conversation through it), the AI's answer to a comment, and Help's *Ask*. Chat's 0.6rem was barely
more than the space between two of its lines, so an answer read as one block (Greg, 2026-10-21,
`q-x0y2gh`: *"follow best practices … so that, you know, everything's better going forwards by
default"*). It is a top margin on the second block, so it collapses with whatever bottom margin a
surface already has and leaves the space after the answer alone. Left out: a single `pre-wrap`
element (Quiz's reply, Referee's notes, the Guide's offer), where a blank line is already a full
line; Summary, which has its own 0.9rem; and Dig deeper and Glossary's lookups, which are short
fragments rather than an answer you read down. Plan
[261022e](../plans/261022e-phone-tap-bar-at-40px-and-a-wider-gap-between-paragraphs-of-model-answers.md).

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

## The reader's text size scales the root

**Since 2026-10-19 a reader can make everything bigger** — `/profile` → Settings → Text size:
Default, Large, Larger, Largest, which set `<html>`'s `font-size` to 100 / 112.5 / 125 / 137.5%
([`styles/reading-comfort.css`](../../src/web/styles/reading-comfort.css),
[`reading-comfort.ts`](../../src/web/reading-comfort.ts)). Greg asked for it on an iPad home-screen
app, where there is no browser zoom:

> If I had to guess, I suppose I would imagine that we'd want to change all of the text sizes
> accordingly, that we'd have some kind of global baseline or default or whatever, and everything is
> sized relative to that.
>
> — Greg, 2026-10-18 (`spya-ast8cu`)

**The root is the baseline, so the rule for new code is one line: size type in `rem`.** Then it
follows the setting with nothing else to remember — the prose, its headings, a mode's rows, the
controls, all in proportion, so the hierarchy is kept. A `font-size` in px does not follow, and
[`tests/reading-comfort.test.ts`](../../tests/reading-comfort.test.ts) fails on one — including in a
`font` shorthand — outside an exact allowlist with a reason (a px floor beside a rem, like
`max(1rem, 16px)`, passes).
It reads stylesheets only: a px size inline in TSX (a Tailwind `text-[11px]`, an SVG `fontSize`)
is not checked, so do not write one for text a reader reads. The JS layout
follows because it reads the root (`reader/measure.ts` § `useRootFontPx`), the same path a reader
whose browser default is 20px has always taken.

What does not follow, on purpose: media queries (a `rem` there is the browser's initial size, never
the root's, and ours are px anyway), Lucide icons, the px rows [controls.md](controls.md) names,
and `layout.ts`'s screen thresholds — `MODE_MIN`, the prose floor, the 700px point where a band
starts covering the prose — which are widths of screen, so at Largest the prose they protect holds
fewer characters than at Default. Accepted for v1; the layout and rotation sweeps run at 18 and
22px roots so it at least never overflows. Why the root rather than `--reading-size` alone, which only the paragraphs follow:
[261019g](../plans/261019g-reading-comfort-on-profile-brightness-and-text-size.md), after
[261003a](../plans/261003a-reading-text-size-setting.md) measured the inverted hierarchy that gave.

## See also

- [design-css-overview.md](design-css-overview.md) — the map this was split out of:
  the stylesheets in load order, which mechanism owns which rule, and the colour tokens
- [original-version/typography.md](original-version/typography.md) — where Geist, the 65ch
  measure (56ch since 2026-10-22) and the Georgia that never shipped came from
