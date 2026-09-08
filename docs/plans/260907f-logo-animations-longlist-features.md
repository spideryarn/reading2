# Logo animations longlist — one animation per feature

One of eight longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md); read that first for the mark,
the DOM and the constraints. **The framing given to this one was: generate one animation per
feature — the wordmark performing, in miniature, the thing the app actually does.** Treat the ten
letters as a stand-in for a passage of prose and the spider as the tool working on it. A reader who
already uses the glossary should recognise the glossary's own gesture; a reader who has never opened
it has been shown a feature exists. The discipline the framing imposes is that these must be
*different kinds of motion*, not ten sweeps in ten colours — so each entry below was written after
reading the feature's doc closely enough to find its actual signature gesture, and each says which
doc it came from. Where the real interaction has a detail that makes the animation better than the
obvious version, the entry says so and cites it.

## Notes that apply to most of them

- **Letter indices.** `.logo-letter:nth-child(n)` for n = 1…10 is `S p i d e r y a r n`, and works
  identically under `.logo-text` and `.dock-btn-label` because the ten spans are the only children
  of either. Never select on `.logo-text`.
- **`display: inline-block`** on `.logo-letter` is a prerequisite for every idea below that uses
  `transform`. Setting it on the animation class only, not globally, keeps the resting DOM untouched.
- **A registered custom property** (`@property --x { syntax: "<number>"; inherits: true;
  initial-value: 0 }`) is what makes several of these possible in pure CSS: animate one number on
  `.logo:hover`, and each letter reads it through a `calc()` with its own signed constant. Where it
  is unsupported the number does not animate, every letter sits at the initial value, and the
  resting state is the untouched wordmark — which is the correct degradation and also the correct
  single frame under `prefers-reduced-motion`.
- **Every idea below rests at identity.** The one frame the motion guard leaves you is the wordmark
  as drawn.

---

## 1. Held Centre

**From:** [granularity-zoom.md](../project/granularity-zoom.md) — the core feature.

**What the reader sees.** The word breathes: the letters slide inwards towards `e` until they are
almost touching, hold for a beat, and expand back out past their rest position before settling. The
`e` itself never moves a pixel — everything moves *around* it, and your eye has nothing to chase.

**Why it belongs.** This is the one feature the app is for, and its whole promise is text expanding
and contracting under you without your losing your place.

**Mechanism.** `@property --zoom` (number, inherits, initial 0), animated 0 → 1 → 0 on `.logo:hover`
over ~2.4s with an ease-in-out. Each letter carries a signed constant `--d` (S = −4.5, p = −3.5, …
e = 0, … n = +5) set by ten `nth-child` rules, and has
`transform: translateX(calc(var(--d) * var(--zoom) * -0.9px))` plus
`opacity: calc(1 - var(--zoom) * 0.25)` scaled by `abs(var(--d))` if you want the periphery to fade
as it compresses. Nothing changes width, so the dock's flex row does not reflow.

**Why this beats the obvious version.** The obvious version scales the whole wordmark down and up.
That is a zoom of the *viewport*, and the feature is explicitly not that:
[§ Interaction](../project/granularity-zoom.md#interaction) says position is a block id, the client
finds the node containing the anchor, and *"the reader's eye stays put while the text breathes
around it."* The fixed `e` is the anchor invariant, drawn.

**Cost:** Medium — ten `nth-child` constants, one registered property, one keyframe.

**Risk:** At 0.82rem the letters are ~5px apart, so 0.9px per unit of distance either does nothing
visible or crushes the outer letters into each other. Needs tuning against the real font before you
know which.

---

## 2. Three Tiers

**From:** [column-context.md](../project/column-context.md).

**What the reader sees.** One letter at a time is bright and full weight; its two neighbours are
noticeably dimmer, and everything beyond them is dimmer again — three flat levels, with no gradient
between them. The bright band travels slowly along the word on its own clock, gliding between
letters rather than jumping, and it keeps going whether or not you move the mouse.

**Why it belongs.** Every coarse column in the reading view is drawn exactly like this: the whole
level listed, the current item held on the focus line, the rest as landmarks.

**Mechanism.** One keyframe per tier reached through a shared animation with
`animation-delay: calc(var(--i) * 240ms)` on each letter (`--i` from `nth-child`). The keyframe is
*plateaued* rather than sinusoidal — `0%, 8% { opacity: 1 } 12%, 100% { opacity: .45 }` for the
focus, with a second, offset animation supplying the middle tier — so what you see steps rather than
ramps. Colour comes from `--ink` at three alphas, or from `--ink` → `--rule`.

**Why this beats the obvious version.** The obvious version is a smooth falloff either side of a
travelling point, which is the classic fisheye. The doc rules that out with evidence:
[§ What the research said](../project/column-context.md#what-the-research-said) — *"Discrete tiers,
never a gradient … sentences hit a just-legible / illegible dead zone"*, and Hornbæk & Hertzum's
finding that people barely look at a shrunk periphery at all. The same section says **focus follows
the scroll, never the pointer**, which is why this one must run on a timer and ignore where the
mouse is inside the control.

**Cost:** Medium.

**Risk:** Three opacity levels on 0.82rem text at two theme polarities is a narrow target — get the
tiers wrong and it reads as a text-rendering fault rather than a hierarchy.

---

## 3. Underlined, Then One

**From:** [glossary.md](../project/glossary.md).

**What the reader sees.** Underlines grow out from left to right beneath four of the ten letters,
one after another — two of them solid, two dotted. Then the threshold tightens: three of the four
retract, and a single letter is left underlined, alone, before they all come back.

**Why it belongs.** The glossary underlines its terms in the prose in every mode, and its one
control is a threshold that narrows the list down to the costliest term.

**Mechanism.** `.logo-letter::after` — absolutely positioned, `left: 0; right: 0; bottom: -2px;
height: 1px`, `background: currentColor` or `--highlight`, `transform: scaleX(0)` with
`transform-origin: left`. Chosen letters (say 3, 4, 6, 9) animate `scaleX` 0 → 1 with staggered
delays over the first third of the cycle; a second stage returns three of them to 0 and holds the
fourth. Dotted is `background-image: repeating-linear-gradient(90deg, currentColor 0 1px,
transparent 1px 3px)` on the same bar.

**Why this beats the obvious version.** The obvious version underlines every letter at once. The
doc's provenance treatment is the better idea and it costs nothing extra: the **solid** left rule
means *this came from the article*, the **dotted** one means *this is what the model knows* — two
classes drawn differently on purpose, and reused across Ideas and Quotes rather than re-declared. So
mixing solid and dotted underlines here is not decoration, it is the same distinction the reader
will meet in three panels.

**Cost:** Medium.

**Risk:** A 1px bar under 0.82rem text may render as a smudge on a non-retina display, and a
half-underlined wordmark is one visual step from a broken hyperlink.

---

## 4. Two Passes

**From:** [search.md](../project/search.md).

**What the reader sees.** A tint sweeps across the word and stops hard on four *adjacent* letters —
crisp, uniform, instantly. It clears; then a second pass lights up three letters that are nowhere
near each other, each at a different strength, and lingers.

**Why it belongs.** Search is two matchers behind one box, and the whole point is that they answer
different questions and disagree about where the answer is.

**Mechanism.** A single absolutely-positioned `.logo::before` overlay tinted with `--highlight` at
low alpha, revealed by `clip-path: inset(0 X% 0 Y%)` keyframes for the literal pass — a hard,
linear, ~200ms reveal. The semantic pass is per-letter instead: `.logo-letter` gets a
`background-color` in `color-mix(in srgb, var(--highlight) N%, transparent)` where N differs per
letter (say 92, 61, 44) and fades in over ~600ms with easing. The differing alphas *are* the
confidence numbers.

**Why this beats the obvious version.** The obvious version is one highlight sweep, which is what
the previous version already had. The interesting thing in the doc is the contrast between the two
columns of [§ The one decision](../project/search.md#the-one-decision-everything-else-follows-from):
literal runs in the browser on every keystroke and costs nothing; meaning takes 15–40 seconds, costs
money, and comes back with *a confidence and one line of reasoning*. The animation should feel like
those two things — one snaps, one arrives — and the second pass landing on different letters is the
honest bit.

**Cost:** Medium.

**Risk:** A two-stage 3–4s cycle with a pause in the middle reads as "still loading" on the first
hover.

---

## 5. Marked For Keeping

**From:** [quotes.md](../project/quotes.md).

**What the reader sees.** A short vertical rule appears hard against the left edge of `pide`, a soft
wash fills in behind those four letters, and the six letters around them dim back. It holds — this
is a thing being kept, not a thing passing through — and then releases.

**Why it belongs.** Quotes is the one mode whose list is the article's own sentences rather than
something a model wrote about it, and a marked quote *stays* marked in the prose.

**Mechanism.** `.logo::before` is the 1.5px left rule (`background: var(--highlight)`, positioned by
`left` in `em` so it lands at the right letter boundary), `.logo::after` is the wash, both revealed
with `transform: scaleY(0) → 1` and `opacity`. The non-quoted letters take
`opacity: .55` via a rule on `.logo-letter` that the run's own `nth-child` overrides. Both
pseudo-elements are absolutely positioned so nothing reflows.

**Why this beats the obvious version.** Because the marks should be *the same marks*. The doc is
explicit that the wash and the `┃` border here are what a search hit draws, *"because it IS one"* —
so this animation and **Two Passes** above should share one set of CSS custom properties, and a
reader who sees both learns that the mark means one thing. That is a product fact the animation can
carry for free.

**Cost:** Medium.

**Risk:** A four-letter run inside a 120px control is about 22px wide; the rule and the wash may end
up bigger than the thing they are marking.

---

## 6. The Unstated One

**From:** [ideas.md](../project/ideas.md).

**What the reader sees.** The word is complete, then one letter — the `d` — quietly drains to almost
nothing while its space stays exactly where it was. After a beat it comes back, but marked: dimmer
than its neighbours, with a dotted rule beneath it. Then it rejoins the word.

**Why it belongs.** Ideas is about the propositions a piece leans on and never states — the thing
that is load-bearing precisely because it is not on the page.

**Mechanism.** `.logo-letter:nth-child(4)` only: `opacity` 1 → 0.08 → 1 over ~2s, with a
`::after` dotted 1px rule fading in on the return leg. Everything else is untouched, which is what
makes it read as a statement about that letter rather than as an effect. Twelve lines.

**Why this beats the obvious version.** The obvious version removes the letter and closes the gap,
which would both reflow the dock's flex row and, worse, say the wrong thing. The doc's heading over
the passages is the whole design: *"An assumed idea is BY DEFINITION not in the article"* — the
space it occupies is real even though the statement is absent. Keeping the gap and emptying it is
that sentence.

**Cost:** Easy.

**Risk:** A wordmark briefly missing a letter reads as a font-loading bug, not as a feature, and the
brand is the thing being animated. This may be the idea that is right in principle and wrong on the
logo.

---

## 7. Said Back

**From:** [remember-mode.md](../project/remember-mode.md).

**What the reader sees.** The whole word fades down to a faint ghost, as if being recalled rather
than read. The letters come back one at a time in a scattered order — not left to right — and three
of them arrive slightly off: a degree of rotation, half a pixel low. Those three are nudged straight,
and a small mark appears under each of them.

**Why it belongs.** Remember runs the other way round from everything else: the reader says what
they took from the piece, and the model shows them where their account and the article come apart.

**Mechanism.** All ten letters to `opacity: .18` in the first 15% of the cycle, then per-letter
`opacity` restores at hand-picked (not monotonic) `animation-delay`s. Three letters get a second
keyframe track adding `rotate(1.5deg) translateY(.5px)` that resolves to identity, and a
`::after` tick or short rule fading in beneath them.

**Why this beats the obvious version.** The obvious version is a fade-in. What makes this Remember
rather than a page load is (a) the word going *away first* — recall precedes correction, and the
doc's diagram of the two directions is exactly that — and (b) marking **three** letters, not all
ten. The Signposts stance returns *"three or four passages worth re-reading, ids and a few words
each. Nothing else"*, and Balanced is per-point triage rather than a blanket treatment: this mode
never corrects everything at once.

**Cost:** Medium.

**Risk:** Ghosting the whole wordmark to 18% for a beat, in the corner of a page, looks like the CSS
failed to load. The recovery has to be fast enough that nobody sees the ghost as a state.

---

## 8. Asking Back

**From:** [quiz.md](../project/quiz.md).

**What the reader sees.** One letter lifts a pixel and brightens — and then nothing happens, for
almost a second. It settles; the next one lifts, waits, settles. The order is not left to right, and
the pauses get slightly longer as it goes.

**Why it belongs.** Quiz is the article asking the reader, one question at a time, and a question is
mostly the silence after it.

**Mechanism.** One shared keyframe with a long plateau —
`0% { } 12% { transform: translateY(-1.5px); color: var(--highlight) } 52% { transform:
translateY(-1.5px) } 62%, 100% { }` — applied to each letter with a hand-authored delay sequence
rather than `calc(var(--i) * …)`, so the order is chosen. `animation-duration` grows slightly down
the sequence.

**Why this beats the obvious version.** The wait is the idea, and it is the only animation in this
set that contains genuine stillness. The ordering detail is worth taking from the doc too:
[§ The order](../project/quiz.md#the-order-and-why-it-is-not-ease-value) is lexicographic —
band (`easy` → `medium` → `hard`), *then* value — and blending the two was the bug a review caught,
because the blend opens with the hardest question in the batch. So the visual order here should
start with the letters that are cheapest to look at and end with the awkward ones, not run in DOM
order.

**Cost:** Easy–Medium.

**Risk:** A hover flourish that is stationary for 40% of its cycle looks broken rather than patient,
especially on the first ~300ms of hover when the reader has no idea a loop is running.

---

## 9. Undated Stay Put

**From:** [timeline.md](../project/timeline.md).

**What the reader sees.** Six of the ten letters slide out of order and back into a *different*
order, resorting themselves. Four of them do not move at all: they dim, and a small em dash appears
beneath each. Then the six slide back and the word is itself again.

**Why it belongs.** Timeline is the article's claims about time, straightened out — and on the test
article ten of the twenty-six rows carry no date at all, which the panel refuses to hide.

**Mechanism.** Per-letter `translateX` to a hardcoded permutation (chosen so no two letters ever
occupy the same x during the transit), animated with a settling ease; the four static letters take
`opacity: .45` and a `::after` em dash. Everything is `transform`, so the box never changes.

**Why this beats the obvious version.** The obvious version sorts all ten. The doc's whole design is
the four dating states, and the pair most easily collapsed is `words` and `untimed` — collapsing
them *"is the one mistake that throws away something the article said"*, because a piece that wrote
"another month later" has dated the event as far as it ever will. An animation where everything
resorts claims we always know; an animation where four letters visibly decline to move is the
feature.

**Cost:** Medium–Hard — the permutation has to be authored so the transit reads as sorting and not
as collision.

**Risk:** The biggest in the set. A reordered wordmark is a *misspelled* wordmark, and if the
animation is interrupted at the wrong moment — pointer leaves, tab backgrounds, a repaint — the
brand is on screen scrambled. It rests at identity, so `prefers-reduced-motion` is safe, but the
mid-flight frames are not something to be casual about.

---

## 10. Yours Now

**From:** [comments.md](../project/comments.md).

**What the reader sees.** A selection tint drags across four letters at the speed of a hand — quick
at first, decelerating, stopping abruptly rather than easing out. It stays. A small bookmark tick
appears at the end of the run, and beside it an empty tick-box that is never ticked.

**Why it belongs.** Select a sentence and it is yours: bookmarked, free, and the model is an option
you did not take.

**Mechanism.** `.logo::before` as a tinted overlay (`--highlight` at ~18%), revealed by
`clip-path: inset(0 var(--c) 0 22%)` with `--c` animated from 100% to 45% on a
`cubic-bezier(.2,.8,.35,1)` — the deceleration is the hand. `.logo::after` is the tick, scaling in
after the drag lands. The tick-box is a 4px outlined square drawn in the same pseudo-element's
`box-shadow` and left empty.

**Why this beats the obvious version.** Two details from the doc. The **easing** — a selection is
made by a person, so a linear sweep is wrong and a symmetrical ease is wrong; drags decelerate and
stop. And the **unticked box**, which is the feature's whole 2026-08-28 reversal: *"a comment is now
the free thing and the model is a tick-box."* An animation that ended with a model response would be
animating the version that was removed.

**Cost:** Easy–Medium.

**Risk:** A tint filling a fixed-width control left to right is a progress bar, and everyone reads it
as one. The abrupt stop at 45% rather than 100% is the only thing preventing that, and it has to be
unmistakable.

---

## 11. Where It Goes

**From:** [links.md](../project/links.md).

**What the reader sees.** One letter takes on the link colour and lifts very slightly, as though
being hovered. A faint shimmer crosses it once — something is being fetched — and then it settles
with *two* marks beneath it: a solid rule and a dotted one. Nothing else in the word moves at all.

**Why it belongs.** Hovering a link in the prose gets you a card about where it goes, and hovering a
glossary term gets you a card too — and sometimes they are the same word.

**Mechanism.** A single `nth-child` letter: `color: var(--highlight)`,
`transform: translateY(-1px)`, and a one-shot shimmer via a `background:
linear-gradient(...)` clipped to the text with `background-clip: text` and an animated
`background-position`. The two rules are the `::after` bar from idea 3, drawn twice at 1px offsets
(one solid, one dotted).

**Why this beats the obvious version.** The two marks. `links.md` §
[Two things over one phrase](../project/links.md#two-things-over-one-phrase) measured it: **13% of
the links in this corpus have a glossary term as their link text**, which is why `ProseHoverCard` is
one component and not two. A letter wearing both marks at once is that measurement, and it is
also the only idea here that says two features meet.

**Cost:** Easy.

**Risk:** The shimmer is a spinner, and a spinner inside a logo says the *page* is loading. It has
to run once and never again within the loop.

---

## 12. Quiet Meter

**From:** [live-conversation.md](../project/live-conversation.md).

**What the reader sees.** The letters bob on their baselines — unevenly, in bursts, never in step
with each other, at most a pixel and a half. Then, in the middle of the loop, everything goes still
for most of a second, and starts again.

**Why it belongs.** Live is a spoken conversation with the article, and the level meter reads the
real microphone track rather than an idea of one.

**Mechanism.** Ten letters, `translateY` keyframes, but with **co-prime durations** (1.03s, 1.37s,
0.89s, 1.61s…) so they never phase-lock into a wave, plus a shared `.logo` animation that scales the
whole thing to zero amplitude for one stretch of a longer outer cycle (an `@property --gain` number
multiplied into each letter's translate).

**Why this beats the obvious version.** The obvious version is a sine wave down the word, which
reads as decoration. Speech is bursty and has pauses in it, and the doc's own honesty note is the
thing to animate: *"A quiet meter is an observation, not a claim that the reader's microphone is
broken."* The silence in the middle of the loop is the whole difference between a level meter and a
bouncing logo.

**Cost:** Easy–Medium.

**Risk:** This is the single most likely idea in the set to look cheap. Above about 2px of amplitude
it is a 2007 marquee. It also fights every other animation for the same vertical room the control
does not have.

---

## 13. Filament Chain

**From:** [diagram.md](../project/diagram.md).

**What the reader sees.** A single hair-thin thread reaches out of the spider's body, touches a
letter, and stops. A second thread reaches to a different letter while the first fades; a third
follows. What is left for a moment is a faint chain you can follow — and then it lets go.

**Why it belongs.** Diagram is the article's shape as a picture, and the mark is a spider made of
yarn; this is the only idea here that uses the image rather than the letters.

**Mechanism.** `.logo-image` gets a sibling `::before` on `.logo`, absolutely positioned with its
`transform-origin` at the spider's centre: a 1px `background: var(--rule)` bar animated with
`rotate()` and `scaleX()` to reach three targets in turn, `opacity` decaying behind it. **Or**, if
we want the legs themselves to move, propose the SVG trace the brief invites — that unlocks
`stroke-dasharray` self-drawing and per-leg motion, at the cost of a tracing pass and a second copy
of the mark to keep in sync.

**Why this beats the obvious version.** The obvious version scatters the letters into a force graph,
which needs JS, moves layout and looks like nothing at 44px tall. The doc's own rule is the reason to
draw a chain instead: two of the three computed pictures keep document order down the page and
**Trail is the deliberate exception**, spending both axes on meaning — and what replaces the rule
there is *"the chain: reading order is still in the picture, as a line you can follow rather than as
a direction you can assume."* One filament touching letters in order is that chain.

**Cost:** Medium as a pseudo-element; Hard if it becomes an SVG trace.

**Risk:** A 1px diagonal line crossing a 20px logo reads as a rendering artefact or a stray border,
not as a graph. It may need to be two pixels and orange before it reads as thread at all — and then
it is heavy.

---

## 14. Splits Into Parts

**From:** [hierarchy.md](../project/hierarchy.md) and
[granularity-zoom.md § The tree](../project/granularity-zoom.md#the-tree).

**What the reader sees.** A single rule runs the full width beneath the word. It breaks cleanly into
three segments with hairline gaps; each of those breaks again into two or three; and then it heals
back into one. Nothing overlaps and nothing is left over — the segments always exactly fill the line.

**Why it belongs.** The one structure under everything: a deeply nested table of contents where a
node's children exactly partition its range.

**Mechanism.** One absolutely-positioned `.logo::after` bar whose `background` is a
`repeating-linear-gradient` with hard stops, and an `@property --gap` (length) animated 0 → 1.5px →
0 in two stages with different stop counts. The partition is enforced by construction, because a
gradient's stops cannot overlap or leave a hole. Two levels of subdivision, not three.

**Why this beats the obvious version.** The obvious version brackets the letters into groups with
curly braces or draws a little tree, neither of which survives 120×44px. The invariant is the thing
worth animating, and the doc says why it is load-bearing: *"every node covers a contiguous range of
blocks, and a node's children exactly partition its range — no gaps, no overlaps, no reordering …
That invariant is the whole trick."* A gradient literally cannot violate it, which is a pleasing
match between the mechanism and the meaning.

**Cost:** Medium.

**Risk:** Two levels of subdivision across 120px is nine segments of about 13px, and a third level
would be invisible — so the animation is shallower than the structure it depicts, and someone will
want to add the third level.

---

## 15. Neither Way

**From:** [referee-mode.md](../project/referee-mode.md) and
[comments.md § the referee's own placement](../project/comments.md#the-referees-own-placement).

**What the reader sees.** A faint line appears under the word with a small notch at its centre. The
letters drift a little way off — some left of the notch, some right, by different distances. One
letter moves to the notch and sits exactly on it. They all return.

**Why it belongs.** Referee mode helps a peer reviewer place a passage on a criterion with two ends,
without handing them a verdict.

**Mechanism.** `.logo::after` is the scale — a 1px `--rule` line with a `--ink` notch drawn as a
`background-image` centre stop. Letters take small signed `translateX` values (±0.5 to ±2px) with
staggered delays, one of them explicitly to 0. Nothing changes width.

**Why this beats the obvious version.** The letter that lands on zero *and stays there*. The doc is
firm that valence is signed −100…+100 and **`0` is a real answer meaning "counts neither way"** —
and that an out-of-range value is a 400 rather than a clamp. An animation where every letter takes a
side would be the version that treats "no opinion" as missing data, which is the thing the feature
refuses to do.

**Cost:** Medium.

**Risk:** Any horizontal drift of letters in a wordmark reads as bad kerning, and readers who cannot
name what is wrong will still feel it. The drift has to be far enough to be a *position* rather than
a wobble.

---

## 16. From Raw

**From:** [architecture.md § Pipeline](../project/architecture.md#pipeline) — the whole ingest, in
four beats.

**What the reader sees.** The word arrives wrong: letters at uneven weights and slight tilts, a
couple of them washed out — raw HTML. Then it straightens, all at once, into an even line. Then a
faint tick passes under each letter left to right, one by one. Then the rule of idea 14 appears
beneath, subdivides once, and the whole thing rests.

**Why it belongs.** It is what actually happens when you paste a URL: fetch, extract, block, tree.

**Mechanism.** Four sequential stages in one keyframe timeline (~4.5s), each a different property —
stage 1 is `rotate`/`opacity` noise, stage 2 is those resolving to identity together, stage 3 is a
per-letter `::after` tick with `animation-delay: calc(var(--i) * 90ms)`, stage 4 is the subdividing
gradient. Reuses the mechanisms of ideas 14 and 3 rather than adding new ones.

**Cost:** Hard — four stages, and it is the longest thing in the set.

**Risk:** Two of them. It is 4–5 seconds before it looks finished, which is longer than most hovers;
and stage one is *deliberately broken-looking*, which is precisely the failure the brief warns
about — a reader who hovers for 400ms sees only the mess.

---

## 17. Minted Once

**From:** [block-ids.md](../project/block-ids.md) — the one contract.

**What the reader sees.** Beneath each letter, a tiny six-character tag fades up in a monospaced
face, far too small to read as anything but texture, and fades away. Hover again and — this is the
point — **the tags are exactly the same ones**.

**Why it belongs.** Every feature in the app addresses text by a stable id that is minted once and
survives re-extraction; nothing here is addressed by offset.

**Mechanism.** Hard, and it needs markup: either a `data-id` per letter with
`.logo-letter::after { content: attr(data-id) }`, or ten hardcoded `content` strings in CSS. Font
`0.3rem`, `--rule`, absolutely positioned so they overhang without affecting layout. The tags must be
constants in the stylesheet, never generated, because the whole joke is that they do not change.

**Cost:** Hard — it is the only idea needing new attributes on the letters, in both DOMs.

**Risk:** 0.3rem text under a 0.82rem wordmark inside a 44px control is illegible by construction, so
it is texture rather than information — and the one thing that makes it good (the ids being
identical on the second hover) is invisible to anyone who does not hover twice and look closely.

---

## 18. Takes Turns

**From:** [reading-view-overview.md § The modes in the band](../project/reading-view-overview.md) —
a combination, not a feature.

**What the reader sees.** Four of the marks above, in sequence, one per beat, on the same ten
letters: the glossary's underlines, then the quote's left rule and wash, then the search tint, then
the tiered focus travelling. Each one arrives, holds for about a second, and hands over to the next.

**Why it belongs.** The band is a single surface that the modes take turns in — the article never
moves, and only the band changes.

**Mechanism.** No new visual machinery at all: one timeline that switches which of four already-built
animation classes is active, either with four `animation`s at staggered delays and long `opacity: 0`
runs, or with a few lines of JS swapping a class every 1.2s. Reusing the ideas above is the whole
point — if this one costs more than the sum of its parts, the parts were written wrong.

**Cost:** Medium, given ideas 2, 3, 4 and 5 exist. Hard if they do not.

**Risk:** Six seconds long, and the mechanism the brief specifically warns about — this is where a
registry and a playground route start to look necessary, which is exactly the scope creep the
previous version's 4,700 lines are the warning about. Also: as a *random* pick it is the one that
will feel like the machine showing off rather than a flourish.
