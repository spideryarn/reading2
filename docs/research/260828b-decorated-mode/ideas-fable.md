# Decorated mode — ideas (Fable)

Stance: the page as a made object. Printers, scribes, and comic letterers solved "how do you help a
reader hold a long argument" centuries before CSS; the browser can do everything they did plus
things paper never could (layers you can toggle, decorations that know where you are, type that
changes weight continuously). Every idea below keeps every word, in order, unchanged.

---

## 1. Salience Fisheye

**What the reader sees.** The prose is not one uniform grey block. Load-bearing sentences sit a
touch larger and a touch heavier; connective tissue ("It is worth noting that…") sits a touch
smaller and lighter. Not two classes — a continuous gradient, so the paragraph looks like a
landscape with relief rather than text with bold in it. At normal reading distance it reads as an
unusually well-designed book; squint and the skeleton of the argument stands out.

**Why it helps.** Skimming is saccade planning: the eye needs cheap peripheral cues about where to
land next. Continuous size/weight gives those cues without the "someone highlighted my textbook"
effect of binary emphasis. And because everything is still present at readable size, it never
becomes a summary.

**Mechanism.** A variable font (e.g. an opsz+wght axis pair). Per-sentence `<span>`s with
`font-variation-settings: "wght" var(--sal-wght), "opsz" var(--sal-opsz)` and
`font-size: calc(1rem * var(--sal-scale))`, where `--sal-scale` spans ~0.94–1.12. Ease the scale so
neighbours never differ by more than one step (smooth the salience curve before rendering).
`text-wrap: pretty` to stop the size changes making ragged rags.

**Data.** New pass: per-sentence salience 0–1 (a float per sentence, keyed block id + sentence
index). The pass should be told to score *structural* importance (thesis, turn, conclusion), not
vividness.

**Risk.** Done crudely it looks like a ransom note. Line-height must stay locked (`line-height`
in rem, not em) or the leading breathes and it becomes seasick. Also a subtle editorial act — we are
telling the reader what matters; the toggle must be one keystroke.

## 2. Rubrication

**What the reader sees.** As in a medieval manuscript, where the scribe switched to red for the
words that mattered liturgically: a very small number of sentences per article — five to eight in
8,300 words — set in the Spideryarn orange. Not highlighted, not boxed: the ink itself is a
different colour. Everything else untouched.

**Why it helps.** Scarcity is the whole trick. Highlighting fails when 20% of the text is
highlighted; rubrication historically worked because red was expensive. Five orange sentences in a
long essay become the spine you remember the piece by — and you met each one in situ, in context,
having read your way to it.

**Mechanism.** Trivial: `color: var(--accent)` on the sentence span, plus
`text-decoration: underline 1px dotted` suppressed so glossary underlines don't collide. The hard
part is the budget: enforce max N sentences per article *in the prompt schema* (the pass returns
exactly N, ranked).

**Data.** The same salience pass as #1, taking only the top of the distribution; or its own
"rubricate exactly 6 sentences" pass.

**Risk.** Orange is also the interaction accent; readers may try to click them. Give rubricated
sentences no hover affordance, or lean in: clicking one scrolls the arc panel to the matching arc
sentence.

## 3. Rhetorical X-Ray

**What the reader sees.** A row of small toggles in the mode band: *Claims · Evidence · Concessions
· Definitions*. Flip "Claims" and every claim-sentence in the article gets a faint warm wash; flip
"Concessions" and you see, instantly, that Seth concedes exactly three times, all in the middle
third. Layers combine. Off by default.

**Why it helps.** Interrogating an argument means asking "where does he actually argue this, and
where does he merely assert it?" — a question about the *distribution* of rhetorical moves, which
prose hides. This makes the distribution visible without adding a single word to the page.

**Mechanism.** CSS Custom Highlight API — the flagship use case. Build `Range`s over sentence spans,
`CSS.highlights.set('claims', new Highlight(...ranges))`, style with
`::highlight(claims) { background: … }`. Zero DOM mutation, so it composes with every other idea
here, and layers are literally separate `Highlight` objects.

**Data.** New pass: rhetorical role per sentence — `claim | evidence | concession | definition |
transition | colour`, with block id + character offsets within the block (offsets are safe here
because they're relative to a block id, not the document).

**Risk.** Classification errors are visible and specific ("that's not a concession"). Keep the
legend humble ("our reading"), and let a click on any wash show the model's one-line justification.

## 4. Interlinear Gloss

**What the reader sees.** Over the hardest technical phrases — "computational functionalism",
"integrated information theory" — a very small, faint line of plain words floats *above* the
phrase, inside the leading, the way schoolboys' Latin texts carried an English crib between the
lines: `the mind is software` sitting in 60% grey, 0.6em, over "computational functionalism".
Appears only for phrases above a difficulty threshold, and only on first occurrence.

**Why it helps.** A hover card makes you leave the sentence; a gloss keeps your eye on the line. You
read *through* the hard phrase instead of around it. It's the difference between a dictionary on the
desk and a crib between the lines — the crib keeps you in the Latin.

**Mechanism.** `<ruby>computational functionalism<rt>the mind is software</rt></ruby>` — actual ruby
annotation, the platform feature built for exactly this (furigana). `ruby-position: over`,
`ruby-align: center`, `rt { font-size: 0.6em; opacity: 0.55 }`. Needs `line-height` headroom only on
lines that carry ruby — browsers handle this natively.

**Data.** glossary.json already has `difficulty`, occurrences, and `background`; a new tiny pass
compresses each background paragraph to ≤5 plain words.

**Risk.** The strangest-looking idea on this list; some readers will find annotated text
patronising. Threshold on `difficulty × centrality`, first occurrence only, and make the whole layer
one toggle. Also breaks if the gloss is longer than the phrase — cap gloss width and ellipsize.

## 5. Illuminated Initials

**What the reader sees.** Each top-level section — including the sections *we* invented, that Seth
never marked — opens with a three-line drop cap in the accent colour. The cap's form carries a
signal: a solid cap for a section that advances the argument, an outlined cap for one that
entertains an objection.

**Why it helps.** 8,300 unbroken words has no landmarks; landmarks are what make a text mentally
navigable ("the bit after the big M"). Drop caps are the oldest landmark technology there is, and
they mark structure without adding words.

**Mechanism.** `p::first-letter { initial-letter: 3 2; }` — real `initial-letter`, now cross-browser,
which almost nobody uses. Solid vs outline via `-webkit-text-stroke` / `paint-order`. Applied only
to the first block of each tree node at depth 1.

**Data.** tree.json ranges (already have); the solid/outline signal needs a per-section "move type"
(advance / objection / synthesis) — a small pass over the tree gists.

**Risk.** Drop caps on generated section boundaries assert our segmentation confidently; if the tree
is wrong the page looks wrong. Also collides with #1 if the first sentence is scaled — exempt
first letters from the fisheye.

## 6. Manicules

**What the reader sees.** In the left margin, occasionally, a small pointing hand — ☞ — the mark
Renaissance readers drew beside passages worth returning to. Ours point at the most quotable,
most load-bearing passages; the reader's own comments add manicules in a second colour. Hovering
one shows the block's one-line label.

**Why it helps.** It borrows five hundred years of learned association: a manicule means *a reader
was here and thought this mattered*. Unlike highlighting it doesn't touch the text at all — the
prose stays pristine, the judgment stays in the margin, which is the correct epistemic register for
an annotation that is an opinion.

**Mechanism.** Margin glyphs via `position-anchor` / anchor positioning (each block already has an
id to anchor to), `position-area: left`, falling back to absolute positioning in a gutter grid
column. The hover label is the `popover` attribute, no JS beyond toggling.

**Data.** labels.json (hover text), salience pass (where to point), comments.json (reader
manicules).

**Risk.** Margin clutter if combined with #7, #11, #20 — the margin needs a single traffic
controller. On narrow viewports there is no margin; manicules become inline pilcrow-like marks or
disappear.

## 7. Provenance Ledger

**What the reader sees.** ideas.json says the piece *assumes* some propositions, *argues* others,
*cites* the rest. Where a proposition first enters the text, a small stamp appears in the margin —
a wax-seal-like roundel: **A** (assumed, amber), **⚖** (argued, white), **❝** (cited, grey) — with
the proposition's name in small caps. Later occurrences get a tiny echo of the same stamp. At the
foot of the article, the ledger: every stamp in a row, the argument's balance sheet.

**What the reader sees, continued.** Hover a stamp: `whyYouNeedIt` in a popover — why the argument
needs this proposition.

**Why it helps.** The single hardest thing in reading argumentative prose is noticing what was
*never argued*. Provenance stamps make assumption-smuggling visible at the exact moment it happens,
in the margin of the very sentence — interrogation, Greg's word, at the point of entry.

**Mechanism.** Anchor-positioned margin roundels (as #6); occurrences give block ids + quoted spans,
so the span gets a faint dotted underline connecting prose to stamp. Footer ledger is plain HTML.
Stamps as inline SVG so the seal can be pretty.

**Data.** ideas.json — already committed, and currently the least-used artefact. Nothing new.

**Risk.** "Assumed" reads as an accusation; Seth might dispute the classification. Label the ledger
as our reading. Ten ideas × occurrences could stud the margin — first occurrences full-size only.

## 8. Stage Directions

**What the reader sees.** Between sections, set off by whitespace, a single italic line in small
type, bracketed like a stage direction: *[The bias named, the essay turns to the theory that would
license conscious AI.]* — arc.json sentences, styled unmistakably as *not Seth's voice*: different
face, italic, indented, brackets.

**Why it helps.** Long arguments lose readers at the turns — you're three paragraphs into the
refutation before realising the essay changed direction. A stage direction at the turn is the
narrator clearing his throat. Because it's visibly typographically foreign, it can't be mistaken
for (or substitute for) the author's prose.

**Mechanism.** Inserted blocks at the boundary blocks of arc ranges. `font-style: italic`, distinct
`font-family`, `&::before { content: "[" }` etc. `content-visibility: auto` on sections keeps the
long page fast.

**Data.** arc.json — already committed.

**Risk.** The closest idea on this list to "reading our text instead of his" — the directions must
say where you *are*, never what he *said*. Keep them under ~20 words; the arc pass may need a
tightening instruction.

## 9. Running Heads

**What the reader sees.** A thin line at the top of the viewport, book-style: article title on the
left like a verso running head, and on the right the *current deepest section title* — changing as
you scroll, including through our generated sections. Set in small caps with a hairline rule.

**Why it helps.** In a codex you always know where you are because the running head tells you every
time you glance up. Scroll position bars answer "how far"; running heads answer "*where* in the
argument" — a different and better question.

**Mechanism.** Section sentinels + IntersectionObserver writing the title into a fixed header; or
pure CSS with `position: sticky` headers per section that visually replace each other. Cross-fade
the title change with a view transition (`document.startViewTransition`) so it turns like a page
rather than flickering.

**Data.** tree.json titles and ranges.

**Risk.** Competes for the same strip of screen as any app chrome. Keep it to one line, hairline
rule, and let it hide on scroll-down / return on scroll-up.

## 10. The Catchword

**What the reader sees.** Hand-press books printed the first word of the *next* page alone in the
bottom corner of each page, so the binder kept order and the reader's voice didn't stumble. Ours:
as you near a section's end, a small right-aligned line fades in below its last paragraph — the
next section's title, preceded by an arrow, in faint small caps: *→ THE HARD PROBLEM, DISSOLVED*.

**Why it helps.** Long-form abandonment happens at section boundaries — the natural exhale point.
A catchword converts the boundary from an exit into a hook: you know what's next before you decide
whether to stop. It adds momentum without touching the prose.

**Mechanism.** An element after each section's last block, `opacity` driven by
`animation-timeline: view()` so it fades in as the section end enters the viewport — a scroll-driven
animation, no JS.

**Data.** tree.json titles.

**Risk.** If the title is a spoiler-y gist it deflates the turn ("→ WHY IIT FAILS" before the
refutation lands). Prefer `sourceHeading` when it exists; ask the title pass for non-spoiling
headings.

## 11. Talmudic Margin

**What the reader sees.** The page of the Talmud puts the text in the middle and the commentary
around it, keyed by position. Ours, gently: glossary entries whose occurrence is on-screen sit in
the right margin as small hanging notes — name in small caps, two lines of `background`, aligned to
the exact line where the term occurs. Scroll and the margin repopulates. The prose column never
moves.

**Why it helps.** Tufte's case for sidenotes: footnotes and hover cards both take your eyes (or
pointer) on a round trip; marginal glosses sit in peripheral vision, consulted with a glance,
costing nothing when ignored. For a term-dense essay (19 entries) this is the difference between
reading with a tutor and reading with a dictionary.

**Mechanism.** CSS anchor positioning: the occurrence span gets `anchor-name`, the note
`position-anchor` + `position-area: right`, with `position-try-fallbacks` to stack notes that would
collide. This is *the* layout that anchor positioning was invented for and almost nothing uses.

**Data.** glossary.json — committed. A pass to compress `background` to ≤2 lines.

**Risk.** The margin traffic problem (#6). Prioritise by `centrality × difficulty`, show at most
~2 notes per viewport, and collapse the rest to dots that expand on hover.

## 12. Lineated Thesis

**What the reader sees.** Two or three sentences in the whole essay — the thesis, the central
refutation, the ethical conclusion — are set not as prose but as *verse*: same words, same order,
but broken into lines at clause boundaries, indented like a Bringhurst poem, with a little air
above and below:

> Conscious AI is not a milestone on any roadmap we are on —
> it is a category error,
> dressed as a prediction.

**Why it helps.** Line breaks are instructions to the voice: they impose pace, stress, and pause.
Prose lets your eye slide over a crucial sentence at skim speed; verse setting makes the eye take
it clause by clause. It is the strongest legal move under the constraint — nothing removed, nothing
changed, only *broken differently* — and it produces the slowing-down that matters exactly where it
matters.

**Mechanism.** The sentence's span gets `white-space: pre-line` with `\n` at clause boundaries (or
inserted `<br>`), `padding-block`, hanging indents via `text-indent: -1em; padding-left: 1em` on
wrapped lines. `hanging-punctuation: first` so opening quotes hang into the margin.

**Data.** New pass: pick ≤3 sentences and return clause-boundary break points (character offsets
within the block).

**Risk.** The most embarrassing idea here — done wrong it's inspirational-poster kitsch. The break
points must be prosodically right (the pass should be prompted with actual lineation principles),
and the budget must be tiny. See left-field, below: I'm suggesting it anyway.

## 13. Bōten Emphasis

**What the reader sees.** Japanese typography emphasises not with italics but with 圏点 — small
dots set above each character of the emphasised phrase. Ours: key *phrases* (not sentences) carry a
fine dot over each word, subtler than bold, stranger than italic, unmistakably deliberate.

**Why it helps.** We need several distinguishable emphasis channels that don't fight: glossary
underlines below, highlight washes behind, salience in the letterforms. Emphasis dots occupy the
one free channel — *above* the text — so phrase-level emphasis composes cleanly with everything
else.

**Mechanism.** `text-emphasis: filled dot; text-emphasis-position: over` — a real CSS property
shipped everywhere and used by almost no one outside CJK. One line.

**Why it helps, honestly.** Also: it's beautiful.

**Data.** The rhetorical pass (#3) at phrase granularity, or a "key phrases" field added to
labels.json's pass.

**Risk.** Western readers haven't seen it; some will think it's stray pixels or a rendering bug.
Use sparingly and consistently so it can be learned.

## 14. Comic Gutters

**What the reader sees.** Nothing, consciously. The vertical space between paragraphs is no longer
constant: paragraphs in the same tight sub-argument sit close; where the tree says a sub-section
ends, the gap widens; where a whole movement ends, wider still, perhaps with a fleuron (❧). The
page acquires *rhythm*.

**Why it helps.** Comics encode elapsed time in gutter width and readers parse it without being
taught. Paragraph spacing that encodes structural distance gives the reader a pre-attentive sense
of the argument's chunking — you feel the sections before you could name them. It is the cheapest
possible structural signal: empty space.

**Mechanism.** `margin-block-start` on each block computed from tree distance between it and its
predecessor (distance to common ancestor), three or four steps on a spacing scale. Fleurons are
`::before` content on movement boundaries.

**Data.** tree.json — committed.

**Risk.** Nearly none — which is why it should ship first. Worst case: wrong tree → odd rhythm,
subliminally.

## 15. Small Print

**What the reader sees.** The boilerplate — bylines, newsletter prompts, "Also by this author" —
shrinks to genuinely small print: 0.75em, greyed, tightly leaded, like the legal matter at the
bottom of a poster. Every word still present and legible; none of it pretending to be the essay.

**Why it helps.** The inverse of emphasis is just as important: the page should *look like* what it
is, and a NOEMA promo is not part of Seth's argument. Demotion (not removal — the constraint holds)
lets the reader's eye price it correctly at a glance.

**Mechanism.** `gistable: false` blocks get a `.small-print` class: `font-size: .75em; opacity:
.55; line-height: 1.3`. Optionally `<details name="boilerplate">` groups so consecutive boilerplate
folds to a one-line summary — progressive disclosure of *display*, all words one click away.

**Data.** blocks.json `gistable` — committed.

**Risk.** If `gistable` misfires on real prose we've demoted the author. The folded variant flirts
with the constraint's spirit — keep the collapsed summary line verbatim (the block's own first
words, ellipsized), never a paraphrase.

## 16. Ghost Echo

**What the reader sees.** A pull quote — but honest. The sentence appears large in a break between
paragraphs *before* you reach it, as pull quotes do; when you then reach the real sentence in the
prose, it carries a faint warm wash, and the pull quote, now above the fold, has gone quiet.
Clicking the pull quote scrolls to and flashes the original.

**Why it helps.** The classic pull quote's sin is that people read it *instead of* the prose. The
echo inverts the relationship: the big setting is an advance promise, and the payoff is meeting the
sentence at home, in context. The wash on arrival closes the loop — "this is the one you were
promised."

**Mechanism.** The wash via the Custom Highlight API keyed to scroll position; the click-to-source
via `href="#:~:text=…"` — `::target-text` styles the landed-on sentence, a platform feature built
for exactly this and almost never used deliberately.

**Data.** Rubrication set (#2) supplies the sentences; blocks.json positions the echo a screenful
early.

**Risk.** Duplicating a sentence adds words to the page (allowed — we may add) but a reader might
count it as manipulation of the text; the visual grammar must make "quotation of what's below"
unambiguous (big quote marks, hairline rules).

## 17. Speaker Tints

**What the reader sees.** Quoted speech gets a per-speaker tint on the quotation marks and a thin
underline in that speaker's colour: Lemoine's quotes one hue, quoted IIT proponents another,
scripture and literature a third. A tiny margin swatch names the speaker on first appearance —
comic-book lettering's colour-coded balloons, applied to essayistic quotation.

**Why it helps.** Argumentative essays ventriloquise — half the strongest claims in the Seth piece
are *other people's*, held up for inspection. Readers routinely mis-attribute quoted claims to the
author. Colour makes "who is speaking" pre-attentive, which is precisely the attribution machinery
the argument depends on.

**Mechanism.** Spans over quoted ranges: `text-decoration: underline 1px solid
var(--speaker-hue)`, `text-underline-offset` below the glossary underline's offset so both
coexist. Swatches in margin via anchor positioning.

**Data.** New pass: quotation spans → speaker (name or "the author quoting X"), with block ids +
offsets. Glossary `kind: person` entries seed the speaker list.

**Risk.** Underline channel is getting crowded (glossary, provenance, speakers) — needs the one
underline-style budget table for the whole design. Colour-per-speaker must survive the dark
palette's contrast requirements.

## 18. Anaphora Threads

**What the reader sees.** Hover "this claim", "such a view", "it" at a paragraph opening, and a
thin curved line draws from the pronoun back to the sentence it refers to, which lifts to full
contrast for a moment. Like the string on a pinboard, drawn only on demand.

**Why it helps.** The single most common comprehension failure in dense prose is losing an
antecedent — you read three sentences about "this argument" while unsure which argument. The cost
today is re-scanning backwards; the thread makes resolution a hover.

**Mechanism.** A pass emits (pronoun span → antecedent span) edges. Hover draws an SVG path in an
overlay between the two anchor rects (`getBoundingClientRect` of two ids); antecedent lift via
Custom Highlight. If the antecedent is off-screen, the thread runs to the viewport edge and a small
anchored card shows the antecedent text.

**Data.** New pass: anaphora edges for *load-bearing* references only (not every "it") — block id +
offsets both ends.

**Risk.** Resolution errors are worse than nothing (confidently wrong string). Emit only
high-confidence edges; the pass should abstain freely.

## 19. Difficulty Weather

**What the reader sees.** In the spine/scrollbar gutter, a faint terrain profile of the whole
article: bumps where glossary `difficulty × density` is high, flat where the prose is easy. Like a
stage profile of a Tour de France route. You can see the IIT climb coming three screens away.

**Why it helps.** Readers abandon hard passages partly because difficulty arrives unannounced and
feels like *their* failure. A forecast reframes it: this section is a climb, it lasts two screens,
then it eases. Pacing knowledge is stamina.

**Mechanism.** One inline SVG polyline in the gutter, position mapped to block index; current
position via a scroll-driven marker (`animation-timeline: scroll()`). Cheap.

**Data.** glossary.json difficulty + occurrence density per block; optionally sentence-length
variance as a free second signal.

**Risk.** Could scare readers off the climb instead of pacing them into it. Keep it faint,
unlabeled, learnable — terrain, not warning signs.

## 20. Second Reading

**What the reader sees.** On first pass, the prose is almost clean — glossary underlines and
structure only. When the reader scrolls *back up*, or revisits the article, the decorations are
there: salience relief, rubrication, stamps, washes. The page remembers that this is a re-reading
and dresses for it.

**Why it helps.** First reading and re-reading are different cognitive tasks: comprehension wants
minimal interference; review and interrogation want maximal scaffolding. Every other idea on this
list has a "too much for first contact" risk — this one idea retires that risk for all of them by
making decoration a *phase*, not a mode.

**Mechanism.** IntersectionObserver marks blocks seen; upward scroll past seen blocks (or a return
visit, via reader state) flips a `data-reread` attribute on the container; decorations gate on
`[data-reread] .…`. Transitions on `opacity` so the dressing fades in rather than popping.

**Data.** None new — reader scroll state (already tracked for scroll position).

**Risk.** Magic-feeling; readers may not understand why the page changed. A one-time toast ("You've
been here — showing the margins now") and a manual override switch.

## 21. Section Frontispiece

**What the reader sees.** Each top-level movement opens like a chapter in a well-made book: a short
rule, the section title (ours or Seth's, visually distinguished — his in roman, ours in italic),
and beneath it the tree node's `gist` set small, as an epigraph. A quarter-screen of air. Then the
prose resumes.

**Why it helps.** Chapter openings are commitment points: they let the reader take a breath,
predict, and decide to continue — which paradoxically increases continuation. Marking *our*
headings as ours (italic) keeps the authorship ledger honest.

**Mechanism.** Inserted heading blocks at tree depth-1 boundaries; `<hgroup>` with the gist in
`<p>`; `text-wrap: balance` on the title; the roman/italic authorship convention documented in the
legend.

**Data.** tree.json titles + gists + `sourceHeading` — committed.

**Risk.** The gist-as-epigraph is a mini-summary sitting before the prose — the closest legal thing
to the off-brief summary. Keep it one sentence, small, grey; or show it only in the Second Reading
phase (#20).

## 22. Back-of-Book Index

**What the reader sees.** After the article's last line: an index, as in a printed monograph.
Every glossary entry and idea, alphabetised, small caps, each followed not by page numbers but by a
row of tiny numbered links — its occurrences. Clicking one jumps to the passage with the term
flash-highlighted.

**Why it helps.** An index is the original random-access interface to a linear text, and it serves
the *interrogation* half of the brief: "where did he actually discuss panpsychism?" is answered in
one glance and one click. Its position — after the end — means it can't preempt reading.

**Mechanism.** Generated `<nav>`; links as `#:~:text=` text fragments so `::target-text` styles the
landing (orange flash, then decay via CSS transition). Zero new layout machinery.

**Data.** glossary.json + ideas.json occurrences — committed.

**Risk.** Almost none; worst case unused. The one design sin to avoid is putting it anywhere but
the very end.

## 23. Tidemarks

**What the reader sees.** Very faint hairline rules across the text column every ~two minutes of
reading time, each with a small marginal number: *4 min · 6 min · 8 min*. Like depth marks on a
harbour wall. Optionally a second mark showing *your* actual pace once you've read a few screens.

**Why it helps.** "How long is this really" is the question every reader asks and every progress
bar answers badly (pixels ≠ minutes; boilerplate ≠ prose). Tidemarks put the answer *in the text's
own geography*, and pacing feedback ("you're outpacing the 12-min estimate") builds the stamina
that long-form needs.

**Mechanism.** Cumulative `words`/wpm from blocks.json → insert marks after the nearest block
boundary. Hairline `border-top` on a zero-height div, margin label anchor-positioned.

**Risk.** Reading-as-workout vibes; some readers will feel clocked. Off by default, and never show
"behind pace" framing — marks measure the text, not the reader.

**Data.** blocks.json `words` — committed.

## 24. Argument Ribbon

**What the reader sees.** Down the left edge of the text column, a continuous 3px ribbon whose
colour follows the argument's *mode* through the scroll: cool grey while Seth describes, amber
while he concedes, the accent while he attacks, white at the conclusion. As you scroll, you can see
the mode change coming — the ribbon warms a paragraph before the prose turns.

**Why it helps.** It's the arc made ambient. You develop a feel for the essay's dramatic structure
— "we're deep in the concession stretch" — from peripheral vision alone, without reading a single
added word. Pre-attentive orientation, zero text.

**Mechanism.** A fixed-position gradient strip whose background is a `linear-gradient` with stops
computed from arc/rhetoric ranges, translated with `animation-timeline: scroll()` so ribbon
position tracks document position exactly. Pure CSS after generation.

**Data.** arc.json ranges + the rhetorical pass (#3) aggregated per range.

**Risk.** Another gutter claimant (with #19 — they could be the same strip, terrain drawn *on* the
ribbon). Colour semantics need a learnable legend; four hues maximum.

## 25. Marginalia Hand

**What the reader sees.** The reader's own comments (comments.json) render in the margin in a
distinctly *handwritten*-feeling style: a humanist italic webfont, slightly irregular baseline
(±1px), a hairline connector to the quoted span, ink-blue rather than UI-grey. Model answers, when
present, sit beneath in ordinary type — machine voice in machine type.

**Why it helps.** Marginalia is the oldest interrogation technology, and its power is *ownership* —
your past self talking to your present self. Rendering reader notes in a hand-like register (vs.
model output in type) keeps the two voices honest and makes the reader's own thinking feel like the
primary layer, which is exactly the augment-don't-replace hierarchy.

**Mechanism.** Anchor-positioned margin blocks (as #11); the hand style is a font + `transform:
rotate(-0.3deg)` + tiny per-note `--jitter` custom property. Connector is a 1px absolutely
positioned rule.

**Data.** comments.json — committed.

**Risk.** Fake-handwriting can read as twee. Keep it to *register* (italic, ink colour, ragged
setting), not skeuomorphic paper-and-tape.

## 26. First-Occurrence Birthmark

**What the reader sees.** The first time a glossary term appears, it's marked properly: small-caps
setting of the term itself, a degree-mark ° after it (the convention technical books use for
"defined elsewhere"), and the margin gloss (#11). Every *later* occurrence carries only the
faintest dotted underline — still linked, no longer shouting.

**Why it helps.** Today every occurrence is underlined equally, so the signal decays into wallpaper
by paragraph ten. Introduction and reference are different reading events; typography should price
them differently. This also teaches the reader *where terms were introduced* — which is where
they'll return when lost.

**Mechanism.** `font-variant-caps: small-caps` on first occurrence spans; `°` via `::after`;
later occurrences `text-decoration: underline 1px dotted; text-decoration-color:
color-mix(in oklch, currentColor 25%, transparent)`.

**Data.** glossary.json occurrences (ordered) — committed.

**Risk.** Small-caps on the author's words is a display change squarely inside the constraint, but
it's a *strong* one — if the "first occurrence" the pipeline found is mid-quotation it looks wrong.
Guard against occurrences inside quoted speech.

## 27. Numbers That Matter

**What the reader sees.** Every numeral in the prose sits in proper tabular lining figures, subtly
firmer than the surrounding oldstyle text. The three-to-five numbers that actually *matter* in the
piece each get a small margin annotation restating them with their unit and one line of context —
the "key stats" sidebar dissolved into the margins at the exact points of occurrence.

**Why it helps.** Numbers carry argumentative weight disproportionate to their character count, and
eyes skip them in prose. Typographic differentiation makes them land; the margin restatement gives
them a second, glanceable life without a stats box that would invite reading *instead*.

**Mechanism.** `font-variant-numeric: lining-nums tabular-nums` on number spans (a real, unused
platform lever); margin chips anchor-positioned.

**Data.** The brief itself suggests the pass: "the three numbers that matter" — numeral spans +
one-line context each.

**Risk.** The Seth essay is number-light; this idea earns its keep on other articles. Degrade to
nothing gracefully when the pass returns an empty list.

## 28. Breadcrumb Compass

**What the reader sees.** Select any sentence (or triple-click a paragraph) and a small popover
appears above the selection: the path through the tree to here — *Myth › The Psychology of Belief ›
Anthropomorphism* — each crumb clickable, plus the node's gist in one grey line. A "you are here"
sign summoned on demand.

**Why it helps.** Getting lost mid-essay is a *localisation* failure; the fix is a map query, not a
map always on screen. Binding it to selection means it appears exactly at the moment of "wait,
where am I", with zero standing screen cost.

**Mechanism.** `selectionchange` → popover (the `popover` attribute + `showPopover()`), positioned
with anchor positioning to the selection's rect. Crumbs from walking tree.json to the block id.

**Data.** tree.json — committed.

**Risk.** Colliding with the existing selection→comment affordance; the popover must share that
surface, not fight it.

## 29. Fleuron Grammar

**What the reader sees.** Between movements, centred ornaments — but chosen from a tiny *grammar*:
❦ where the argument continues in the same direction, ⁂ where it turns, ❧ where a movement
concludes. Three glyphs, consistent all through the library, learnable in one article.

**Why it helps.** Printers' ornaments were always semantic-ish (section, silence, ending); making
the mapping explicit gives the reader a one-glyph forecast of *what kind of boundary* they're
crossing — continuation, turn, or close — before the next section commits them.

**Mechanism.** `::before { content: "⁂" }` on boundary elements, class from the section "move
type" pass (#5). One afternoon.

**Data.** The move-type pass (shared with #5).

**Risk.** Precious if overdone; three glyphs and never more. Wrong move-type is a wrong promise —
same mitigation as #10 (non-spoiling).

## 30. The Answering Voice

**What the reader sees.** In the margin, rarely — at most three or four times per article — a short
italic question in the machine's own visually-distinct register: *What would falsify this?* beside
the IIT exposition; *He assumed this on page one* beside a conclusion that leans on an unargued
premise (linked to its Provenance stamp, #7). Not commentary, not summary: only questions, and only
ones the text itself makes askable.

**Why it helps.** Greg's brief says *interrogate*. Most readers don't know which questions a text
invites; a tutor's power is asking, not telling. Questions are also the safest speech-act for a
model in the margin — a wrong question wastes a glance, a wrong assertion poisons the reading.

**Mechanism.** Margin blocks (machinery of #11/#25). Each question links (`#:~:text=`) to the
passages it arises from.

**Data.** New pass: ≤4 Socratic questions, each with anchoring block ids and the ideas.json
proposition it touches, constrained to *questions only* in the schema.

**Risk.** The margin voice becoming a co-author. The ≤4 budget and questions-only schema are the
guardrails; if it ever answers itself, it's off-brief.

## 31. Typographic Bedrock

**What the reader sees.** No feature — the absence of a hundred small uglinesses. Quotation marks
hang into the margin; no line ends on "a"; the rag is calm; headings never break awkwardly; long
URLs and words break cleanly.

**Why it helps.** Every decoration above is being added to a canvas; if the canvas has the jitter
of default browser typesetting, decorations read as more noise. Book-grade setting is what makes
the *rest* of decorated mode read as intentional. This is the floor the ceiling stands on.

**Mechanism.** `hanging-punctuation: first last` (Safari today, harmless elsewhere);
`text-wrap: pretty` on prose, `text-wrap: balance` on headings; `hyphens: auto` with `lang` set;
`font-variant-ligatures: common-ligatures`; `orphans`/`widows` for any paged/print styles;
`overflow-wrap: break-word` scoped to links.

**Data.** None.

**Risk.** None worth the name. Ship it before everything else.

## 32. Zoom Crossfade

**What the reader sees.** Decorated mode meets granularity zoom: when the reader zooms out a level,
the prose doesn't vanish — it *recedes*, blurring and compressing vertically while labels/gists
sharpen into place over it, the rubricated sentences (#2) staying legible longest, like a city
seen from higher up where only the monuments stay identifiable. Zoom back in and the prose
resolves.

**Why it helps.** Zooming today is a swap; a swap breaks the reader's spatial map. A continuous
recession keeps the invariant that *the words are always there* — the summary is visibly a view
*over* the text, never a replacement for it. That is the product's whole thesis, made visible.

**Mechanism.** View Transitions API between zoom levels with shared element names per block;
receding prose via `filter: blur()` + `opacity` + `transform: scaleY()` on the old snapshot;
rubricated sentences given their own `view-transition-name` so they persist across the fold.

**Data.** Existing zoom artefacts + rubrication set (#2).

**Risk.** Motion cost on a 141-block page — needs `content-visibility` discipline and honest frame
budgets; must respect `prefers-reduced-motion` with a plain crossfade.

## 33. Candlelight

**What the reader sees.** The paragraph under the reader's eye sits at full off-white contrast; text
a screen away has settled to perhaps 78% opacity — a soft pool of light that travels with the
scroll, like reading by candle. Never *un*readable anywhere; just a gentle centre.

**Why it helps.** On an infinite dark scroll, nothing marks *the place you are reading* — the eye
re-finds its line after every glance away by brute search. A luminance centre cuts that re-entry
cost, and calms the peripheral field without hiding it.

**Mechanism.** Pure CSS scroll-driven animation: each block animates `opacity` along
`animation-timeline: view()` with a keyframe peak at viewport centre (`animation-range` to shape
the pool). No JS, compositor-only.

**Data.** None.

**Risk.** The one idea here that can genuinely *impede* reading if the floor opacity is too low or
the pool too tight — readers scan ahead, and ahead must stay readable. Floor at ~75%, wide pool,
off for `prefers-reduced-motion`, and instantly toggleable.

---

## Top 5, ranked

1. **#1 Salience Fisheye** — it *is* decorated mode: Greg's seed idea done as continuous typographic
   relief rather than crude binary bolding; everything else decorates around it.
2. **#3 Rhetorical X-Ray** — toggleable argument layers with zero DOM mutation; the single best fit
   for "follow the argument" and the flagship Custom Highlight API use.
3. **#7 Provenance Ledger** — ideas.json is the best artefact nobody is using, and
   assumption-stamps at the point of entry is interrogation made physical.
4. **#20 Second Reading** — the meta-idea that de-risks all the others by making decoration a phase
   of reading, not a costume the page always wears.
5. **#11 Talmudic Margin** — glossary as glanceable marginal glosses; the biggest per-pixel
   comprehension win, on data we already have, on the layout anchor positioning was born for.

(#31 Typographic Bedrock isn't ranked because it isn't optional.)

## The left-field one

**#12 Lineated Thesis.** Take the two or three sentences the whole essay exists to deliver and set
them as verse — same words, same order, broken at clause boundaries with hanging indents, air above
and below. Line breaks are instructions to the reading voice: they force the pace and the pauses
that a crucial sentence deserves and that prose-skimming destroys. It is the most audacious thing
you can do inside "no words removed, no words changed" — and if the breaks are prosodically right,
the thesis will be the thing every reader remembers verbatim.
