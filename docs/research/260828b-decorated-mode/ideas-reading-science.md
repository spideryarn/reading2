# Decorated mode — ideas from reading science and HCI

Written against the second principle: **a decoration must not become a way of not reading.** The
literature is unkind here. The reading aids people reach for first — pre-highlighting, summaries
above the text, speed-read modes, fixation bolding — are mostly the ones with weak or negative
evidence, and they share a failure mode: they raise the reader's *confidence* faster than their
comprehension (the illusion of fluency; judgments of learning track ease of processing, not
retention). The ones with good evidence make the reader produce something: retrieval practice,
self-explanation, elaborative interrogation, generation, spacing.

Three findings shape almost every idea below.

- **Regressions are functional.** Roughly 10–15% of saccades in normal reading go backwards, and
  they do repair work — resolving a pronoun, recovering from a garden path, re-checking a number.
  Any decoration that discourages or prevents going back is hostile.
- **Filling coherence gaps can hurt.** McNamara & Kintsch's reverse-cohesion result: readers with
  enough background knowledge learn *more* from a text whose gaps they have to bridge themselves. So
  our job is to mark where the gap is, not to fill it.
- **Signalling is the safe family.** Mayer's signalling principle: cues that expose *structure*
  without adding *content* reliably help, and don't substitute for the prose. Nearly everything below
  is signalling, a prompt, or typography.

---

## A. Orientation — holding the situation model

### 1. Read-First Ink

**What the reader sees.** A blanket policy rather than a widget: any text *we* generate about a span
— gist, label, heading, arc sentence, summary — is rendered at ~6% opacity with a 3px blur until the
reader's viewport has passed the last block of that span. Then it resolves, once, over ~400ms, and
stays legible for the rest of the session. Nothing we wrote about a passage is readable before the
passage.

**Why it helps.** This is the single structural defence against the whole class of "decoration
becomes substitute". A summary placed before its text is a spoiler that licenses skipping; the same
summary placed after is a retrieval cue and a consistency check against what the reader just built.
It also converts every summary artefact we own into a *feedback* signal, which is the half of the
testing effect that actually produces learning.

**Mechanism.** One `[data-locked]` attribute per generated element with `filter: blur(3px);
opacity: .06; transition: filter .4s, opacity .4s`. An `IntersectionObserver` with
`rootMargin: "0px 0px -60% 0px"` on the span's last block flips it. Persist unlocked ids in
`localStorage` per article. `content-visibility: auto` on locked marginalia so they cost nothing.

**Data.** None new — it is a rendering rule over `tree.json`, `summary.json`, `arc.json`,
`labels.json`, all of which already carry block ranges.

**Risk.** Feels withholding on a re-read (fix: unlocked state persists; a "reveal all" affordance in
settings, not on the page). If the range metadata is wrong the reader sees permanent grey mush. Blur
is expensive if applied to hundreds of nodes at once — hence `content-visibility`.

### 2. The Arc Rail

**What the reader sees.** A 220px left gutter carrying one `arc.json` sentence in small caps-height
type, vertically centred against its block range and *sticky* within it. As you scroll, the sentence
holds still, then hands off to the next with a soft cross-fade at the range boundary. It is the only
persistently visible generated text on screen.

**Why it helps.** The costliest failure in an 8,300-word argumentative essay is losing the thread —
you understand every sentence and cannot say what the section is doing. Kintsch's situation model has
to be maintained across paragraphs, and it degrades under working-memory load. A single always-present
"where we are in the argument" sentence is an external anchor for exactly the representation that
decays. Crucially it is *about the argument's position*, not a paraphrase of the content, so it
cannot be read instead of the prose.

**Mechanism.** `position: sticky; top: 40vh` inside a per-range wrapper; the wrapper's height is the
range's height so stickiness expires at the boundary naturally. Cross-fade with
`animation-timeline: view()` on the incoming sentence. Falls back to plain sticky with no animation.

**Data.** `arc.json` as-is.

**Risk.** Steals horizontal space on narrow screens (below ~1100px it should collapse to a one-line
sticky strip under the running head). If arc sentences are long it becomes a parallel article to
read — cap at ~140 characters in the pass, and set it at 0.8× body size, 60% opacity.

### 3. Running Heads, Book-Style

**What the reader sees.** A 28px sticky bar at the top of the reading column, in the manner of a
printed book's verso/recto: parent section title on the left, current subsection on the right, both
from `tree.json`, both in the accent orange at low opacity. Generated headings are set in italic;
the author's own (`sourceHeading`) upright. Scrolling changes them without animation.

**Why it helps.** Cheapest possible orientation. Long-form web reading loses the affordance that
codices give for free — knowing which chapter you are in without looking. The italic/upright
distinction is an honesty mark: the reader can always tell our words from the author's, which matters
for trust in every other decoration on the page.

**Mechanism.** `position: sticky; top: 0` bar, updated by an `IntersectionObserver` over the deepest
tree nodes. `font-variant: small-caps` and `font-style: italic` for provenance. `text-wrap: balance`
if it wraps.

**Data.** `tree.json` (`title`, `depth`, `sourceHeading`).

**Risk.** Sticky bars eat vertical space on laptops; it should hide on scroll-up-fast, appear on
scroll-stop. Generated titles that are subtly wrong are worse here than anywhere, because they are
always on screen.

### 4. Generated Headings, Set as Headings

**What the reader sees.** Where `tree.json` has a node with `sourceHeading: null`, we insert its
generated title in the flow as a real heading — but visually demoted and marked as ours: italic,
body-size, 70% opacity, preceded by a thin orange rule that stops short of the text (a printer's
dinkus rule rather than a full-width band). Author headings keep their existing full weight.

**Why it helps.** Straight Mayer signalling: headings improve recall of structure and let the reader
segment the text into chunks the working memory can close off. An essay that runs 2,000 words without
a break forces the reader to hold an unbounded chunk. The visual demotion is not decoration for its
own sake — it prevents our heading from being mistaken for the author's framing of their own
argument.

**Mechanism.** Insert `<h3 data-generated>` between blocks at range starts. `::before` rule via a
1px border on a `::before` pseudo of fixed width. Respect the existing heading scale but subtract one
step.

**Data.** `tree.json`.

**Risk.** Over-segmenting. Cap insertion at one generated heading per ~600 words and only at
`depth <= 2`, or a 141-block article grows 25 headings and reads like a wiki. A wrong heading
mis-frames three paragraphs before the reader can correct it.

### 5. Section Ledger

**What the reader sees.** In the gutter beside every generated or authored heading: `~340 words ·
2 min`, and as you read through it, a hairline vertical rule beside the prose fills downward in
orange. There is no whole-article progress bar.

**Why it helps.** Commitment at the right granularity. Whole-article progress bars mostly produce
dread on a 40-minute read; a per-section budget offers an honest, closeable unit and supports the
decision "do I have time for this section now?" — which is the decision people actually make. It also
makes an unusually dense section legible as dense *before* the reader concludes they are stupid.

**Mechanism.** `words` summed from `blocks.json` per range. Fill rule animated with
`animation-timeline: view(); animation-range: contain 0% contain 100%` on the section wrapper — no
JS scroll handler at all.

**Data.** `blocks.json` `words` + `tree.json` ranges.

**Risk.** Reading-time estimates are personal; a fixed 200wpm will be wrong for most readers. Derive
it from the reader's own measured pace after the first two sections (`reader-profile.md`).

---

## B. Argument structure — the shape of the case being made

### 6. Whose Voice Is This

**What the reader sees.** Each sentence carries a hairline 2px left border on its containing block,
and within mixed blocks a `::highlight()` background at ~4% alpha: nothing for the author's own
assertions, a cool slate tint for a view being reported or steelmanned, a warm tint for a source
being quoted or cited approvingly. A one-word gutter tag on hover: *reported*, *quoted*, *ours*.

**Why it helps.** The commonest comprehension failure in argumentative prose is misattribution — the
reader assigns the opposing position to the author, especially when the author steelmans it
generously before refuting it. Seth's essay does exactly this: it lays out the case for machine
consciousness at length before dismantling it. Readers who lose track of the voice come away
believing the opposite of the thesis. This is a discrimination the reader *cannot* make faster by
skipping, so it cannot substitute for reading; it only prevents an error.

**Mechanism.** New model pass. CSS Custom Highlight API (`CSS.highlights.set()`, `::highlight(voice-reported)`)
so we tint sub-block ranges without inserting a single wrapper element into the author's HTML — which
matters because we must not perturb the DOM the block-id contract addresses.

**Data.** New pass: per sentence (or per span), `{blockId, start, end, voice: author|reported|quoted|hypothetical}`.
Cheap; the same pass can emit rhetorical role (#9).

**Risk.** The model will get boundaries wrong at the exact places that are hardest — free indirect
style, rhetorical questions the author asks in the opponent's voice. A wrong tint here actively
manufactures the misreading it was meant to prevent, so this needs to be conservative: tint only
where confidence is high, leave the rest untinted, and never tint the whole essay.

### 7. The Turn Gutter

**What the reader sees.** Discourse connectives that mark a change of direction — *But*, *However*,
*Yet*, *And yet*, *On the other hand*, *The trouble is* — get a small orange glyph hung in the left
margin beside the line they start on (↩ for concession, ⤳ for consequence, ⤨ for contrast). The word
itself is untouched.

**Why it helps.** Connectives are the reader's main cue for updating the situation model, and they
are also the easiest thing to skate over — they are short, high-frequency, and frequently skipped in
the eye-movement record. Marking them in the *margin* rather than in the text is the whole trick: it
does not disturb saccade targeting inside the line (see the backfire list on varying type size
mid-line), and it gives a skimming eye a structural map of the argument's turns down the page. You
can see, from the glyph column alone, that a section is three concessions and a conclusion.

**Mechanism.** A pass emits offsets; render via CSS Custom Highlight for the word plus an absolutely
positioned `::before` on a zero-width marker span in the gutter, or CSS anchor positioning
(`anchor-name` on the highlight anchor, `position-anchor` on the glyph) so glyphs track reflow for
free.

**Data.** New pass, or a plain lexicon plus a sentence-initial-position rule — this one barely needs
a model.

**Risk.** Density. English prose is full of *but*; cap at the top ~15 turns per article by the
model's judgement of which turns actually pivot the argument. Glyph vocabulary must stay at three or
fewer or nobody learns it.

### 8. Concession Lane

**What the reader sees.** A span the model marks as a concession or steelman — where the author is
making the other side's case as strongly as they can — is indented 2ch and gets a faint vertical rule,
like a long quotation, without becoming a blockquote. It re-joins the flush margin at the point the
author turns back.

**Why it helps.** It makes the essay's rhetorical spine visible as *shape* rather than as text.
Argumentative essays have a physical structure — thesis, steelman, refutation, implication — and
readers who can see it can allocate effort to it (skim the setup, slow at the turn). This is the
honest version of "make less important stuff fainter": it does not judge sentences important or
unimportant, it says what *job* the sentence is doing, which the reader can then weigh for themselves.

**Mechanism.** `padding-inline-start` and `border-inline-start` on the affected blocks, plus
`text-indent` handling for partial-block starts. View transitions if the lane can be toggled off.

**Data.** Same rhetorical-role pass as #6/#9.

**Risk.** Indentation reads as "quotation" to most people; if a concession lane looks like a
blockquote the reader will assume those are someone else's words. Needs a visually distinct treatment
from real blockquotes, and the two will collide in this article.

### 9. Rhetorical Role Glyphs

**What the reader sees.** A 14px-wide column between the arc rail and the prose, one tiny mark per
sentence, aligned to the sentence's first line: a filled square for a claim, a hollow dot for
supporting evidence, a tilde for a hedge, an arrow for a consequence, nothing for connective tissue.
Read down the column and you see the argument's rhythm — five hollow dots then a filled square is a
passage that earns its conclusion.

**Why it helps.** Signalling without content. The reader still has to read the claim to know what it
is; the glyph only says *there is a claim here*. It supports one of the highest-value critical
reading moves — asking "what is this actually asserting, and what backs it?" — and it makes the
unsupported assertions visible as filled squares with no dots near them, which is exactly the
interrogation Greg's vision asks for.

**Mechanism.** Same anchor-positioning trick as #7. `hanging-punctuation: first` on the prose so the
optical margin stays clean beside the glyph column.

**Data.** New pass: `{blockId, sentenceIndex, role, confidence}`.

**Risk.** It is a new notation and nobody asked to learn one; needs to be legible after one hover
legend or dropped. Also a moderate seductive-details hazard — pretty, and easy to look at instead of
reading. Mitigate by making the column low-contrast and non-interactive during first read.

### 10. The Load-Bearing Toggle

**What the reader sees.** In the margin beside each `ideas.json` proposition's first occurrence, a
small ghosted control: *suppose not*. Tapping it dims every block in the article whose argument
depends on that proposition to 35% opacity, leaves the rest at full, and puts a one-line banner at
the top: *"If 'consciousness requires biological substrate' is false, these 22 blocks lose their
support."* Tapping again restores.

**Why it helps.** This is the interrogation move, made physical. Readers are poor at identifying
which premises a conclusion actually rests on — it requires holding the whole argument in mind at
once, which is exactly what working memory cannot do at 8,300 words. Making the dependency visible as
*the page going dark* is a counterfactual the reader can run in one tap and cannot run in their head.
And it does not tell them whether the premise is true; it shows them what is at stake in the question.

**Mechanism.** A body-level `data-suppose-false="idea-id"` attribute plus a `[data-depends~="idea-id"]`
selector on blocks; `opacity` transition. View transition on toggle so the change reads as a state
change rather than a repaint.

**Data.** `ideas.json` extended with a per-idea list of dependent block ids (a new pass field, or
derivable from `whyYouNeedIt` + `occurrences` with a follow-up pass).

**Risk.** The dependency graph is a strong model claim and will be arguable; presenting it with
confidence is a form of putting words in the author's mouth. Frame the banner as a question
("what leans on this?") and keep it reader-initiated, never automatic.

### 11. Premise Threads

**What the reader sees.** Hovering an idea in the margin lights every occurrence of it in the visible
prose with a soft orange underline *and* draws tick marks down the scrollbar rail at every other
occurrence in the article, so you can see at a glance that this assumption appears in paragraph 4,
then not again until paragraph 60, then four times in a row at the end.

**Why it helps.** Distribution is information. A premise used once in the setup and then leaned on
heavily in the conclusion is doing different work from one threaded evenly through. Seeing the
spacing of an idea's occurrences is a structural fact about the argument that no amount of linear
reading surfaces, because the occurrences are 6,000 words apart.

**Mechanism.** CSS Custom Highlight API for the in-prose lighting (no DOM insertion); a custom
scrollbar rail as an absolutely positioned element with ticks at `offsetTop / scrollHeight`.

**Data.** `ideas.json` `occurrences` as-is.

**Risk.** Hover-only means it is invisible on touch; needs a tap-to-pin equivalent. Scrollbar rails
compete with every other rail we might want (comments, regressions, glossary) — there is only one
scrollbar, so this is a scarce channel and needs a single owner.

---

## C. Sentence-level cost — the small repairs that eat attention

### 12. The Referent Lamp

**What the reader sees.** Ambiguous anaphora — *this*, *it*, *they*, *the former*, *such systems* —
where the antecedent is more than one sentence back, get a dotted underline. Hover or tap and the
antecedent phrase lights up in place: if it is on screen, it glows where it sits; if it has scrolled
off, a small popover shows just that phrase with its block id, anchored beside the pronoun.

**Why it helps.** Anaphora resolution is one of the best-documented per-sentence costs in the
eye-movement literature — readers regress to find antecedents, and when the antecedent is distant or
ambiguous the regression is long and expensive, and the reader often loses their place on the way
back. Resolving it in place, without moving the viewport, removes the *navigation* cost while leaving
the *comprehension* work intact: you still have to know what "such systems" means for the sentence to
make sense.

**Mechanism.** `popover` attribute + CSS anchor positioning (`anchor-name` on the pronoun's highlight
anchor, `position-area: block-start span-inline-end`, `position-try-fallbacks: flip-block`) so the
card never leaves the viewport and no JS positioning code exists. Highlighting via Custom Highlight
API.

**Data.** New pass: `{blockId, span, antecedentBlockId, antecedentSpan}` for long-distance anaphora
only.

**Risk.** Over-marking. If every "it" is dotted the page looks like a proofreading exercise. Only
mark where the antecedent is ≥2 sentences back *and* the model rates the resolution non-obvious;
expect fewer than 20 per article.

### 13. First-Mention Ink

**What the reader sees.** The first occurrence in the whole article of each central glossary term is
set marginally darker than body text (say off-white at 100% against a body at 88%) with a single
`text-emphasis` dot above it. Every subsequent occurrence is plain. The dot never repeats.

**Why it helps.** The given–new contract: the first time a term appears, the reader must build a new
entry in their situation model; afterwards they only have to retrieve one. Those two operations have
very different costs and readers do not know in advance which one they are about to perform. Marking
first mentions puts the emphasis exactly where the encoding work happens, and — unlike ordinary
highlighting — it decays to nothing, so it never accumulates into a second, competing article.

**Mechanism.** `text-emphasis: dot; text-emphasis-position: over` (well supported, almost unused
outside CJK typography). Per-occurrence class from `glossary.json` occurrence order.

**Data.** `glossary.json` occurrences + `centrality`.

**Risk.** `text-emphasis` adds line height above the first line it appears on; with 19 glossary
entries the vertical rhythm will jitter unless leading is set to accommodate it globally.

### 14. Three-Entity Tint

**What the reader sees.** At most **three** entities — chosen by `centrality` — get a persistent,
very low-saturation underline in three distinguishable hues (never red/green together). In Seth's
essay that might be *Seth's own position*, *the computational-functionalist position*, and *LaMDA/
Lemoine*. Everything else stays plain.

**Why it helps.** Keeping track of who holds which position across 8,000 words is a working-memory
load that a colour channel can carry for free — the reader offloads identity tracking to perception
and spends the freed capacity on the argument. The hard cap at three is the whole design: colour
coding degrades sharply past a handful of categories, and a rainbow page is worse than a plain one.

**Mechanism.** `text-decoration: underline; text-decoration-color: …; text-underline-offset: 3px;
text-decoration-thickness: 1px` via Custom Highlight ranges. Must survive dark mode — on near-black,
saturation reads much stronger than on white, so tints need to be roughly half the chroma you would
use on paper.

**Data.** `glossary.json` (`centrality`, occurrences, aliases).

**Risk.** Colour-blindness (never rely on hue alone — pair each with a distinct underline style:
solid, dotted, wavy). Also collides directly with the existing glossary underline; these two cannot
both be underlines, so one must move to a different channel.

### 15. The Number Ledger

**What the reader sees.** Every quantity in the prose is set in tabular lining figures and gets a
hairline dotted box. Hover shows a small card: the other places in the article this same number or
quantity appears, and the sentence each sits in. A section-end strip can list the numbers that
section introduced.

**Why it helps.** Numbers are where arguments smuggle. A reader who meets "86 billion neurons" in
paragraph 12 and a claim scaled against it in paragraph 90 usually cannot recall the first figure
precisely, and will accept the second rather than scroll. Making the number's own history one hover
away supports checking, which is the interrogation behaviour we want, and it costs nothing to a reader
who does not care.

**Mechanism.** `font-variant-numeric: tabular-nums lining-nums`; popover + anchor positioning for the
card. Detection is a regex plus a model pass to link *the same quantity expressed differently*
("a tenth" / "10%").

**Data.** New pass: `{blockId, span, canonicalValue, unit}`.

**Risk.** Tabular figures in running prose look slightly wrong to a typographer — proportional
old-style figures are correct in body text. This is a deliberate trade; if it reads badly, keep the
dotted box and drop the figure change.

### 16. Density-Aware Leading

**What the reader sees.** Blocks the model rates as propositionally dense — many new terms, long
subordinate chains, high glossary hits per 100 words — get more line height (1.75 vs 1.55) and a
slightly narrower measure (58ch vs 68ch). Easy narrative passages get the tighter setting. The change
is per-block and small enough that most readers will not consciously notice it.

**Why it helps.** Optimal reading rate varies enormously with density, and self-paced readers
systematically *under*-adjust — they carry their narrative pace into the hard paragraph and come out
the other side having decoded without comprehending. Typography is one of the few levers that changes
pace below the level of conscious decision: shorter lines mean more return sweeps, more leading means
slower vertical progress. This is a desirable difficulty applied precisely where difficulty pays.

**Mechanism.** Per-block CSS custom properties `--leading` / `--measure` set from a density score;
`line-height: var(--leading); max-inline-size: var(--measure)`.

**Data.** Derivable now (glossary occurrences per word + `words` + sentence length from
`blocks.json`), or a one-field model pass.

**Risk.** Varying measure between adjacent paragraphs makes the right rag jump, which looks like a
layout bug. Vary leading freely; vary measure only at section boundaries.

### 17. Figure Contiguity

**What the reader sees.** When a figure's caption or the prose that discusses it is more than a
screen away from the figure, the figure becomes sticky within the discussing range — it parks in the
margin and stays there while you read the paragraphs about it, then releases.

**Why it helps.** The split-attention effect, straight from Sweller and Mayer: when text and the
graphic it refers to must be integrated but are spatially separated, the reader spends working memory
on the search-and-hold operation instead of on the integration. Spatial contiguity is one of the most
replicated findings in multimedia learning. Web articles violate it constantly because the figure was
placed by a CMS.

**Mechanism.** `position: sticky` inside a range wrapper; `float: inline-start` with
`shape-outside` where the margin is wide enough.

**Data.** `blocks.json` (`kind: media|caption`) + a pass linking figures to the block range that
discusses them.

**Risk.** Sticky figures on short viewports are claustrophobic; needs a height budget (≤30vh) and a
mobile fallback that does nothing.

---

## D. Making the reader do the work

### 18. Predict-the-Turn

**What the reader sees.** At three or four genuine pivots in the essay — the point where the author is
about to reverse direction — a slim band sits between paragraphs: *"He's about to turn. Which way?"*
with two one-line options and a *skip* affordance. Choosing either one reveals nothing except a tick
or a cross and unlocks the next paragraph's normal styling. The next paragraph was never hidden.

**Why it helps.** Prediction before an answer is the generation effect plus a prequestion, and the
error-then-feedback sequence produces better retention than reading the correct answer directly —
being wrong and finding out is more valuable than being right. It also converts a passive reader into
one holding a hypothesis, which is the state in which the following paragraph actually gets encoded
rather than skated.

**Mechanism.** Inserted `<aside>` between blocks; `<details name="predict">` for the exclusive
reveal without JS; view transition on the reveal.

**Data.** New pass: `{afterBlockId, question, optionA, optionB, correct, why}` — four per article, no
more.

**Risk.** Interruption. Three is a delight, ten is a quiz app, and the prequestion literature warns
that directing attention to targeted content can *reduce* learning of untargeted content. Keep them
about the argument's *direction*, never about a fact, and make skip one tap.

### 19. The Section Gate

**What the reader sees.** At the end of a section, before the next heading, a single-line field:
*"In your own words: what did that establish?"* — `field-sizing: content` so it grows as you type.
Typing anything (or pressing skip) reveals the generated heading, the section gist, and the arc
sentence, all of which were blurred until this moment. Your own sentence stays in the margin,
permanently, beside that section.

**Why it helps.** This is the highest-value item on the list by the evidence: free recall with
feedback is the strongest of the cheap interventions, comfortably above rereading and highlighting,
and self-explanation is close behind. It also fixes the calibration problem — the reader who cannot
produce a sentence discovers this *before* they have read another 3,000 words on top of a
misunderstanding. And it makes the summary artefacts we already generate into feedback rather than
substitute.

**Mechanism.** `<textarea field-sizing: content>` in the flow; unlock via the same `data-locked`
machinery as #1. Store in `comments.json` keyed to the range's first block id.

**Data.** `tree.json` + `summary.json` + `arc.json` for the reveal; reader text stored like a comment.

**Risk.** Friction is the whole point and also the whole danger — one gate per major section (5–6 in
this essay), never per subsection, and a persistent "stop asking" setting that we honour forever.
Expertise reversal is real: an expert reader gains little and is annoyed a lot.

### 20. Bridging Prompt, Not Bridging Answer

**What the reader sees.** Where the model detects an *unstated inferential step* between one paragraph
and the next — the author has assumed the reader will make a leap — a small `⌇` sits in the gutter at
the paragraph break. Clicking it asks: *"What has to be true for that to follow?"* with a text field.
Only after you answer (or press *show*) does the model's account of the missing step appear.

**Why it helps.** This is the direct application of the reverse-cohesion finding: gaps in a text are
where the good learning happens, for readers who can bridge them, and filling the gap for them
removes the benefit. So we mark the gap and prompt the inference rather than supplying it. Elaborative
interrogation — asking *why* — is one of the moderate-utility techniques in Dunlosky's review, and
unlike most of the list it costs nothing but a click.

**Mechanism.** Gutter marker with anchor positioning; `<details>` for progressive disclosure; the
model's answer sits inside a `[data-locked]` element until the reader commits.

**Data.** New pass: `{betweenBlockIds: [a, b], gapDescription, why}`.

**Risk.** The model will hallucinate gaps in perfectly cohesive prose, and a wrong "you missed
something" is corrosive to trust. Ship at most 5 per article, at high confidence, and give each an
"there is no gap here" dismissal that we record.

### 21. Highlight-Then-Compare

**What the reader sees.** The reader highlights whatever they think is load-bearing, as they read, in
the existing comments mechanism. At the end of a section only, a margin control offers: *"compare"*.
It shows what fraction of the model's load-bearing sentences you caught, marks the ones you missed
with a hollow orange bracket — and, importantly, shows the ones you marked that the model did not,
without calling them wrong.

**Why it helps.** The highlighting literature is blunt: highlighting has low utility, and
*pre*-highlighted text is worse than useless when the highlights are poor, because it narrows
attention and readers under-process everything unmarked. But highlighting done *by the learner* is at
least an act of selection and judgement, and pairing selection with delayed feedback converts it into
a discrimination task with a corrective signal — which is a different, better intervention. This is
the ordering that matters: reader first, model second, always.

**Mechanism.** Existing `comments.json` spans; comparison rendered with Custom Highlight ranges in two
styles (yours: solid; missed: hollow bracket via `border-block-end` on a highlight pseudo).

**Data.** `comments.json` + a load-bearing-sentence pass (or `summary.json`'s cited block ids as a
first approximation).

**Risk.** Scored reading feels like school and the model's list is not authoritative. Never show a
number as a percentage-correct; show it as "you and the model agreed on 6 of 9" and make the
disagreement the interesting part.

### 22. Read This One Aloud

**What the reader sees.** Exactly one paragraph per article — the thesis, or the pivot — gets a small
microphone affordance in the margin: *"say this one out loud."* The dictation machinery listens but
does not grade; when you have spoken to the end of the paragraph, the affordance turns solid orange
and never appears again in that article.

**Why it helps.** The production effect: words that are read aloud are remembered substantially better
than words read silently, and the effect is one of the more robust in memory research. It is also
the strongest possible guarantee that the reader has actually processed those particular sentences —
you cannot skim aloud. One paragraph per article is a rounding error in time cost for an outsized
encoding benefit at the one place that matters most.

**Mechanism.** Existing dictation (`docs/project/dictation.md`); no scoring, just a rough word-count
completion check. Toggle in reader profile.

**Data.** A pass to name the single most load-bearing paragraph; `summary.json` citations are a decent
proxy.

**Risk.** Nobody reads aloud on a train. This is a setting, off by default, and it must be socially
possible to ignore. Also flatly wrong for a reader with a speech difficulty — never gate anything on
completing it.

---

## E. The typographic substrate

### 23. The Emphasis Budget

**What the reader sees.** Nothing directly. It is a hard global rule: across any viewport, no more
than ~8% of visible glyphs may carry any non-default treatment (weight, size, tint, underline,
emphasis mark). Decorations declare a cost and compete; when the budget is exceeded, the
lowest-priority ones silently withdraw for that viewport.

**Why it helps.** Every decoration on this list is individually defensible and collectively lethal.
Emphasis works by contrast, and contrast is a zero-sum resource on a page — a page where 40% of the
text is marked has marked nothing. This is the single design rule that makes the rest of the list
shippable rather than a demo. It also gives us a measurable, testable property rather than a taste
judgement.

**Mechanism.** A layout pass over the intersecting blocks, counting decorated character ranges; a
priority order per decoration type; toggling `[data-suppressed]` classes. Runs on an
`IntersectionObserver`, not on scroll.

**Data.** None — it is a policy over everything else.

**Risk.** Decorations appearing and disappearing as you scroll is worse than too many decorations.
The suppression must be computed per *section*, applied once when the section enters, and never
re-computed mid-view.

### 24. Real Book Typography

**What the reader sees.** `text-wrap: pretty` on every paragraph (no orphans, no ladders of
hyphens), `hanging-punctuation: first last` so quotation marks hang into the margin and the left edge
is optically straight, `text-spacing-trim`, a measure fixed at 62–68 characters regardless of window
width, and old-style figures in body prose.

**Why it helps.** It is the floor, and doing it properly is worth more per unit of effort than
anything clever above it. Measure is the biggest single typographic lever on sustained reading: too
long and the return sweep lands on the wrong line, which produces a re-fixation and a lost place; too
short and the reader gets too many sweeps. `text-wrap: pretty` removes short last lines that
mis-signal a paragraph break.

**Mechanism.** Exactly the CSS named. All of it is a stylesheet edit with no data and no JS.

**Data.** None.

**Risk.** Almost none, which is why it should ship first, before anything on this list is
prototyped — otherwise every later evaluation is measured against a bad baseline.

### 25. Comment Cards That Do Not Reflow

**What the reader sees.** A reader's note sits in the margin exactly beside its anchored span, on the
same baseline, and stays there as the window resizes. Two notes near each other push apart rather than
overlapping. Nothing in the prose column moves when a note opens.

**Why it helps.** Spatial contiguity again — a note about a sentence should be *beside* that sentence,
not in a panel elsewhere, or the reader pays a search cost every time. And any decoration that reflows
the prose column destroys the reader's spatial memory of the page, which is a real and
under-appreciated navigation aid on long documents; people remember *where* on the page a thing was.

**Mechanism.** `popover` + CSS anchor positioning (`anchor-name`/`position-anchor`,
`position-try-fallbacks`), so the browser does the collision handling. Zero JS positioning.

**Data.** `comments.json`.

**Risk.** Anchor positioning has no graceful degradation in older engines; needs a `@supports`
fallback to an inline `<details>` under the block.

---

## F. Decorations that respond to how you are reading

### 26. Skim Conscience

**What the reader sees.** When scroll velocity exceeds any plausible reading rate for more than about
four seconds, the decorations fade out — the glyph column, the tints, the emphasis marks all go — and
the page becomes plain prose on plain background. Slow down and they come back over half a second.
The text is never touched.

**Why it helps.** It is the second principle made mechanical. Our decorations are the thing that could
be consumed instead of the article; so when someone is plainly not reading, the decorations refuse to
be a substitute for it. The behavioural read is also honest feedback — the fade is a legible signal
that *this app noticed you are not reading*, which is a gentler and more effective nudge than a modal.

**Mechanism.** Scroll-velocity estimate on a `requestAnimationFrame` sampler; a body-level class with
a CSS transition on a single `--decoration-opacity` custom property that every decoration inherits.

**Data.** None.

**Risk.** Scanning for something specific is a legitimate reading mode and this punishes it. Needs a
"find" mode where decorations stay, and it must never fade the article's own text. If the heuristic
misfires it will feel possessed.

### 27. Regression Heat

**What the reader sees.** When the reader scrolls back up to a passage and dwells there, that block
quietly acquires a thin orange notch in the gutter. After a long read there might be a dozen. They are
not a score; they are a map of where you struggled.

**Why it helps.** Regressions are the reader's own signal of comprehension failure, and they are
completely invisible after the fact — nobody remembers which four paragraphs they went back to. Making
that record durable turns it into a re-reading plan that is *derived from the reader's own behaviour*
rather than from a model's guess about difficulty, which sidesteps the entire "the model decided this
was important" trust problem.

**Mechanism.** Track viewport-block dwell and reversals; write to `localStorage` per article.
`::before` notch in the gutter.

**Data.** New per-reader store; nothing model-generated.

**Risk.** Surveillance-adjacent, and it must be local-only and visibly so. Scroll direction is a
noisy proxy for regression at the eye-movement scale — this only catches paragraph-scale ones, which
is fine, but do not claim more.

### 28. The Return Chip

**What the reader sees.** Following any of our links — a glossary card, an idea occurrence, a
number's other appearance — leaves a small orange chip pinned at the edge of the viewport: *back to
where you were*. One tap returns you, with a brief view transition, and the sentence you left is
briefly highlighted so you can re-enter mid-paragraph.

**Why it helps.** The cost of interrogation is mostly navigation. A reader who suspects the author is
being slippery, and who knows that checking will cost them their place, will not check. Making the
return free — and, critically, restoring the *exact sentence*, not the scroll position — is what makes
interrogation a habit rather than an occasional heroic act.

**Mechanism.** `::target-text` or a Custom Highlight for the re-entry sentence; `view-transition-name`
on the prose column so the jump reads as motion rather than teleportation; a small position stack.

**Data.** None.

**Risk.** Chips that accumulate. Depth of one; a second jump replaces the chip rather than stacking.

### 29. Inverted Palimpsest

**What the reader sees.** On a *second* visit, the article renders with your first-read dwell map
inverted: the blocks you lingered on are dimmed to 60%, and the blocks you sped past are at full ink.
The page shows you what you have not yet actually read.

**Why it helps.** Re-reading is a low-utility strategy chiefly because people re-read what they
already know — it is fluent, it feels productive, and it teaches nothing. Directing the second pass to
the parts that got the least attention converts a wasted re-read into something closer to spaced
retrieval on the material that actually needs it, and it does so with no model judgement at all.

**Mechanism.** Per-block dwell from #27; `opacity` on second-session render, with a control to flip
back to plain.

**Data.** Reader dwell store.

**Risk.** Dwell is not comprehension — a reader can stall on a paragraph because their tea arrived.
Needs a low ceiling on the dimming (never below 60%) and an obvious off switch.

### 30. The Dropped Stitch

**What the reader sees.** At the end of the article, above anything else: three blocks, verbatim, that
the reader passed at the highest speed *and* which `ideas.json` says the argument leans on. Not a
summary — the author's own paragraphs, again, in full, with one line saying why each matters to the
case.

**Why it helps.** It is a re-read recommendation with a reason, targeted by the intersection of two
independent signals — the reader's behaviour and the argument's structure. And it ends the session
with prose rather than with our summary, which is the correct last impression for a product whose
thesis is that the words are the point.

**Mechanism.** Rendered at the article foot; blocks re-rendered by id from `blocks.json`.

**Data.** dwell store + `ideas.json` dependency data (#10).

**Risk.** Shows the reader they read badly, at the moment they felt finished. Tone is everything;
frame as "worth another look", never as a failure report.

---

## G. Cheaper wins worth listing

### 31. Callback Margin

A key sentence from 3,000 words earlier reappears, faint and small, in the margin at the exact
paragraph that depends on it again. **Why:** reinstating a distant premise at the moment of use is the
spacing effect and situation-model repair in one move; the reader would otherwise have to trust their
memory of it or lose 90 seconds scrolling. **Mechanism:** sticky margin element scoped to the
dependent block range; the callback is the *author's* words, not ours, so it cannot be a substitute.
**Data:** the dependency pass from #10. **Risk:** re-showing text the reader just read reads as a bug
(hence the ≥1,500-word minimum distance).

### 32. Unbidden First Definition

The first time a glossary term with `difficulty > 0.6` appears, its one-line background note appears
in the margin automatically and stays for that screen only — no hover required. Later occurrences
behave as today. **Why:** hover cards are only used by readers who already suspect they do not know
the word, and the ones who most need the definition are least likely to ask. Front-loading the cost at
first encounter is where it does the most good. **Data:** `glossary.json` `difficulty`/`centrality`.
**Risk:** noisy in the opening 500 words where terms cluster; cap at three per screen.

### 33. Underline Budget

Glossary underlining is gated by the reader's profile and the term's `difficulty`, so an expert sees
four underlines and a newcomer sees fourteen — rather than everyone seeing all nineteen. **Why:**
expertise reversal — scaffolding that helps a novice measurably impairs an expert, who now processes
redundant cues. It is also just density control. **Data:** `glossary.json` + `reader-profile.md`.
**Risk:** a reader who cannot see why the underline is missing; needs a visible "show all terms"
toggle.

### 34. Quote Provenance

Where the essay quotes or cites a person, a margin line gives who they are and their stance in the
debate — revealed after the quote is read, per #1. **Why:** in a piece that steelmans an opposing
camp, readers routinely lose whose view a quotation represents; the fix is a name and a side, not a
paraphrase. **Data:** `glossary.json` (`kind: person`) + a citation pass. **Risk:** compresses a
person's position into six words, which is a real distortion; keep it to affiliation and role.

### 35. Structure Sketch, Drawn As You Go

A small SVG in the margin that *accretes* — one node per section as you pass it, edges appearing when
the model says a section supports another. At the start it is empty; at the end it is the argument.
**Why:** an argument diagram shown up-front is a substitute for reading and a seductive detail; the
same diagram *built by your own progress* is a record of what you have read and a retrieval cue for
it. The difference between the two is entirely the timing. **Mechanism:** inline SVG, nodes revealed
with `animation-timeline: view()`. **Data:** `tree.json` + an inter-section support pass. **Risk:**
the strongest seductive-details hazard here; keep it small, monochrome, and unclickable during first
read.

---

## Top 5, ranked

1. **The Section Gate (#19)** — free recall with feedback is the best-evidenced cheap intervention in
   the whole literature, and it turns our existing summaries from a substitute for reading into the
   answer key that follows the attempt.
2. **Read-First Ink (#1)** — one policy that structurally prevents the entire failure mode the brief
   is worried about; everything else on the list gets safer once it exists.
3. **Whose Voice Is This (#6)** — the specific comprehension error this essay invites (mistaking the
   steelman for the thesis) is one perception can prevent and no amount of re-reading reliably does.
4. **The Arc Rail (#2)** — one always-visible sentence about the argument's *position*, not its
   content, is the cheapest possible external store for the representation that decays fastest.
5. **The Emphasis Budget (#23)** — unglamorous, and the reason a page carrying six of these ideas at
   once is still readable rather than a ransom note.

## Left-field

**Read This One Aloud (#22).** One paragraph per article gets a microphone in the margin and asks you
to say it out loud; the app listens but does not grade, and then never asks again. It is faintly
absurd in a serious reading tool and impossible on a train.

But the production effect is among the more robust memory findings, and speaking a paragraph is the
only decoration on this list that makes skimming it *physically impossible* — the guarantee every
other idea here can only approximate.

---

## Decorations that would probably backfire

These are the tempting ones. Each has evidence against it.

**Pre-highlighted key sentences.** The obvious first feature, and the worst. Highlighting rates as low
utility in Dunlosky's review even when the learner does it; when it is done *for* the reader it is
worse, because attention narrows onto the marked text and incidental learning of everything unmarked
drops. Poor-quality highlights are actively harmful — and our highlights will be model-quality, not
author-quality, which means confidently wrong somewhere in every article. It also produces the
signature illusion of fluency: the reader who read the highlights feels they read the piece.
*If we do it at all, do it after the reader has highlighted (#21), never before.*

**Making unimportant sentences smaller or fainter.** Greg names this explicitly, and it is the one
suggestion in the brief I would push back on. Three problems. (a) It encodes a model's importance
judgement that the reader cannot audit, at the exact moment they are least able to check it — before
they have read the sentence. (b) It is de-facto deletion: text at 40% opacity in a dark theme is text
most people will not read, so the hard constraint about not removing words is satisfied on paper and
violated in effect. (c) Varying type size *within a line* disrupts saccade targeting — saccade length
is planned from coarse word-boundary information, and mixed x-heights make landing positions less
predictable, producing more re-fixations. Vary *leading between blocks* (#16) instead of size within
lines, and vary it by **density**, which is a property of the text, rather than by **importance**,
which is a claim about it.

**Bionic-reading / fixation bolding.** Bolding the first half of every word has no peer-reviewed
support; the controlled studies that exist find no comprehension benefit and in some cases slightly
slower reading. It also spends the entire emphasis budget on a treatment that carries zero
information about *this* text.

**RSVP or any speed-read mode.** Presenting words one at a time removes both parafoveal preview and
regressions. Those are not inefficiencies — preview is where a large share of lexical processing
happens, and regressions are how readers repair misparses. Speed reading trades comprehension for
rate, and the trade gets worse as the text gets harder, which is precisely our case.

**A margin label beside every block.** We have `labels.json` for all 141 blocks and it is very
tempting to print them. Don't: it creates a second, complete, faster-to-read article running down the
margin, which is the definition of a way of not reading, and it is a textbook redundancy-principle
violation. Labels are excellent as *search index, hover target, and section-end feedback* — not as
continuous marginalia.

**Summaries or gists placed above their text.** A summary before a passage tells the reader the
conclusion, at which point reading the passage feels like confirmation rather than construction, and
many will skip it. Same artefact, placed after, is retrieval feedback. Position is doing all the work.

**Disfluent fonts as a desirable difficulty.** The famous result (harder-to-read fonts improve
retention) failed to replicate in large samples. Do not deliberately degrade legibility. Desirable
difficulties should be *task* difficulties — generate, retrieve, predict — not perceptual ones.

**Auto-generated diagrams everywhere, and pull quotes duplicating adjacent prose.** Both are seductive
details: interesting additions that compete for attention with the material they illustrate and
measurably reduce learning of it. A pull quote of a sentence 40 words below is worse than neutral — it
makes the reader feel they have already read the paragraph. If a pull quote appears, it should carry a
sentence from a *different* part of the piece, and only under Read-First Ink.

**Prequestions on everything.** Questions before a section do improve learning of what they target —
and can reduce learning of what they do not. Three or four per article that are about the argument's
*direction* (#18) are safe; a question per section that is about facts will systematically hollow out
everything unasked.

**Any always-on scaffold.** Expertise reversal: aids that help a novice reliably impair an expert,
who must now process a redundant cue. Every decoration here needs a profile gate or a global off
switch, and the off switch has to be remembered.

---

**Total: 35 ideas.**
