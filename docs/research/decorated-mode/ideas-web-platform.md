# Decorated mode — the web-platform angle

34 ideas. The premise: a page in 2026 can do things that needed a native app or a plugin in 2021,
and almost nobody uses them. The single most relevant one is that **you can now paint arbitrary
ranges of text without touching the DOM**, which removes the reason decorated-prose projects
historically break selection, copy-paste and find-in-page.

---

## 0. Support ledger (read this before costing anything)

Stated as of 2026-08. Where I am not certain of an exact version I say so — verify on caniuse
before committing to it in a plan.

| Feature | Chrome | Safari | Firefox | Notes |
|---|---|---|---|---|
| CSS Custom Highlight API + `::highlight()` | 105 | 17.2 | 140 | **All three.** Restricted property set — see idea 1. |
| `popover` / `popovertarget` | 114 | 17 | 125 | All three since 2024. Top layer, light dismiss, focus handling free. |
| `popover="hint"` | 133 | — | — | Chromium only. |
| `interesttarget` (Interest Invokers) | ~139, flagged | — | — | Chromium, experimental. Declarative hover/focus/long-press triggering. |
| Anchor positioning (`anchor-name`, `position-area`, `@position-try`) | 125 | 26 | not shipped (in progress) | **Needs a JS fallback for Firefox.** Degrades to un-positioned popover if you author it that way. |
| Scroll-driven animations (`animation-timeline: scroll()/view()`) | 115 | 26 | 144 | Runs off the main thread. Gate with `@supports (animation-timeline: view())`. |
| View transitions, same-document | 111 | 18 | 144 | Cross-document (`@view-transition`) is Chrome + Safari only. |
| `content-visibility` / `contain-intrinsic-size` | 85 | 18 | 125 | All three. |
| Container size queries | 2023 | 2023 | 2023 | Universal. |
| `@container style()` (custom-prop equality only) | 111 | 18 | 128 | Universal. No range comparisons yet. |
| `@container scroll-state(stuck/snapped/scrollable)` | 133 | — | — | **Chromium only.** |
| `@property` / `CSS.registerProperty` | 85 | 16.4 | 128 | Universal. Makes custom properties animatable. |
| `:has()` | 105 | 15.4 | 121 | Universal. |
| `text-wrap: balance` | 114 | 17.5 | 121 | Universal. Line-count capped (~6 Chrome / ~10 Safari) — headings only. |
| `text-wrap: pretty` | 117 (orphans only) | 26 (full rag optimisation) | in progress | Safari's is the good one. Harmless where absent. |
| `text-emphasis` | 99 | 7 | 46 | **Universal since forever. Nobody uses it.** |
| `initial-letter` | 110 | 9 (`-webkit-`) | not shipped | Degrades to a normal first letter. |
| `hanging-punctuation` | not shipped | 10 | not shipped | **Safari only.** Pure optical polish, degrades invisibly. |
| `text-box-trim` / `text-box-edge` | 133 | 18.2 | not shipped | Degrades to slightly loose spacing. |
| `mask-image` (gradients) | 120 unprefixed | 15.4 | 53 | Universal; keep `-webkit-mask-image` for older Safari. |
| `color-mix()`, relative colour `oklch(from …)` | 111 / 119 | 16.2 / 16.4 | 113 / 128 | Universal. |
| `subgrid` | 117 | 16 | 71 | Universal. |
| CSS counters, `shape-outside`, `writing-mode` | — | — | — | Universal, ancient, underused. |
| `hidden="until-found"` + `beforematch` | 102 | — | — | **Chromium only.** Matters: see idea 14's risk. |
| Houdini `paintWorklet` | 65 | never | never | **Chromium only.** Always needs a gradient/SVG fallback. |
| `element()` / `-moz-element()` | — | — | Firefox only | Novelty. |
| `speculationrules` | 109 | — | — | Chromium only, no-op elsewhere. |
| `reading-flow` / `reading-order` | 137 | — | — | Chromium only. |
| `::scroll-marker` / `::scroll-button()` | 135 | — | — | Chromium only. |
| `interpolate-size: allow-keywords` / `calc-size()` | 129 | — | — | Chromium only. Animating `height: auto`. |
| `@starting-style`, `transition-behavior: allow-discrete` | 117 | 17.5 | 129 | Universal. Entry/exit animation without JS. |
| `field-sizing: content` | 123 | 26 | not shipped | Textarea that grows with content. |
| `@scope` | 118 | 17.4 | 128 | Universal. |
| `content: "x" / "alt"` (alt text for generated content) | 113 | 17.4 | 137 | Universal-ish. See idea 32. |
| `scrollbar-color` | 121 | not shipped (verify) | 64 | |

### The three rules I would put in the plan

1. **Anything that decorates the author's own words is painted, never wrapped.** Custom Highlight
   API for colour/underline; overlays and gutters for everything else. Wrapping spans is what
   breaks the things the brief says matter.
2. **Anything we add is DOM, and every added node gets `user-select: none` or lives in generated
   content**, so a select-all-copy still yields the author's article and nothing of ours.
3. **Every importance cue has a non-colour, non-size twin**, because `forced-colors: active` will
   flatten your palette and a screen reader was never getting any of it.

---

## 1. Overlap Layer

**What the reader sees.** Glossary underlines, idea occurrences, their own comment ranges, the
model's "load-bearing sentence" marks and the live search match all coexist on the same words —
three overlapping marks on one clause render as three distinct treatments, not as a mangled
sandwich.

**Why it helps.** Overlapping annotation is the thing that kills every prose-decoration codebase.
With span wrapping, *n* overlapping ranges require splitting the text into up to 2ⁿ segments,
recomputing on every change, and it destroys the block-id ↔ offset contract. The Custom Highlight
API has no such cost: ranges are held outside the DOM, painted in the highlight overlay, and
`Highlight.priority` decides who wins per pixel.

**Mechanism.** `CSS.highlights.set('glossary', new Highlight(...ranges))`, one registry per
decoration kind, `::highlight(glossary) { text-decoration: underline dotted; }`. Ranges built from
block id → text node walk once per render, cached. Live `Range` objects track DOM mutations; use
`StaticRange` only if you rebuild on every re-render.

**Data.** glossary.json occurrences, ideas.json `occurrences` (block id + quoted span),
comments.json spans, plus a new pass emitting **sentence-level rhetorical role** (`claim`,
`evidence`, `concession`, `aside`, `restatement`) with a confidence.

**Risk.** The property set is hard-limited: `color`, `background-color`, `text-decoration*`,
`text-shadow`, `-webkit-text-stroke`, `text-underline-offset/position`. **No font-size, no
font-weight, no padding, no border, no transform** — highlights paint after layout, by design. So
this cannot do "make it bigger" (idea 2). Second risk: highlights are invisible to assistive tech
unless you set `highlight.type = 'spelling-error' | 'grammar-error'`, which is the wrong semantic —
treat them as decoration only. Third: an 8,300-word article with five registries and thousands of
ranges wants a `requestIdleCallback` build and a re-run on resize only if you use offsets.

---

## 2. The Importance Ladder

**What the reader sees.** Prose sits at three or four levels. The load-bearing sentence isn't
"highlighted", it's set two steps up the ladder: fractionally heavier via the variable font's
`wght` axis, at a slightly larger optical size, at full text contrast. Boilerplate and hedging sit
one step down: same size, lower contrast, `opsz` tuned for small text so it stays crisp rather than
looking blurred.

**Why it helps.** "Bigger" and "fainter" done naïvely wreck the page: raw `font-size` changes
reflow and rag, and low `opacity` on near-black fails contrast. A registered custom property lets
one number per block drive weight, optical size, letter-spacing and lightness together, the way a
type designer would.

**Mechanism.** `@property --importance { syntax: '<number>'; inherits: true; initial-value: 0.5 }`
on each block, set inline from labels. Then `font-variation-settings: 'wght' calc(380 + var(--importance) * 200), 'opsz' calc(11 + var(--importance) * 6)` — or better, the high-level
`font-weight` / `font-optical-sizing` so inheritance and animation behave. Contrast via
`color: oklch(from var(--ink) calc(0.55 + var(--importance) * 0.4) c h)`. Size, if you use it at
all, in `cqi` so it tracks column width. `@property` makes all of it interpolable.

**Data.** A new pass: per-block or per-sentence **salience 0–1**, plus `gistable` for boilerplate.

**Risk.** This is the biggest accessibility hazard in the whole brief. De-emphasised prose at 45%
contrast on near-black is unreadable for a lot of people and fails WCAG. Cap the bottom of the
ladder at a measured 4.5:1, and collapse the entire ladder to flat under
`@media (prefers-contrast: more)` and `forced-colors: active`. Second risk: varying weight per
sentence makes a paragraph look like a ransom note — do it per *block* or per *sentence*, never per
phrase, and keep the weight delta small (a 380→520 step is plenty).

---

## 3. Marker Pen

**What the reader sees.** The key sentence is highlighted with what looks like a real marker pen:
uneven top and bottom edges, a slightly darker double-stroked patch where the pen overlapped, the
stroke ending short of the full stop. It reflows perfectly when the window resizes, because it is
painted per line box, not drawn as an SVG over measured coordinates.

**Why it helps.** A flat rectangle of orange reads as "the machine did this". A hand stroke reads
as "someone marked this up", which is exactly the register the brief wants — a reader's markup, not
a summary. And the imperfection makes overlapping marks legible where flat blocks would merge.

**Mechanism.** Houdini `CSS.paintWorklet.addModule()`, `background-image: paint(marker)` on an
inline element (the browser fragments the paint per line box for you — this is the one thing SVG
can't do without measurement). `@property --marker-seed` and `--marker-wobble` as inputs so the
same block id always gets the same stroke.

**Data.** Whatever range you're marking; seed from the block id.

**Risk.** **Chromium only, forever** — Safari and Firefox never shipped Houdini paint. Fallback must
be a `linear-gradient` background or a Custom Highlight, and it must look deliberate, not broken.
Also: this requires an inline wrapper element, so it violates rule 1 — reserve it for the small
number of pull-out marks where you accept the wrap, or paint it on a gutter/overlay element instead
of on the text.

---

## 4. Bōten

**What the reader sees.** The author's load-bearing phrase gets a row of small dots above each
character — the Japanese *bōten* emphasis mark. No underline, no background, no weight change. It
reads as "look here" without competing with the glossary underlines or the comment highlights, and
it survives on top of anything else.

**Why it helps.** You have a scarce number of visual channels and this brief wants to use six of
them at once. `text-emphasis` is a whole unused channel: it lives *above* the line, so it collides
with nothing below it, and Western readers have no prior association with it, which means you get
to define what it means.

**Mechanism.** `text-emphasis: dot var(--accent); text-emphasis-position: over;` — universal
support since ~2016 in all three engines, and essentially nobody uses it outside CJK typography.
Needs `line-height` headroom (the mark adds a block above the line) — bump `line-height` on decorated
paragraphs or it clips.

**Data.** ideas.json quoted spans, or a new **"the sentence this section turns on"** pass.

**Risk.** Requires an inline wrapper (it is not in `::highlight()`'s property set), so it is subject
to rule 1 — use for a handful of spans per article, not hundreds. Overused it looks like measles.
Wrong `line-height` clips it silently at the top of a block.

---

## 5. Reading Spotlight

**What the reader sees.** The paragraph at the reading line is at full contrast; everything above
and below is dimmed and very slightly desaturated, with a soft edge. Scrolling moves the bright
band. Selecting text still works normally, and the dimming animates smoothly without touching a
single text node.

**Why it helps.** Long-form argumentative prose loses people to line-slip and to peripheral pull.
A moving contrast band does what a finger under the line does. Crucially it's reversible and
non-destructive: nothing is hidden, so a reader can look up or down at will.

**Mechanism.** Two fixed-position divs above and below a centre band, `pointer-events: none`,
`backdrop-filter: brightness(0.55) saturate(0.8)`, edges softened with `mask-image:
linear-gradient(...)`. The band's position/height driven by
`animation-timeline: scroll(root block)` — or simply fixed, which needs no JS at all. Toggle with
a keyboard shortcut. `backdrop-filter` is universal since Firefox 103.

**Data.** None. Optionally widen the band to the current tree node's `range` so it tracks *sections*
rather than a fixed pixel height.

**Risk.** `backdrop-filter` is GPU-expensive over a tall scrolling page — measure. Must be
off by default and remembered per reader. Kill entirely under `prefers-reduced-motion` (make it
static) and `prefers-reduced-transparency`. Some readers find it claustrophobic; it must never dim
so far that peripheral text is unreadable, because "glance back two paragraphs" is a core reading
move.

---

## 6. Gutter Ladder

**What the reader sees.** A narrow left gutter runs the length of the article. Generated headings,
arc sentences and idea markers sit in it, each one baseline-aligned to the exact line of prose it
refers to — not roughly next to the paragraph, *level with the line*. The prose column never moves.

**Why it helps.** Marginalia is the oldest reading augmentation there is and the reason it's rare on
the web is alignment. Getting it right makes the annotation feel like it belongs to the sentence
rather than floating near it, which is the difference between a note you trust and one you ignore.

**Mechanism.** One CSS grid on the article: `grid-template-columns: [gutter] 14rem [prose] minmax(0, 68ch)`. Each block is a `subgrid` row so nested components inherit the same column lines.
Line-level alignment via `Range.getClientRects()[0].top` on the target span, written into a
`--top` custom property once per layout, recomputed in a `ResizeObserver`. `position-visibility:
no-overflow` (where anchor positioning is available) hides a note whose anchor has scrolled away.

**Data.** tree.json `title`/`gist`/`sourceHeading`, arc.json, comments.json.

**Risk.** Falls apart below ~1100px — needs a full mobile strategy (inline disclosure, idea 14).
And the DOM order problem: a gutter note placed visually beside paragraph 40 must not be read out
by a screen reader before paragraph 1. `reading-flow: grid-order` fixes tab/AT order but is Chromium
only — so put the note in DOM order right after its block and position it with grid, rather than
collecting all notes in one container.

---

## 7. Anchored Cards

**What the reader sees.** Hovering a glossary term pops a card with the `background` paragraph. It
appears above the term, flips below near the viewport bottom, shifts sideways rather than clipping
at the edges, dismisses on Escape or an outside click, and traps focus correctly when opened from
the keyboard. Zero of that is our code.

**Why it helps.** Not a new decoration — but today this is a tooltip library, a positioning engine,
a focus-trap and an outside-click hook, all of which are latency and bugs. Deleting them is worth
more than a new feature.

**Mechanism.** `<div popover>` + `popovertarget`, `anchor-name: --term-x` on the term,
`position-anchor` + `position-area: block-start span-all` + `position-try-fallbacks: flip-block,
flip-inline`, entry animation with `@starting-style` and `transition-behavior: allow-discrete`.
Hover-open declaratively with `popover="hint"` (Chromium) or `interesttarget` (Chromium,
experimental), else a small JS timer. **Firefox has no anchor positioning yet** — write the popover
so an un-anchored centred card is an acceptable degraded state, or ship a 30-line
`getBoundingClientRect` fallback behind `@supports not (anchor-name: --a)`.

**Data.** glossary.json, ideas.json `whyYouNeedIt`.

**Risk.** Hover cards on a page that also has underlines, highlights and marginalia will fire
constantly. Needs a real open delay (~400ms), a close delay, and suppression while the reader has an
active text selection. Touch has no hover — see idea 25.

---

## 8. Arc Rail

**What the reader sees.** A hairline rail at the left edge, divided into the arc.json spans. The
segment you're in is lit in the accent; the others are dim. As you scroll it fills continuously,
and the arc sentence for the current segment fades in beside it and fades out again. It never
stutters, even during a heavy scroll.

**Why it helps.** "Where am I in the argument" is the specific thing a 141-block essay destroys.
arc.json already answers it; the rail makes the answer ambient rather than something you have to
go and ask for.

**Mechanism.** Three lines of CSS and no JS:
`animation-timeline: scroll(root block); animation-name: fill; animation-range: 0% 100%;` with
`@keyframes fill { to { scale: 1 1 } }` on the rail, and per-segment `animation-timeline: view()`
with `animation-range: cover 0% cover 100%` for the lit state. **Runs on the compositor** — this is
the whole point versus a scroll listener or IntersectionObserver, which do the same job on the main
thread and jank.

**Data.** arc.json spans, block-id → offset map.

**Risk.** Gate on `@supports (animation-timeline: scroll())` and fall back to a static rail (not to
JS — the fallback should be *less*, not *different*). Under `prefers-reduced-motion`, snap between
states instead of tweening. Firefox needs 144+; Safari 26+.

---

## 9. Fisheye Band

**What the reader sees.** Blocks gain contrast and a touch of weight as they enter a band around the
middle of the viewport, and shed it as they leave — a soft focus gradient rather than a hard
spotlight. Nothing moves; only colour and weight change, so no reflow, no scroll drift.

**Why it helps.** This is the granularity-zoom idea applied continuously and without a mode switch.
It solves the same problem as idea 5 with a lighter hand and no overlay.

**Mechanism.** `@property --focus { syntax: '<number>'; initial-value: 0 }` on the block,
`animation-timeline: view(); animation-range: entry 40% exit 60%;` animating `--focus` 0→1→0, with
`color` and `font-weight` derived from it. Because `--focus` is registered, it interpolates; an
unregistered custom property would jump.

**Data.** None required. Weight the effect by salience so unimportant blocks brighten less.

**Risk.** Animating `font-weight` triggers layout on every frame — **only animate colour** unless
you're on a variable font where you can animate `font-variation-settings: 'wght'` (still layout,
but cheaper) or, best, only animate `-webkit-text-stroke-width` for a fake weight change that
doesn't reflow. Test on a mid-range laptop with 141 blocks before believing it.

---

## 10. Role Styling by Style Query

**What the reader sees.** Concessions ("granted, X") sit in a slightly recessed tone; cited evidence
carries a thin left keyline; the piece's actual claims sit at full contrast. Consistent throughout,
including inside blockquotes and list items, without a single extra class on any nested element.

**Why it helps.** The plumbing cost of role-based styling is what stops teams doing it. A style
query means one custom property on the block cascades to everything inside it, and the *styling
rules live in CSS*, not in the renderer.

**Mechanism.** `--role: concession` inline on the block; `@container style(--role: concession) { p, li, em { color: ... } }`. Universal support (Chrome 111 / Safari 18 / Firefox 128). Note the
limitation: style queries currently test **equality only** on custom properties — no `>` or ranges —
so bucket salience into named tiers rather than querying a number.

**Data.** New pass: **rhetorical role per block/sentence** — `claim | evidence | concession |
example | aside | restatement | definition` with confidence.

**Risk.** The model will be wrong sometimes, and a wrongly-recessed key concession is worse than no
styling. Only apply below a confidence threshold as a *subtle* tone shift; never hide, never shrink.
And keep the number of roles to four or five — more is noise.

---

## 11. Zoom Morph

**What the reader sees.** Zooming out from full prose to gists: each paragraph's first line stays
put and the rest of the paragraph collapses into its label, with the label sliding into the position
the paragraph's opening occupied. Zooming back in reverses it. You never lose your place because
you can see where the text you were reading went.

**Why it helps.** Granularity zoom's failure mode is disorientation — the page changes and the
reader has to re-find themselves. A view transition makes the change *legible as a transformation*
rather than as a replacement, which is the entire cognitive point.

**Mechanism.** `document.startViewTransition(() => render(nextLevel))`,
`view-transition-name` on each block keyed to the block id (or `view-transition-name: match-element`,
Chrome 137+, to auto-assign), `view-transition-class` for shared timing. Chrome 111 / Safari 18 /
Firefox 144.

**Data.** tree.json, labels.json, summary.json.

**Risk.** VT snapshots the viewport and **blocks input for the duration** — keep it under 250ms or
rapid zooming feels stuck. Naming 141 elements is measurable cost; only name what's on screen.
Interacts badly with `content-visibility: auto` (idea 12) — an off-screen block has no snapshot,
which is fine, but a block that *becomes* visible mid-transition can pop. Honour
`prefers-reduced-motion` by skipping the transition entirely, not by shortening it.

---

## 12. Contain the 141

**What the reader sees.** Nothing, ideally. The article scrolls at 60fps with all decoration layers
on, on a five-year-old laptop, and the scrollbar doesn't twitch as you go.

**Why it helps.** Everything else here costs paint. This is the budget that pays for it.

**Mechanism.** `content-visibility: auto; contain-intrinsic-size: auto 240px;` on each block. The
`auto` keyword makes the browser remember each block's real last-rendered size, which is what stops
the scrollbar jitter that gives `content-visibility` its bad reputation. Universal (Chrome 85 /
Firefox 125 / Safari 18).

**Data.** None. `words` from blocks.json gives a better first-guess intrinsic height than a constant.

**Risk.** `content-visibility: auto` content **is** still found by find-in-page and **is** still in
the accessibility tree — that's the safe variant. `content-visibility: hidden` is neither; never use
it on prose. Anchoring: scrolling to a block id inside a skipped region can land wrong if the
intrinsic size guess is bad — set `scroll-margin-top` and verify a deep permalink lands correctly.

---

## 13. Quotable Link

**What the reader sees.** Selecting a passage offers "copy link to this passage". The link opens the
article — anywhere, in any browser, including from someone else's Slack — scrolled to that passage
with it softly highlighted in the accent, then the highlight fades after a beat.

**Why it helps.** Sharing a specific sentence is the highest-value action a reader takes with an
essay, and today it means "paste the quote and hope". Text fragments make the *browser* do the
finding, so the link survives our re-extraction and even works on the original NOEMA page.

**Mechanism.** `#:~:text=prefix-,start,end,-suffix` built from the selection;
`::target-text { background: color-mix(in oklch, var(--accent) 30%, transparent); }`. Text fragment
navigation is Chrome 80+, Safari 16.1+, Firefox 131+. Note two gotchas: the fragment directive is
**stripped from `location.hash`** and unreadable from JS (deliberate, for privacy), and it only
applies on navigation — for in-app "jump to this comment" use idea 1's highlight registry instead.

**Data.** comments.json quoted spans; the reader's live selection.

**Risk.** Text fragments fail silently when the text doesn't match exactly — build them with
`prefix-`/`-suffix` context for uniqueness and test against the article's own HTML. `::target-text`
inherits the same restricted property set as `::highlight()`.

---

## 14. Exclusive Marginalia

**What the reader sees.** The gutter shows a one-line arc sentence per section, each a closed
disclosure. Opening one expands its long summary in place and closes whichever was open, so exactly
one expansion exists at a time and the prose column never jumps around unpredictably.

**Why it helps.** The brief's soft constraint — a decoration must not become a way of *not* reading
— is best enforced structurally. One open panel at a time makes the summaries a reference you dip
into, not a parallel document you can read straight through.

**Mechanism.** `<details name="margin">` — the exclusive accordion, cross-browser since Firefox 130
(Chrome 120, Safari 17.2), no JS. Animate open/close with `::details-content` (Chrome 131),
`transition-behavior: allow-discrete`, `@starting-style`, and `interpolate-size: allow-keywords`
where available; elsewhere it snaps, which is fine.

**Data.** summary.json (`short` in the closed state, `long` open), arc.json, tree.json `gist`.

**Risk.** **Never wrap article prose in `<details>`.** Closed `<details>` content is invisible to
find-in-page outside Chromium (`hidden="until-found"` is Chromium-only), so collapsing prose would
break Cmd-F for Safari and Firefox readers. Collapse *our* additions only. Also: `<details name>`
closing a panel while the reader is mid-read of it is jarring — animate the close, don't cut.

---

## 15. Claim Counters

**What the reader sees.** Each of the piece's claims gets a small numeral in the gutter — ①…⑩ down
the length of the essay — and the ideas panel refers to them by the same numbers. Numbering is
correct even after a re-extraction adds a block, because nothing hardcodes it.

**Why it helps.** Gives the reader a stable shorthand for referring to the argument's parts, to
themselves and to us. "The claim in ④" is a handle; "the bit about anthropomorphism" is not.

**Mechanism.** `counter-reset: claim` on the article, `counter-increment: claim` on marked blocks,
`content: counter(claim, decimal) / ""` in a `::before` positioned in the gutter. `counters()` and
`@counter-style` give you nested section.claim numbering for free. Universal, boring, 20 years old,
almost never used for anything but lists.

**Data.** ideas.json occurrences; tree.json for the nesting level.

**Risk.** Generated content is announced by screen readers in Chrome and Safari — hence the
`/ ""` alt-text syntax to suppress it, since a bare "4" read mid-sentence is noise. Numbers imply an
order the argument may not have; call them labels in the UI, not steps.

---

## 16. Idea Threads

**What the reader sees.** Each of the ten propositions has a colour. Hovering an idea in the panel
lights every place in the article where the piece leans on it — six occurrences across 40
paragraphs, all glowing at once — and the scrollbar-side rail shows where the off-screen ones are.
Releasing the hover takes it all back instantly.

**Why it helps.** The single hardest thing in a long argument is seeing that a premise introduced on
page 2 is still doing work on page 9. This makes it a hover.

**Mechanism.** One `Highlight` per idea in `CSS.highlights`, toggled by adding/removing the registry
entry — no DOM writes at all, so it's cheap enough to run on `mouseenter`. Off-screen positions from
`Range.getClientRects()` mapped onto a fixed rail. `Highlight.priority` so an idea thread paints
above the glossary underline but below the reader's own comment.

**Data.** ideas.json `occurrences` (already has block ids + quoted spans).

**Risk.** Ten distinct hues on a near-black page, all distinguishable and all passing contrast, is
hard — derive them with `oklch()` at fixed lightness and chroma, varying only hue, and cap at maybe
six visible at once. Colour alone excludes colour-blind readers: pair each idea with a distinct
`text-decoration-style` (solid / dotted / wavy / double) as the redundant channel.

---

## 17. Shape-Outside Diagram

**What the reader sees.** Where the essay describes a structure — a three-step argument, a
refutation chain — a small diagram sits inset in the text column and the prose flows around its
actual outline, not around a rectangle. It reads like a printed book figure, not a floated image.

**Why it helps.** A diagram beside the paragraph that describes it is read; a diagram in a panel
below is skipped. Wrapping the text around it keeps the reading line continuous, which is what
stops the reader treating it as a detour.

**Mechanism.** `float: inline-end; shape-outside: polygon(...)` or `shape-outside: url(diagram.svg)`
with `shape-image-threshold`, `shape-margin: 1rem`. Universal since 2019, essentially unused on the
web. `shape()` function (Chrome 135, Safari 18.4) lets you write the outline in CSS units instead of
percentages.

**Data.** A new pass emitting **small structure graphs**: nodes + typed edges (`supports`,
`refutes`, `depends-on`) scoped to a tree.json node, rendered to inline SVG.

**Risk.** Floats and narrow columns are enemies; below ~600px it must become a full-width block
above the paragraph. A wrong diagram is worse than none — the pass needs to be able to return
nothing, and usually should.

---

## 18. Section Spine

**What the reader sees.** As you enter a section, its generated heading appears rotated 90° in the
outer margin, running down the page beside the whole section like a book's running head. It sticks
while you're in the section and hands off to the next one. It is never in the way, because it's in
space the prose wasn't using.

**Why it helps.** tree.json has generated titles for sections that never had headings. Inserting
them into the flow interrupts the prose; putting them in the margin gives the same orientation
without a break in the reading line.

**Mechanism.** `writing-mode: vertical-rl; position: sticky; top: 6rem;` in the gutter grid column.
Style the stuck state with `@container scroll-state(stuck: top)` (Chromium only) or accept a static
treatment everywhere. Universal apart from the stuck-state styling.

**Data.** tree.json `title` + `sourceHeading` (mark generated titles differently from the author's —
see idea 30).

**Risk.** Vertical Latin text is slow to read; keep to four or five words. Screen readers will read
it in DOM order — place it immediately before the section's first block, not in a sidebar container.

---

## 19. Fade, Don't Cut

**What the reader sees.** A collapsed summary or long glossary background doesn't end at a hard edge
with a "more" link; it fades into the page over the last two lines. The fade tells you there's more
there without a control, and the boundary between our text and the page has no visible seam.

**Why it helps.** Truncation with an ellipsis reads as "content withheld"; a fade reads as depth.
Small thing, but this page is going to be full of collapsed additions and every one of them needs an
edge treatment.

**Mechanism.** `mask-image: linear-gradient(to bottom, #000 60%, transparent)` — one line. This is
the thing people build with an absolutely-positioned gradient overlay div (which fails the moment
the background isn't flat). `mask-composite` to combine with a rounded-corner mask.

**Data.** None.

**Risk.** Masked text is still selectable and copyable, including the invisible part — a reader who
select-alls gets text they can't see. Pair with `max-height` + `overflow: clip`, or accept it. Masks
are ignored under `forced-colors: active`, which is the right behaviour.

---

## 20. Confidence Ramp

**What the reader sees.** Every decoration on the page is a different strength of the same
Spideryarn orange: a certain glossary term is a firm underline, an uncertain one a faint one, a
high-confidence claim mark saturated, a low-confidence one nearly gone. It looks like one system
rather than five features that happened to land on the same page.

**Why it helps.** Six simultaneous decoration types with independent colours is chaos. Making
*strength* the encoded variable and *hue* the brand constant gives you one legible dimension, and
lets you show model uncertainty honestly instead of hiding it.

**Mechanism.** `color-mix(in oklch, var(--accent) calc(var(--confidence) * 100%), var(--page))`, or
relative colour `oklch(from var(--accent) l calc(c * var(--confidence)) h)`. **`oklch`, not sRGB** —
on a near-black page an sRGB opacity ramp bands visibly and its perceived steps are uneven; OKLCH
steps are perceptually even, which is the whole reason it exists. Universal since Firefox 113/128.

**Data.** `difficulty` and `centrality` from glossary.json (already 0–1), `provenance` from
ideas.json, plus confidence on any new pass.

**Risk.** The bottom of the ramp will fail contrast if the ramp bottoms out at the page colour —
clamp lightness, don't clamp chroma. Under `forced-colors: active` all of this collapses to system
colours; that's acceptable but means confidence information vanishes, so it must never be the only
carrier.

---

## 21. Pull-Quote, Trimmed

**What the reader sees.** A callout quote sits in the margin at 28px, and the space above the first
line is optically equal to the space below the last, and the quote mark hangs outside the text
block so the quoted words start on the same vertical line as the body text. It looks typeset rather
than boxed.

**Why it helps.** Large text has proportionally huge half-leading, which is why every web pull-quote
looks like it's floating too low in its box. Fixing it is two properties that basically nobody uses.

**Mechanism.** `text-box-trim: trim-both; text-box-edge: cap alphabetic;` (Chrome 133, Safari 18.2,
not Firefox — degrades to the current slightly-loose look). Plus `hanging-punctuation: first
last;` (Safari only, degrades invisibly) and `text-wrap: balance` on the quote. `initial-letter: 2`
for a section-opening drop cap (Chrome + Safari, Firefox degrades harmlessly).

**Data.** A new **quotable-line** pass, or just the highest-salience sentence in each tree node.

**Risk.** The brief warns about pull-quotes being the floor, and it's right that a pull-quote which
duplicates text visible two inches away is pure noise — so pull the quote from a paragraph that has
already scrolled past, not the one beside it, or don't do it.

---

## 22. Text-Fill Progress

**What the reader sees.** No progress bar. Instead the section heading in the gutter fills with the
accent colour from left to right as you read through that section — the letterforms themselves fill.
At the top of a section it's outlined; at the bottom it's solid.

**Why it helps.** A progress bar is a separate object that adds a thing to look at. Making the label
you were already looking at carry the progress adds information at zero attentional cost.

**Mechanism.** `background: linear-gradient(90deg, var(--accent) 50%, var(--dim) 50%);
background-clip: text; color: transparent;` with the gradient stop driven by
`animation-timeline: view()` over the section's range. Requires `@property --fill { syntax: '<percentage>' }` to interpolate the gradient stop.

**Data.** tree.json ranges.

**Risk.** `background-clip: text` sets the text colour to transparent, so it fails hard under
`forced-colors: active` (invisible text) — guard with `@media (forced-colors: none)`. Selection over
clipped text renders oddly in some engines. Don't do it to article prose, only to our labels.

---

## 23. Range-Rect Heat Gutter

**What the reader sees.** A 3px column at the very edge of the viewport showing the whole article
compressed: dashes where glossary terms cluster, taller marks where the reader has commented, a
brighter band for the section you're in. Clicking a mark scrolls there. It's a minimap of the
annotations, not of the text.

**Why it helps.** With 19 glossary entries, 10 ideas and 15 comments, the reader loses track of
where their own work is. This makes their annotation density visible at a glance and gives a
one-click route back.

**Mechanism.** `Range.getClientRects()` for each annotated span → `offsetTop / scrollHeight` →
absolutely positioned divs on a fixed rail. Recompute in a `ResizeObserver`, not on scroll. The
current-section band via `animation-timeline: scroll()` so the moving part costs nothing.

**Data.** glossary.json, ideas.json, comments.json.

**Risk.** Recomputing rects for hundreds of ranges is a forced synchronous layout — batch it,
run it in `requestIdleCallback`, and never inside a scroll handler. Fights with the real scrollbar
for edge space; use `scrollbar-gutter: stable` and put the rail inside it.

---

## 24. Ruby Micro-Gloss

**What the reader sees.** A hard term carries a two- or three-word gloss set small directly above it
— "qualia^(the felt quality)" — rendered on its own line above the baseline without pushing the
prose sideways. No hover needed, no card, no interaction.

**Why it helps.** The hover card is a detour: the reader leaves the sentence, reads a paragraph,
comes back and re-reads the sentence. For a *short* gloss, putting it above the word means the
reader never leaves the sentence at all. That is exactly "help them read efficiently but deeply".

**Mechanism.** `<ruby>qualia<rt>the felt quality</rt></ruby>`, `ruby-position: over`, `ruby-align:
center`, small `font-size` with its own colour. Universal in all three engines since forever.

**Data.** A new pass: **three-word gloss** per glossary entry (existing `background` is a paragraph —
too long). Apply only where `difficulty` is high and `centrality` is high.

**Risk.** **This one genuinely affects copy-paste**: copying ruby text includes the `<rt>` content
in some browsers, so the reader's clipboard gets "qualia the felt quality". Test in all three, and
if it does, add `user-select: none` on `rt` and verify the copied string. It also inserts DOM into
the prose (rule 1 violation) and adds a line box above, so it needs `line-height` headroom. Use for
at most a handful of terms per article.

---

## 25. Long-Press Everything

**What the reader sees.** On touch, there is no hover, so a long press on any underlined term opens
its card, and a long press on a highlighted sentence opens the note beside it. It's the same
gesture everywhere, it doesn't fight the native text-selection long-press, and it works with
VoiceOver.

**Why it helps.** Half the reading happens on a phone and every hover-based decoration on this list
is dead there. Deciding the touch gesture *once*, declaratively, keeps the whole system coherent
instead of each feature inventing its own tap target.

**Mechanism.** `interesttarget` (Chromium, experimental) gives hover, focus **and long-press**
triggering with correct ARIA wiring for free. Elsewhere: `pointerdown` + timer + `pointercancel`,
plus `touch-action` and careful `user-select` so it doesn't preempt native selection. `popover` for
the surface in both cases.

**Data.** Same as ideas 7 and 16.

**Risk.** Long-press is the OS's text-selection gesture; overriding it on prose is hostile. Only bind
it to the *decorated* spans, keep the threshold above the OS's, and cancel on any movement.

---

## 26. Prose Rag Pass

**What the reader sees.** No headings end with a single orphaned word on line two. No paragraph
finishes with a lone short word on its own line. The right-hand rag is even. Nobody notices, which
is the point.

**Why it helps.** Ragged, orphan-heavy setting adds a real, measurable cost to sustained reading, and
it's the first thing that goes wrong when you start varying font size per block (idea 2). Three
properties buy back most of what a typesetter would.

**Mechanism.** `text-wrap: balance` on all headings and pull-quotes (universal; capped at ~6 lines
in Chrome, ~10 in Safari, so headings only). `text-wrap: pretty` on body prose — Chrome 117 does
orphan avoidance only, **Safari 26 does the full rag optimisation**, Firefox in progress; harmless
where absent. `hyphens: auto` with `hyphenate-limit-chars: 8 3 3` for narrow columns.

**Data.** None.

**Risk.** `text-wrap: pretty` costs layout time proportional to paragraph length — with 141 blocks
plus `content-visibility` it's fine, but measure. `balance` on long text silently does nothing past
the line cap; don't rely on it for body copy.

---

## 27. Scoped Insertions

**What the reader sees.** Our generated headings, callouts and panels sit inside the article column
and are unmistakably *ours* — a different type family, a tighter measure, a keyline — and nothing
we add ever accidentally inherits a rule meant for the author's prose, or vice versa.

**Why it helps.** The failure mode of this entire brief is our additions becoming indistinguishable
from the author's words. That's an ethical problem, not just a design one. It needs to be enforced
by the stylesheet architecture, not by discipline.

**Mechanism.** `@scope (.article) to (.spya-addition) { ... }` — donut scope, so prose rules stop at
the boundary of anything we inserted. Chrome 118 / Safari 17.4 / Firefox 128. Plus a consistent
`lang` and typeface switch on additions.

**Data.** None — a convention.

**Risk.** `@scope` proximity rules surprise people; keep the scopes shallow and obvious. If you need
a Firefox-129-and-older fallback, plain descendant selectors get you 90% there.

---

## 28. Copy Fidelity Guard

**What the reader sees.** Select the whole article, copy, paste into a document: they get Anil Seth's
essay, in order, in full, with no generated headings, no arc sentences, no claim numbers, no gloss
text. Then a separate "copy with our notes" affordance, for when they want the other thing.

**Why it helps.** This is a promise the product has to keep, and it will be broken by accident,
repeatedly, by every idea on this list that inserts DOM. It needs a mechanism and a test, not care.

**Mechanism.** `user-select: none` on every inserted node (excluded from copy in Chrome and Safari;
**verify Firefox** — its behaviour here has changed over the years and I'd not trust it without a
test). Belt and braces: a `copy` event handler that rebuilds the clipboard string from blocks.json
for the selected block range, which also gives you exact author text regardless of any decoration.
Then a test that copies a selection spanning decorated blocks and diffs against blocks.json.

**Data.** blocks.json `text`.

**Risk.** Overriding `copy` breaks partial-word selections if done naively — reconstruct from the
actual `Selection` ranges, not from block boundaries. Never strip the article's own emphasis.

---

## 29. Decoration Contract

**What the reader sees.** In Windows High Contrast mode, or with "increase contrast" on, or with
reduced motion, the page still works: the ladder flattens, the highlights become system-colour
underlines, the fisheye stops, the spotlight goes static, and no information disappears.

**Why it helps.** A page carrying six simultaneous decoration channels has six ways to become
meaningless for someone using an accessibility setting — and the failure is silent, because it looks
fine on your machine.

**Mechanism.** `@media (forced-colors: active)` → drop all `color-mix` ramps, use `Highlight`/
`HighlightText`/`LinkText` system colours, `forced-color-adjust: none` only where you've thought
about it. `@media (prefers-contrast: more)` → collapse the importance ladder. `@media
(prefers-reduced-motion: reduce)` → no view transitions, no scroll-driven animation, static
spotlight. `@media (prefers-reduced-transparency)` → no `backdrop-filter`.

**Data.** None.

**Risk.** The real risk is not doing it. Add a `/design` page state that toggles all four so it's
checkable in one place, and screenshot it in CI.

---

## 30. Provenance Line

**What the reader sees.** Every mark on the page tells you, without words, whether it came from the
author or from us. The author's own headings are set one way; generated headings carry a fine
dotted keyline. Author emphasis is left exactly as-is; our emphasis uses the bōten dots (idea 4).
Quoted spans are solid; inferred spans are dashed.

**Why it helps.** The brief's constraint is "we may not change the author's words" — but a reader
who can't tell our additions from the author's has effectively had the article changed. One
consistent visual grammar for provenance is what makes the whole mode honest.

**Mechanism.** `text-decoration-style: solid | dashed | dotted` as the provenance channel (universal,
and it survives `::highlight()`'s restricted property set, which colour ramps do too but
size/weight don't). `tree.json.sourceHeading === null` drives the generated-heading treatment.
`ideas.json.provenance` (`assumed | argued | cited`) drives span style.

**Data.** Already present: `sourceHeading`, `provenance`.

**Risk.** Three decoration styles is the whole vocabulary — spend it on provenance and you can't
also use it for idea threads (idea 16). Pick one. I'd pick provenance.

---

## 31. Skip Reading, Not Skimming

**What the reader sees.** When the reader zooms out, the *prose stays* — it goes small and low
contrast — while the labels come up to full size beside it. You are never shown a summary with the
text gone; you're shown the text with the summary emphasised. Zooming out far enough that prose is
unreadable requires a deliberate second step.

**Why it helps.** This is the brief's soft principle rendered as a mechanic. The reader can always
see how much text a gist stands for, which is the information a summary destroys.

**Mechanism.** Interpolate `--zoom` (registered via `@property`) rather than swapping DOM: prose
`font-size: calc(1rem * (1 - var(--zoom) * 0.6))`, label opacity and size inverse. One property,
animated once, drives everything. View transition (idea 11) only for the final step where prose
does leave.

**Data.** labels.json, tree.json.

**Risk.** Sub-9px prose is a smear, not information, and it reflows the whole document at every
step — measure with `content-visibility` on. Might genuinely be worse than a clean swap; prototype
both.

---

## 32. Silent Ornament

**What the reader sees.** Nothing extra. A screen reader user hears the article, the reader's own
notes, and the glossary definitions they asked for — and does not hear "bullet, four, quote mark,
section marker, quote mark" between every paragraph.

**Why it helps.** Generated content *is* announced by Chrome and Safari. A decorated page is
generated content everywhere. Without this, the mode is actively worse for a screen reader than
plain prose, which would be a failure of the whole premise.

**Mechanism.** `content: "❝" / "";` — the alt-text syntax, Chrome 113 / Safari 17.4 / Firefox ~137 —
suppresses the announcement for purely decorative glyphs. For additions with real meaning, use real
DOM with a real accessible name and `aria-describedby` from the block. Custom Highlights are
invisible to AT by default, which for decoration is correct.

**Data.** None.

**Risk.** Older Firefox ignores the alt syntax and announces the glyph — acceptable. The failure to
watch for is the opposite: suppressing something that carried real information (a claim number the
sighted reader can refer to) and leaving no equivalent.

---

## 33. Prefetch the Source

**What the reader sees.** Following a link out of the article — one of the author's own citations,
or a glossary source — is instant.

**Why it helps.** The brief wants readers to interrogate the text. Interrogation means following
citations, and a two-second page load is a real disincentive at the exact moment curiosity strikes.

**Mechanism.** `<script type="speculationrules">{"prerender":[{"where":{"href_matches":"/read/*"},"eagerness":"moderate"}]}</script>` — `moderate` prerenders on hover.
**Chromium only**; a no-op elsewhere, zero cost. Same-origin only for prerender; cross-origin gets
`prefetch` at best.

**Data.** Article outbound links.

**Risk.** Prerendering runs the target page's JS and can fire analytics — only prerender our own
routes, prefetch (not prerender) anything external, and never prerender something with a side
effect.

---

## 34. Scroll-Marker Section Rail

**What the reader sees.** A row of dots, one per top-level section, that fills in as you pass each
one, with the current one enlarged. Clicking one scrolls there. Entirely CSS — no click handler, no
IntersectionObserver, no "active" class management.

**Why it helps.** This exact component is 150 lines of JS in every reading app on the internet, and
it is now a scroll container plus two pseudo-elements.

**Mechanism.** `scroll-marker-group: after` on the scroller, `::scroll-marker` on each section,
`::scroll-marker-group` for the container, `:target-current` for the active one. **Chromium 135+
only**; needs a JS-driven fallback or graceful absence elsewhere.

**Data.** tree.json depth-1 nodes.

**Risk.** Chromium-only and very new — build the JS version anyway and treat the CSS one as an
optimisation, or skip until it's cross-browser. Requires the sections to be in a scroll container,
which conflicts with document-level scroll-driven animations elsewhere on this list.

---

# Top 5, ranked

1. **Overlap Layer (1)** — the enabling architectural decision. Adopt the Custom Highlight API as
   the substrate and every other range-based decoration gets cheap, overlaps stop being a problem,
   and copy-paste / find-in-page / selection are safe by construction rather than by care.
2. **The Importance Ladder (2)** — the honest version of Greg's "bigger / fainter", built on one
   registered `--importance` property so weight, optical size and contrast move together and the
   whole thing collapses to flat under `prefers-contrast: more`.
3. **Idea Threads (16)** — the piece's ten assumed propositions, each lightable across all its
   occurrences on hover. Nothing else on the list turns "this argument leans on something from
   twelve paragraphs back" into a single gesture, and the data already exists.
4. **Gutter Ladder + Exclusive Marginalia (6 + 14)** — generated headings and arc sentences
   baseline-aligned to the line they describe, one expansion open at a time. Line-level alignment is
   what makes marginalia trusted, and `<details name>` enforces the "not a way of not reading" rule
   structurally.
5. **Arc Rail (8)** — three lines of scroll-driven CSS, running off the main thread, that answer
   "where am I in the argument" continuously and ambiently from data we already generate.

# Left-field

**Confidence Ink.** Every decoration we draw — underline, highlight edge, callout keyline, gutter
bracket — is rendered by a Houdini paint worklet as *hand-drawn* ink, and the steadiness of the line
encodes provenance and model confidence: a clean, confident stroke where the author said it
outright, a wobblier, sketchier one where we inferred it, seeded from the block id so it's identical
on every reload.

I'd be embarrassed to propose a hand-drawn aesthetic in a serious dark-mode reading app, and it's
Chromium-only with a flat-gradient fallback. But it solves the real problem — the reader cannot
currently tell our claims from the author's — using a channel that costs no space, no colour budget
and no words, and it does it *analogue*: uncertainty degrades smoothly instead of being a badge.

It also reframes the whole mode: not a machine annotating a document, but someone who read it first
and left their marks in the margin, which is exactly the register the brief is reaching for.

# Heavy JS that is now three lines of CSS

- Reading progress bar → `animation-timeline: scroll(root block)` + `scale`. Compositor-driven.
- Reveal-on-scroll → `animation-timeline: view(); animation-range: entry 0% cover 30%`.
- Tooltip positioning, flipping, collision → `anchor-name` + `position-area` +
  `position-try-fallbacks` (Firefox still needs the JS).
- Modal layering, z-index wars, light dismiss, focus return → `popover`.
- Accordion where opening one closes the rest → `<details name="x">`.
- Highlighting arbitrary text ranges, overlaps included → `CSS.highlights`.
- List virtualisation for a long article → `content-visibility: auto; contain-intrinsic-size: auto`.
- Truncation fade overlay → `mask-image: linear-gradient(...)`.
- Animating `height: auto` → `interpolate-size: allow-keywords` (Chromium) or
  `transition-behavior: allow-discrete` + `@starting-style`.
- Baseline-aligning marginalia to prose → `subgrid`.
- Fluid type per column, not per viewport → `cqi` units.
- "Is the sticky header stuck?" → `@container scroll-state(stuck: top)` (Chromium).
- Section dots with an active state → `::scroll-marker` + `:target-current` (Chromium).
- Deep-linking to a quote → `#:~:text=` + `::target-text`.
- Deriving a whole tint scale from one accent → `color-mix(in oklch, ...)`.

# Total: 34 ideas.
