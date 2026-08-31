# Decorated mode — a designer's list

34 ideas. Organised by the **channel** each one spends, because that is the thing that will actually
break: a dozen good decorations, each individually defensible, each reaching for colour. The last
section ("The system") is the budget.

One premise runs through all of it. There are **three voices** on this page — the author, the
machine, the reader — and the page should never leave a reader unsure which one is speaking. So:
the author owns the text column and the type; the machine owns the left gutter and small caps and
is never allowed a hue; the reader owns the right margin and the accent. Almost every idea below
is a consequence of that.

---

## A. Setting the author's type

### 1. The three-stop weight ladder

**Sees.** Body prose is set at one weight (say 400 on a variable face). Sentences the model marks
as load-bearing sit at 520 — visibly firmer, but the same size, same colour, same line, no
background. Nothing else on the page is ever bolder than 520.

**Why.** Weight is the cheapest emphasis that doesn't disturb the line. Bumping *size* mid-paragraph
breaks the baseline rhythm and makes the reader's eye jump the intervening words — which is exactly
the "decoration as a way of not reading" failure. Weight keeps the sentence inside its paragraph
while making it findable on a second pass.

**Mechanism.** `font-variation-settings: 'wght' <n>` on a `<span>` wrapping the sentence, or better,
the CSS Custom Highlight API (`Highlight`, `::highlight(key)`) so the DOM is untouched and
overlapping ranges don't need nested spans. Custom Highlight supports weight? No — it does not
(highlight pseudo-elements only take colour/background/decoration/shadow). So: real spans, minted
from block-id + character range, and `font-synthesis: none` so nothing fakes it.

**Data.** New pass: per-sentence rhetorical role and load-bearing-ness (`claim | evidence |
concession | aside | restatement`, plus a 0–1 weight). Sentence offsets keyed to block id.

**Risk.** More than ~2 bold sentences per screen and the page reads as bold-with-holes. Cap it per
viewport, not per article.

### 2. The ink ladder (de-emphasis, not emphasis)

**Sees.** Five fixed steps of ink on the off-white: 100 / 88 / 74 / 60 / 46 percent. Main-line prose
is 100. Asides, parentheticals, long hedged qualifications, and blocks flagged `gistable: false`
drop one or two steps. Nothing changes size.

**Why.** Greg asked for "less important stuff smaller or fainter". Fainter is the better half of that
pair: it preserves the measure and the rhythm, and — crucially — it is *reversible by attention*.
A reader who leans in still reads a 74% line perfectly. A reader who shrank it is being told not to
bother, which is the off-brief version.

**Mechanism.** `color: color-mix(in oklab, var(--ink) 74%, var(--page))` — mix toward the page
colour, not `opacity`, so text over any inserted panel doesn't go milky. Steps as tokens
`--ink-1 … --ink-5`; nothing may invent a sixth.

**Data.** `blocks.json.gistable`, plus the rhetorical-role pass from #1.

**Risk.** Accessibility floor. Step 5 must still clear 4.5:1 on the near-black page, which on a dark
theme means the ladder is shallower than it would be on white. Measure it, don't eyeball it.

### 3. Emphasis by space

**Sees.** The single most important passage in a section is not bigger, bolder, or coloured. It has
one extra line of air above and below it, and its first line is flush where its neighbours are
indented. It reads as a held breath.

**Why.** The Swiss editorial move, and the one most likely to survive twelve other decorations:
negative space is the only emphasis channel that doesn't compete with the other eleven, because
everything else is spending ink. It also slows the reader at the moment we want them slowed — which
is the whole product thesis.

**Mechanism.** `margin-block: 1.5lh` (the `lh` unit keeps the baseline grid intact — 1.5 breaks it,
so use `1lh` or `2lh` and mean it). Paragraph indent handled with `p + p { text-indent: 1em }` so
"flush" is itself a signal.

**Data.** tree.json `gist` + summary citations tell you which block a section leans on hardest.

**Risk.** Almost none, which is why it should be the default emphasis and the others the exceptions.

### 4. Honest wrapping

**Sees.** Generated headings never break to a one-word second line. Paragraphs have no orphans or
rivers. Opening quote marks hang into the left margin so the text block's left edge stays optically
straight down a page with twelve block quotes.

**Why.** This is the difference between "an app that put stuff on a page" and "a designed page", and
it costs three declarations. Ragged left edges around quotes are the single most common tell that a
reading app was never art-directed.

**Mechanism.** `text-wrap: balance` on headings and pull quotes (≤6 lines), `text-wrap: pretty` on
body, `hanging-punctuation: first last`. Add `hyphens: auto` + `hyphenate-limit-chars: 6 3 3` only
if the measure ever goes below ~55 characters.

**Data.** None.

**Risk.** `balance` on long paragraphs is a perf trap and is ignored past a line count anyway;
`hanging-punctuation` is Safari-only in practice, so treat the fallback (no hang) as the design and
the hang as a bonus.

### 5. Optical sizing across the whole page

**Sees.** The 11px marginal gists don't look spindly and the 28px pull quotes don't look bloated.
Small text is a hair heavier and more open; display text is tighter and higher-contrast.

**Why.** A decorated page necessarily spans a huge size range — 11px apparatus to 32px display — and
a single optical cut at both ends is what makes an interface look like a website rather than a book.
This is the cheapest quality signal available.

**Mechanism.** A variable face with an `opsz` axis; `font-optical-sizing: auto` plus explicit
`font-variation-settings: 'opsz' <px>` where auto guesses wrong. Pair with tracking that scales:
`letter-spacing: calc(-0.01em + 0.3px)` style curves, or per-step tokens.

**Data.** None.

**Risk.** Costs a font decision. If the current face has no `opsz`, fake it with tracking + a weight
nudge per size step and don't pretend otherwise.

### 6. Small-caps lead-ins

**Sees.** The first three to five words of each paragraph are set in small caps, letterspaced
slightly, same size, same ink. Nothing else changes.

**Why.** A book convention (and a Bringhurst favourite) that does something no summary can: it gives
the skimmer a legitimate foothold *inside the author's own sentence*. You skim by reading the actual
opening of every paragraph, so skimming is a weak form of reading rather than a substitute for it.
Exactly on-brief.

**Mechanism.** `font-variant-caps: all-small-caps` (real small caps, not `font-size` fakes) on a span
covering the first N words; N chosen by the model at a clause boundary, not by word count, or the
lead-in cuts mid-phrase and looks broken.

**Data.** New pass, or a cheap deterministic rule: to the first comma, capped at 6 words. Model pass
is better — it should stop at a *sense* boundary.

**Risk.** Fights with #1 if a load-bearing sentence is also a paragraph opener. Rule: lead-in wins,
weight bump is suppressed on the first sentence of a paragraph.

### 7. Numerals that behave

**Sees.** Every date, count, percentage and year in the piece is set in tabular lining figures with a
touch more tracking, so the handful of real numbers in an 8,300-word essay are findable without
being coloured.

**Why.** Argumentative essays hang on a very small number of quantities. Making numerals
*typographically distinct* rather than *highlighted* means the reader can locate them on a re-read
without the page acquiring another colour.

**Mechanism.** `font-variant-numeric: tabular-nums lining-nums`; wrap with a span that also sets
`letter-spacing: 0.02em`. Optionally `font-feature-settings: 'ss01'` if the face has an alternate.

**Data.** Regex is 90% of it; a model pass gets units and spelled-out numbers ("three orders of
magnitude").

**Risk.** Over-firing on citation years and page numbers. Exclude anything inside a blockquote
attribution.

---

## B. The gutter — the machine's territory

### 8. The gist rail

**Sees.** In the left gutter, aligned to the top of each tree node's block range, sits that node's
`gist` — 11px, small caps, ink step 4, measure about 20 characters, ragged right. It is sticky
within its range, so as you read a long section the gist stays level with your eye and then hands
off to the next.

**Why.** The single most useful thing a reader loses in long-form is "what is this stretch of prose
*doing*". Putting it beside rather than above means it can be ignored entirely — it never
interrupts the column — and putting it in the gutter, in a different voice, means it can never be
mistaken for the author.

**Mechanism.** CSS grid with a named `gutter` column that exists at every breakpoint (below ~900px
it becomes a collapsed strip, not a stack). `position: sticky; top: 40vh` inside a range-scoped
wrapper. `content-visibility: auto` on off-screen ranges.

**Data.** tree.json — `range`, `gist`, `depth`.

**Risk.** This is the idea most at risk of becoming the way you don't read. Mitigation: gists are
ink step 4 and small caps, i.e. deliberately *harder* to read than the prose. Never full ink, never
serif, never the same size.

### 9. The arc ribbon

**Sees.** Fixed at the top of the gutter, one sentence from arc.json — "where we are in the
argument". As you cross a range boundary the old sentence loses ink over ~200ms and the new one
gains it, in place, no motion.

**Why.** The gist tells you what this section says; the arc tells you why the essay needed it now.
For a piece with the shape "name a bias → refute a theory → draw an ethical conclusion", that second
thing is what a reader is actually missing at word 5,000.

**Mechanism.** `IntersectionObserver` on range wrappers with a `rootMargin` band around the reading
line; cross-fade with `@starting-style` + `transition: opacity` or a view transition on the text
node. Not a slide — motion in the periphery while reading is intolerable.

**Data.** arc.json.

**Risk.** Two sticky things in one gutter (this and #8) is one too many. They must share a stack with
an explicit order and total height cap.

### 10. Load-bearing ticks

**Sees.** A 1px, 8px-long tick in the gutter beside every block that a summary actually cited. Three
summaries citing the same block gives three stacked ticks. A block nothing cited has nothing.

**Why.** It shows the reader where the essay's weight sits, using data we already have and never
otherwise surface. It is also honest in a way a highlight isn't: it says "our summariser drew on
this", not "this is important" — the reader keeps the judgement.

**Mechanism.** Pure CSS from a `data-cites="3"` attribute; `repeating-linear-gradient` on a
`::before`, or three spans. No JS.

**Data.** summary.json's cited block ids, inverted into a per-block count.

**Risk.** Reads as a scrollbar artefact if the ticks are near the column edge. Put them at the far
edge of the gutter, aligned with #14's brackets, so all hairlines share one axis.

### 11. The ideas apparatus

**Sees.** Where an idea from ideas.json occurs, a small superscript numeral sits after the quoted
span — like a footnote reference, in ink step 3, not coloured. The numerals are stable across the
whole article, so idea 4 is idea 4 on page 1 and page 9. Hovering (or focusing) opens a popover with
`statement` and `whyYouNeedIt`.

**Why.** The scholarly apparatus is a thousand-year-old solution to exactly this problem: annotate
without interrupting. Numbering *the propositions rather than the pages* means the reader starts
noticing that idea 4 keeps coming back — which is the actual intellectual content of ideas.json and
is invisible in a per-occurrence tooltip.

**Mechanism.** `popover` attribute + CSS anchor positioning (`anchor-name` / `position-anchor` /
`position-area`) so the card is tethered to the numeral with no JS positioning. `font-variant-position:
super` for a real superior figure, not `vertical-align`.

**Data.** ideas.json occurrences (block id + quoted span).

**Risk.** Ten ideas × several occurrences is a lot of superscripts. Cap: show numerals for
`provenance: assumed` only (the ones the reader is being asked to swallow), unless the reader turns
the rest on.

### 12. Provenance by underline, not by hue

**Sees.** Three underline styles carry three meanings, all in ink: dotted = the piece *assumes* this,
solid hairline = it *argues* it, double = it *cites* someone. Glossary terms keep the existing single
underline. No new colours anywhere.

**Why.** Provenance is the most decision-relevant thing in ideas.json and the thing readers of
argumentative essays most often miss — assumed premises look identical to argued ones in prose. Three
distinct line styles are learnable in about four encounters; three colours would blow the entire
colour budget on one feature.

**Mechanism.** `text-decoration-line: underline`, `text-decoration-style: dotted | solid | double`,
`text-decoration-thickness: from-font`, `text-underline-offset: 0.15em`,
`text-decoration-skip-ink: auto`.

**Data.** ideas.json `provenance`.

**Risk.** `double` at small sizes on a dark page is mush. Test at the real size; fall back to a
thicker single rule if it is.

### 13. The reader's margin

**Sees.** Everything the reader made — comments, bookmarks, notes — lives in the **right** margin, in
the accent, with a small filled square at the anchor line. Everything the machine made lives left, in
grey. The two never swap sides.

**Why.** This is the load-bearing convention of the whole design. A reader scanning back through an
article needs to know at a glance whether a mark is theirs or ours, and side + hue answers it before
they read a word. It also gives the accent exactly one job, which is what keeps the page from
becoming a Christmas tree.

**Mechanism.** Three-column grid: `[gutter] [text] [margin]`, `grid-template-columns:
minmax(0, 14ch) minmax(45ch, 68ch) minmax(0, 16ch)`. Marks positioned with anchor positioning against
the anchored span.

**Data.** comments.json.

**Risk.** Narrow viewports. Below the breakpoint, the reader's margin collapses to an inline
end-of-line marker and the gutter collapses to a strip — and that degraded state has to be designed,
not fallen into.

---

## C. Structure made visible

### 14. The depth bracket

**Sees.** At the far left, hairline vertical rules — one per level of tree depth — bracket the span
they cover, nested. A subsection two levels deep sits inside two brackets. The rule for the section
you are currently inside is one ink step brighter than its parents.

**Why.** A deeply nested tree is the article's real shape and we currently only ever show it as a
list somewhere else. Drawn as brackets beside the prose, it turns "how much longer is this argument"
and "is this a digression or the main line" into peripheral vision rather than a click.

**Mechanism.** `border-inline-start` on nested wrapper elements, one per depth; nothing else. Highlight
the active one with an `IntersectionObserver` toggling a class, or `:has()` on a scroll-marked
descendant.

**Data.** tree.json.

**Risk.** Past depth 4 the brackets eat the gutter. Cap the drawn depth at 3 and let deeper nesting
be implied by indent alone.

### 15. Our headings look like ours

**Sees.** Generated headings for sections the author never titled are set differently from the
author's own: small caps, ink step 3, letterspaced, preceded by a short hairline rule, no size jump.
The author's headings keep the full-ink display setting.

**Why.** An honesty convention, and a cheap one. If we insert headings into someone's essay — which
Greg explicitly wants — the reader must be able to tell which words are the author's. Making it a
*typographic* distinction rather than a label means it costs no space and never has to be explained.

**Mechanism.** Two heading classes; the generated one uses `font-variant-caps: all-small-caps`,
`letter-spacing: 0.08em`, and a `::before` rule of `2ch` width. `text-wrap: balance`.

**Data.** tree.json `title` + `sourceHeading` (null ⇒ ours).

**Risk.** None typographically; the risk is a bad generated heading, which now carries our name.

### 16. The block strip

**Sees.** A 4px-wide column at the extreme left edge of the viewport, full page height: the entire
article as stacked rectangles, one per block, height proportional to word count, ink by rhetorical
role. Your position is a hairline. Click to jump.

**Why.** A progress bar tells you how far. This tells you what *shape* the thing is — where the long
expository stretches are, where the short punchy run of the conclusion starts — which is the
information a reader actually uses to decide whether to keep going.

**Mechanism.** One `<canvas>` or a flex column of divs with `flex-grow: <words>`; position via
`scroll-timeline` / `animation-timeline: scroll(root)` so the indicator needs no scroll listener.

**Data.** blocks.json `words`; roles from the pass in #1.

**Risk.** Becomes a second navigation system competing with the ToC. Keep it silent and unlabelled;
it is a picture, not a control, and the click is a bonus.

### 17. Turn markers

**Sees.** Where a paragraph pivots — "But", "Yet", "The trouble is" — a small mark hangs in the left
gutter at that line: a rotated hairline, like a proofreader's mark. Nothing in the text changes.

**Why.** Argument lives in its turns. A reader tracking an argument's structure is essentially hunting
for these, and hunting for them is what makes a dense essay tiring. Marking them in the margin lets
the eye find the joints of the argument without touching the prose.

**Mechanism.** Anchor positioning against the pivot word's span, so the mark tracks the actual line
after reflow — this is the case anchor positioning was invented for. `position-area: inline-start`.

**Data.** New pass: per-paragraph discourse relation and the pivot token (`contrast | cause |
concession | example | conclusion`).

**Risk.** Over-firing. Cap at one mark per paragraph and only for `contrast` and `concession` — the
two the reader can't afford to miss.

### 18. Voice column

**Sees.** A hairline label in the gutter where the essay changes whose position it is stating:
`SETH` / `THE CRITICS` / `DENNETT`. Ink step 4, 10px, small caps.

**Why.** In a refutation essay, the most common comprehension failure is losing track of whether the
paragraph you are reading is the author's view or the view he is about to demolish. Nothing else on
the list fixes that; this fixes it completely.

**Mechanism.** Sticky within span, same rail as #8 — and therefore competing with it, so see the
budget: gist and voice share the rail and voice wins where both apply.

**Data.** New pass: attributed stance per block span.

**Risk.** Wrong attribution is worse than none — it actively misleads. Needs to be a high-confidence
pass or omitted for the span.

---

## D. Emphasis, honestly

### 19. In-situ pull quote

**Sees.** No duplicated text anywhere. Instead, the sentence that *would* have been pulled stays
exactly where the author put it, and the paragraph containing it opens up: extra air above and below,
the sentence one weight step up, the rest of the paragraph at ink step 2. The paragraph becomes the
pull quote.

**Why.** The classic magazine pull quote is a small betrayal of this product — it prints the good line
twice so you can read it without reading the piece. Doing it in place gives the same visual anchor,
the same page rhythm, and the same "here's the line", but the only way to get it is to be in the
paragraph.

**Mechanism.** A class on the block; `margin-block: 2lh`, sentence span at `'wght' 520`, siblings at
`--ink-2`. No blockquote element, no border, no oversized quote glyph.

**Data.** New pass, or the sentence-level weights from #1 with a per-section argmax.

**Risk.** Doing it more than once or twice a section makes the page pulse. One per tree node, max.

### 20. Hedge dimming

**Sees.** Modal hedges and softeners — "may", "arguably", "it seems likely that", "in some sense" —
drop one ink step. The claim underneath them reads at full strength; the hedging is still fully
present and fully legible, just quieter.

**Why.** Readers systematically mis-read hedged claims as strong ones and strong claims as hedged,
especially when skimming. This makes the *strength* of every claim visible without changing a single
word — which is precisely the constraint we were given, used at its most interesting.

**Mechanism.** Spans at `--ink-2`. Nothing else.

**Data.** New pass: hedge/booster token spans with a strength score.

**Risk.** It is an editorial judgement dressed as typography, and it cuts against the author. A reader
should be able to turn it off, and the tooltip on the setting should say what it is doing.

### 21. Squint

**Sees.** Hold a key (or press and hold on touch). Everything except the load-bearing sentences
softens — a 1.5px blur and two ink steps down — for as long as you hold it. Release and the page is
exactly as it was. It cannot be left on.

**Why.** The single best diagnostic a designer has is squinting at the page, and readers deserve it
too: "where is the spine of this argument" answered in half a second. Making it a *held* gesture is
the whole design — it is impossible to substitute for reading because it does not persist.

**Mechanism.** `filter: blur(1.5px)` + `--ink` override on non-key spans, `transition: filter 120ms`.
Held via `keydown`/`keyup`; guard against the key repeating and against losing `keyup` on blur.

**Data.** #1's sentence weights.

**Risk.** Blur is a motion-sickness and low-vision hazard. Respect `prefers-reduced-motion` by
substituting an ink-only version, and never blur below a legible threshold — the point is *softened*,
not *hidden*.

### 22. The reading band

**Sees.** Paragraphs sit at ink step 2 until they enter a band around the middle of the viewport,
where they come to full ink; they retire to step 2 as they leave. The transition is scrubbed by
scroll, so it tracks your thumb exactly rather than animating on its own.

**Why.** It's the reading-ruler you'd use on paper, and it does something measurable: it kills the
peripheral competition from the next three paragraphs, which is what makes long dense text feel
effortful.

**Mechanism.** `animation-timeline: view()` with `animation-range: cover 30% cover 70%`, animating a
custom property through `@property` so the colour interpolates. No JS, no scroll listener.

**Data.** None.

**Risk.** Some people hate this viscerally, and it interacts badly with #2 (two systems moving the
same channel). Default off; when on, it *replaces* the ink ladder's use of steps 1–2 rather than
stacking with it.

### 23. Entity weight instead of entity colour

**Sees.** Glossary entries above a centrality threshold are set with a half-step weight bump on first
occurrence per section, and keep the existing quiet underline elsewhere. High-difficulty terms get
the underline; low-difficulty ones lose it after their first appearance.

**Why.** Underlining every occurrence of nineteen terms in an 8,300-word essay is visual noise that
carries almost no information after the second occurrence. Decaying the decoration matches how the
reader's need actually decays.

**Mechanism.** Per-occurrence classes computed at build time from occurrence index + `difficulty` +
`centrality`; `font-variation-settings` for the bump, `text-decoration` for the rest.

**Data.** glossary.json `difficulty`, `centrality`, occurrences.

**Risk.** Inconsistency reads as a bug — "why is this one underlined and that one not". Needs one
sentence of explanation available somewhere, once.

---

## E. Inserted matter

### 24. Section overture

**Sees.** At the top of each tree node, before its first paragraph, the node's gist is set once at
reading size in the gutter's grey, followed by a hairline rule the width of the text column. Then the
prose. It is not a box, has no background, and takes about two lines.

**Why.** A one-sentence "here is what the next 900 words do" at the door of a section is the highest
value-per-pixel thing in this entire list, because it converts a wall of prose into an entered room.
Set as apparatus rather than as content, it primes without substituting.

**Mechanism.** Plain flow content, `border-block-end: 1px solid var(--rule)`, `text-wrap: balance`,
`--ink-3`. `content-visibility: auto` on the section for long articles.

**Data.** tree.json `gist`, `range`.

**Risk.** The closest idea on this list to "read the summaries instead". Mitigations: one sentence
only, never the `long` summary, and never at full ink.

### 25. Claim–evidence tether

**Sees.** Hover or focus a claim sentence: a hairline appears down the left of the two or three
paragraphs that support it, wherever they are on screen, and a small marker in the gutter points
off-screen if they aren't. Move away and it's gone.

**Why.** In an argumentative essay, "what backs this up" is the question a critical reader asks
constantly and currently answers by scrolling and losing their place. Showing it transiently, on
demand, is interrogation support — the most on-brief thing we could build.

**Mechanism.** CSS Custom Highlight API for the ranges (`CSS.highlights.set`), anchor positioning for
the off-screen marker, `:has()` to avoid a JS class dance. Highlights are ranges, so they survive
without wrapping spans.

**Data.** New pass: claim → evidence edges, block-id to block-id, with a confidence.

**Risk.** Wrong edges are worse than no edges, and hover-only features are invisible on touch. Needs a
tap affordance and a confidence floor.

### 26. Structure diagram, hairline

**Sees.** At a major section boundary, a small inline SVG: three to five labelled nodes with arrows —
the shape of the argument in that section, nothing more. Hairline strokes, the same grey as the
apparatus, no fills, no colour, about 120px tall.

**Why.** Greg asked for little diagrams. The discipline that makes them work rather than decorate is a
hard node cap: five boxes is a diagram, twelve is a mess that the reader skips. Constrained this hard,
it says the one thing prose says worst — that A and B both feed C.

**Mechanism.** SVG, `stroke: currentColor`, `vector-effect: non-scaling-stroke`, labels as real text
for selection and screen readers. Sized in `ch` so it sits on the type's grid.

**Data.** New pass: ≤5 nodes and ≤6 edges per section, node labels ≤4 words, drawn from labels.json.

**Risk.** Auto-layout of arbitrary graphs is ugly. Restrict the pass to three fixed layouts (chain,
fan-in, fan-out) and refuse to draw anything that doesn't fit one.

### 27. Glossary constellation

**Sees.** Once, in the gutter, a 90×90px scatter: every glossary term as a dot, x = difficulty,
y = centrality, four labelled. It tells you at a glance whether this piece is hard-and-focused or
easy-and-sprawling.

**Why.** Two numbers we already compute and never show, and together they answer "what am I in for".
It is also the only place a reader gets a sense of the piece's vocabulary as a whole.

**Mechanism.** Inline SVG, no library. Dots at `r=2`, no axes, two faint tick labels.

**Data.** glossary.json — already has both numbers.

**Risk.** Decorative-only if the reader can't act on it. Make the dots hoverable so it doubles as a
term index.

### 28. Marginal captions

**Sees.** Figure captions move out of the flow and into the gutter, top-aligned with the figure,
ragged right, at apparatus size. The figure itself gets the full column.

**Why.** A caption under a figure interrupts the reading column twice. Beside it, the figure keeps its
weight and the caption becomes available rather than mandatory — the classic Tufte arrangement, and it
matches everything else already living in that gutter.

**Mechanism.** Grid placement; `figcaption { grid-column: gutter; }`. Below the breakpoint it returns
under the figure.

**Data.** blocks.json `kind: caption`.

**Risk.** Long captions overrun a short figure. Cap the gutter caption and let overflow return to
flow.

---

## F. Time, memory, and the reader's own trail

### 29. The dwell trail

**Sees.** In the right margin, a faint tick beside every block you have actually dwelt on (in the
reading band for more than a few seconds). Coming back a week later, the essay is visibly marked with
where you spent your attention.

**Why.** It is the reader's own reading history as decoration — nothing generated, nothing judged. On
a second visit it answers "how far did I really get" far better than a scroll position, because
scrolling past isn't reading.

**Mechanism.** `IntersectionObserver` with a dwell timer, thresholded, persisted per article. Ticks
via the same mechanism as #10 but on the reader's side and in the accent at low ink.

**Data.** New client-side state only.

**Risk.** Feels surveilled if presented wrong. It is the reader's, stored for the reader; say so, and
let them clear it.

### 30. Target-text landing

**Sees.** Follow a citation from a summary and the destination sentence is briefly marked in the
accent as the page settles, then fades to nothing over about two seconds. No permanent highlight is
left behind.

**Why.** The moment after a jump is where readers get lost — "which of these paragraphs did it mean?".
A fading mark answers that and then gets out of the way, so the page doesn't slowly accumulate a
history of every jump you ever made.

**Mechanism.** Text fragments (`#:~:text=`) with `::target-text` styling, plus a CSS animation on a
custom highlight for the fade. `scroll-margin-block-start` so the landing sits a third down, not
under the header.

**Data.** summary.json's cited block ids; block text for the fragment.

**Risk.** `::target-text` styling is limited to colour/background/decoration, and text fragments break
on quoted-span mismatch. Fall back to a JS-set custom highlight.

### 31. One thing open at a time

**Sees.** Every expandable addition on the page — glossary card, idea card, section detail — belongs
to one exclusive group. Opening any of them closes the last one. You cannot end up with six panels
open and the article buried.

**Why.** This is the mechanism that enforces "the reader has one unit of attention". Without it, a
decorated page degrades into a page of open drawers within a minute, and every individual decoration
was innocent.

**Mechanism.** `<details name="aside">` — the exclusive accordion, natively, no JS. For popovers, the
`popover` attribute already gives light-dismiss and a single-at-a-time top layer.

**Data.** None.

**Risk.** Occasionally a reader genuinely wants two open. Accept the loss; it is worth it.

### 32. Print as a designed artefact

**Sees.** Print or export, and the decorated page becomes a printed essay: real margins carrying the
gists and the reader's notes, brackets as marginal rules, hover-only decorations resolved into
footnotes, no backgrounds.

**Why.** It forces the whole design to be true in a static medium, which is a strong test of whether
the decorations are typography or interface. Anything that can't print was probably a gimmick.

**Mechanism.** `@page { margin: 20mm 45mm 20mm 25mm }`, `@media print` overrides, `break-inside:
avoid` on figures and callouts, `orphans: 2; widows: 2`, and CSS `content: target-counter()` if
supported for footnote numbering.

**Data.** All of it, resolved statically.

**Risk.** Real work for a feature few use. Do it late, but design as if it exists.

### 33. Decoration density, one control

**Sees.** A single control — not a settings panel of twelve toggles — with four positions: *bare*,
*quiet*, *decorated*, *full*. Each position turns on a named set. Moving it re-renders with a view
transition so the reader sees what changed rather than losing their place.

**Why.** Twelve toggles is an admission that we don't know which decorations are good. One ordered
control is a design opinion, is learnable, and — most importantly — gives the reader a way to get
back to plain prose in one gesture, which every one of these ideas needs as an escape hatch.

**Mechanism.** A class on `<html>`; all decoration CSS scoped under it. `document.startViewTransition`
for the change, with `view-transition-name` on the text column only so the prose stays put while the
apparatus fades in and out.

**Data.** None.

**Risk.** The four sets have to be curated by someone with taste, per the budget below. That is the
actual work; the control is trivial.

### 34. The apparatus never reflows the prose

**Sees.** Turning any decoration on or off does not move a single word of the article. Line breaks are
identical at every density. Only the margins change.

**Why.** It sounds like a constraint and it is really the core design decision. If the text column
reflows when the reader changes anything, they lose their place, and the app has just punished them
for exploring. Keeping the column fixed is what lets everything else be optional.

**Mechanism.** Fixed text column width in `ch`; all apparatus in grid columns outside it or in the top
layer (popover). Nothing generated is ever inline in a paragraph except a zero-width superscript. No
decoration may change `font-size`, `line-height`, or `letter-spacing` of body prose — only weight,
colour, and margins outside the line box.

**Data.** None.

**Risk.** Rules out a few tempting ideas (inline expansions, size emphasis mid-paragraph). Correct
trade.

---

## The system

Twelve decorations coexist only if each one owns a **different channel**. The rule is that a channel
has exactly one owner, and a block may carry at most **two** non-default channels at once.

**Three voices, three territories.** The **author** owns the text column and the serif — full ink,
never recoloured, never resized, never reflowed. The **machine** owns the left gutter, small caps,
apparatus size, and ink steps 3–5 — it is never allowed a hue and never appears inline. The
**reader** owns the right margin and the accent orange.

**The channel budget:**

- **Accent hue** — the reader's layer only (comments, bookmarks) plus transient targets (#30). Nothing
  model-assigned is ever orange, and nothing permanently coloured exists at all.
- **Ink value (5 steps)** — importance and de-emphasis (#2, #20). The reading band (#22) *borrows*
  steps 1–2 and therefore cannot run at the same time as the ink ladder's use of them.
- **Weight (3 stops)** — load-bearing sentences (#1) and the author's own emphasis. Nothing else.
- **Size** — heading hierarchy only. Body prose size is constant, full stop; Greg's "make critical
  sentences bigger" is paid for in weight and space instead (#1, #3, #19).
- **Space / leading** — passage emphasis (#3, #19). The quietest channel, so it should be the default
  emphasis and the others the exceptions.
- **Underline style** — the entity layer only: dotted/solid/double for idea provenance, single for
  glossary (#12, #23). Never colour-coded.
- **Hairlines** — structure (#14, #16, #24), all on one vertical axis at the far left.
- **Motion** — one moving thing per viewport, scroll-scrubbed only (#22, #16), never autoplaying, and
  all of it off under `prefers-reduced-motion`.
- **Background fields** — transient only: hover, focus, target. No persistent highlighter, ever.

Per screen, exactly **one** element may be at full ink + raised weight + extra space. That is the
reader's one unit of attention, and every decoration on this list is competing for it.
