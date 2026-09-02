# Make Referee mode understandable

**Status: planning, revised after GPT Sol's first review, 2026-09-02.** Worktree
`referee-mode-clarity`, branch `worktree-referee-mode-clarity`, dev server on 5274 against Postgres.
Review: [260902e-…-review-sol.md](260902f-make-referee-mode-understandable-review-sol.md), which
returned **do not build as written** on the first draft. Eight of its nine findings changed this
plan; § *Where this plan still disagrees with the review* is the one that did not.

Greg, 2026-09-02:

> The new Referee mode is very confusing. Add lots of explanatory tooltips to buttons etc.
>
> Also, I'm not convinced that the highlighting colour in the text matches the colour in the Referee
> Claims. Here, "So if extrapolation" counts against on the left, and yet it is highlighted with a
> green line in the text on the right.

He is right, and it is not a rendering glitch. It is two colour systems painted next to each other
with nothing on screen saying they are two.

## The bug, stated exactly

A `diverging` criterion's passages are painted **twice**, from **two different palettes**:

| Where | Painted from | Means |
|---|---|---|
| the mark in the prose | `Found.slot` → `var(--cat-N-rgb)` ([`src/web/search-hits.ts`](../../src/web/search-hits.ts) § `Found`) | **which criterion** — an Okabe–Ito identity hue, one of which is green |
| the swatch in the panel row | `valenceToken(scale, valence)` → `var(--div-rg-N)` ([`src/web/CriteriaPanel.tsx`](../../src/web/CriteriaPanel.tsx) § `CriterionResult`) | **which way it cuts** — red↔green |

So a criterion that drew the green identity slot underlines *every* one of its passages green,
including the ones the panel calls "counts against" in red. `CriteriaBand` builds the `Found`
without the valence at all, and `resolveCriterion`'s docstring says so on purpose:

> A `DivergingResult` carries a −100…+100 valence and none of it reaches `Found` … So the prose
> keeps saying which criterion, and the panel row and the block gutter say which way.

That was a deliberate decision, defended in
[referee-mode.md § Criteria](../project/referee-mode.md), and
`tests/referee-criteria-resolve.test.ts` enforces it in two tests written for that purpose.
**Greg has reversed it**, 2026-09-02, asked directly:

> I was thinking that it should match the colour of the left-hand panel. If that's set to red/green,
> so should the prose be.

So this plan reverses a decision on purpose, and the two tests that guard it are rewritten
deliberately rather than repaired.

## The rule the reversal runs into, and what pays for it

[colour-scales.md](../project/colour-scales.md) says colour may never be the only carrier of a
good/bad judgement, and `DEFAULT_DIVERGING_SCALE` in
[`src/referee-criteria.ts`](../../src/referee-criteria.ts) writes down the condition the red↔green
default is permitted under: the direction has to be readable from something that is not the colour.

The panel meets that four times over — rank, direction in words, the referee's own pole label, the
signed number. **The prose meets it zero times.** Sol's first finding is that this is *worse* than
today rather than neutral, and it is right: today's unlabelled stripe carries an identity, which is
no judgement at all; tomorrow's would carry a verdict with nothing beside it.

So the mark grows a **non-colour carrier of its own**: a small superscript **sign** after the marked
phrase — `−` where the passage counts against, `+` where it counts for, `·` where it counts neither
way — written from a `data-dir` attribute through a CSS `::after`, so it is generated content rather
than text (it cannot be copied out of the article, and it cannot reach the block's text offsets,
which is the one thing [block-ids.md](../project/block-ids.md) would never forgive). A minus sign is
self-describing in a way a hue is not, it survives greyscale, deuteranopia and protanopia intact,
and it is the carrier the rule actually asks for.

Plus a **visible key** in the Criteria panel whenever a diverging criterion is switched on — *"in the
paper: red − counts against · green + counts for"* — so the mapping is stated on screen and not only
in a card somebody dismissed.

## Provenance: what survives, and what this knowingly gives up

The renderer paints identity twice — the stripes under a phrase (`HUE_STRIPES`) and **the bar down
the left of the paragraph** (`BAR_HUES`), which [colour-scales.md](../project/colour-scales.md) keeps
because "the two answer different questions". Both are fed the same list: `App.tsx` hands
`refereeFound` to `hitMarks` *and* to `blockHues`. So moving the phrase stripe to valence leaves the
paragraph bar carrying identity, in the reading view, for every marked paragraph.

**Sol is right that this is coarser than the plan first claimed.** The bar is paragraph-wide, 3px,
caps at eight, and `blockHues` collapses two criteria that share a slot. It answers *"which of my
criteria are live around here"* and it cannot answer *"which one made this red phrase"*.

Two things are done about that, and one thing is knowingly not:

- **Pressing a result now rings the exact phrase.** Referee mode hard-codes `openPassage` to `null`
  (`App.tsx`), so a criterion result jumps to its *block* and the phrase it was about is never
  distinguished — while Search's identical rows get the `mark.hit[data-hit-open]` ring. That is a
  plain defect, it is the panel→prose direction a referee actually travels, and it is fixed here.
- **The sign glyph** above means the prose answers *which way* without the panel at all.
- **Not fixed: prose→panel.** Seeing a red mark and asking which criterion said so still needs the
  bar or the panel. Hit marks are inert to the click by design
  ([`src/web/annotate.ts`](../../src/web/annotate.ts)), so this was never really answered before
  either — the old stripe answered it only for a reader who had memorised eight hues, which
  colour-scales.md itself calls "a usability problem long before it is an accessibility one". If a
  referee is seen hunting for it, the fix is a clickable mark, and that is a bigger change than this.

The alternative Sol and Fable both offered — **allow only one diverging criterion marked at a time** —
is not taken. It removes reading one section against two lenses, and it breaks parity with search's
any-number-of-runs model, to buy back a channel that was mostly theoretical. It stays the fallback.

## The second bug, which nobody had noticed

**Two criteria can put red at opposite ends of the truth.** The composer lets each criterion pick its
own scale, and the two ramps disagree about red: `valenceStep` sends −100→0 and +100→8, `--div-rg-0`
is red (*against*) and `--div-8` is red (*favour*). In the panel the words rescue it. In the prose
there are none, so the same red underline would mean opposite verdicts in one document.

Fix: **one scale for the whole mode**, `?refscale=rg|br`, default `rg`, which is what
[url-state.md](../project/url-state.md) says view state does here, needs no migration, and makes the
colour-vision switch work *retroactively* over criteria already run — which the per-criterion select
never could. Written with `replace`, the precedent for a display switch. An unrecognised value falls
back to `rg` rather than throwing, the way every other parser in [`params.ts`](../../src/web/params.ts)
treats a hand-edited URL.

**It has to reach every valence surface, not just two.** Sol's finding 4: `PlaceOnCriterion` paints
the current placement *and* all five instrument positions from `chosen.config.scale`, so an old `br`
row under a default `rg` URL would show opposite palettes in the same session. Every surface that
calls `valenceToken` takes the mode scale. `RefereeGap` stays untouched — it is words-only on
purpose.

`referee_criteria.scale` stops being read for display, and **new rows write the current mode scale**
so the column stays truthful rather than becoming a lie. It is not dropped: dropping a column is
destructive and the values are already in rows. See § What this leaves behind.

## Stages

Each ends with the suite at its baseline, the tree committable, and the plan doc updated in the same
commit. Sol's finding 6 is taken: **stage 1 carries its own explanation, its own browser evidence and
its own doc corrections**, because a stage that changes what a colour means and defers saying so
leaves `referee-mode.md`, `colour-scales.md` and two code docstrings all asserting the opposite rule.

### Stage 1a — the RGB tokens (behaviour-free)

`--div-N-rgb` / `--div-rg-N-rgb` triples in [`styles/colourscales.css`](../../styles/colourscales.css),
with the hex forms *derived* from them (`--div-rg-0: rgb(var(--div-rg-0-rgb))`) rather than written
twice. That is the file's own established rule, not a new idea — `--vir-*` already does exactly this,
and `tests/colour-scales.test.ts` says why: "a component sets `--cat-rgb` to one of these inline and
the stylesheet paints it at an alpha", which is precisely what `annotate.ts` is about to do.
`tests/colour-scales.test.ts` reads the two diverging ramps through the triple parser it already has
for viridis. Nothing else changes; nothing on screen moves.

### Stage 1b — the prose matches the panel

- `Found.valence: number | null` — **the number, not a CSS token.** Sol's finding 5: `Found` carries
  source facts and palette resolution happens later, so a token on it would put presentation state in
  the resolver and make `resolveCriterion` depend on the URL. `hitMarks` resolves it, where the
  Reader already owns `refscale`.
- `Mark.hue` — the resolved token, `var(--div-rg-N-rgb)`, absent for every identity mark.
- `annotateHtml` writes `--h${i}: ${hue ?? var(--cat-${slot}-rgb)}`.
- **Dedup, per Sol's finding 3**: hue-bearing marks dedup on their **resolved token**, identity-only
  marks dedup on **slot**, exactly as today. Keeping the slot key for both would have collapsed two
  opposite valences from one criterion into one stripe and silently dropped a direction, and drawn
  two same-step stripes as one uninterrupted band while `data-hues` said two. Both get a test.
  A `hue` with a null or invalid slot is made unrepresentable rather than handled.
- `blockHues` / `spine-marks.ts` untouched — the paragraph bar and the rail keep reading `slot`.
- `data-dir` on the mark and the `::after` sign glyph; the visible key in the Criteria panel.
- The mode-level scale, everywhere `valenceToken` is called, `PlaceOnCriterion` included.
- **`openPassage` stops being `null` in Referee mode**, so pressing a result rings its phrase.
- A visible sentence above the criteria list saying what the tick does — Claims labels its identical
  checkbox in visible text and Criteria does not, which is Sol's finding 8 and the reason the card's
  first draft was wrong about default-off.
- Docs corrected **in this stage**: [referee-mode.md](../project/referee-mode.md),
  [colour-scales.md](../project/colour-scales.md), and the two docstrings
  (`resolveCriterion`, `CriteriaPanel`'s header) that state the reversed rule.

**Done looks like**: measured in a browser with `getComputedStyle`, not by eye — a passage the panel
calls "counts against" is red in the prose and carries `−`; one it calls "counts for" is green and
carries `+`; Search mode's marks are byte-identical; two criteria on one span still draw two stripes;
one criterion's opposite-valence hits on one span draw two stripes.

**Must not change**: `hit-colours.ts`, `Found.slot`'s meaning, `resolveHits` / `findLiteral` /
`resolveIdea` / `resolveQuote` / `resolveTimelineEvent`, `resolveClaim`'s identity-only path, and
`Mark.slot`'s contract (integer in `[0, PALETTE_SLOTS)` naming a `--cat-N-rgb`).

#### Built, 2026-09-02 — and the three places it is not what is written above

Everything in this stage landed as written except three, all of them small and all recorded here
rather than left in a diff:

- **`data-dir` has a fourth value, `mixed`, drawn as `±`.** The plan says three. But two results of
  one criterion — or two criteria — can point opposite ways over one phrase, which is exactly the
  case Sol's finding 3 made us key the dedup on the token for, and both stripes are then drawn.
  Printing one of the two signs there would be the renderer choosing a verdict, so it prints `±` and
  leaves the panel to say which is which.
- **The sign's alt text was empty** — `content: "−" / ""`, with the plain declaration above it as
  the fallback for a browser that does not parse the alt-text syntax. A stray minus announced inside
  the author's sentence is worse than silence, and a screen-reader user gets the direction from the
  panel row's ordered sentence, which carries all four carriers. Measured in Chrome: the alt-text
  form wins, so the glyph had no accessible name. **Reversed by the code review below** — the panel
  is not a substitute for a reader who arrived at the prose, so the alt text is now the direction in
  words.
- **`url-state.md` is not touched.** Its parameter table has no row for `?runs=` or `?crits=` either,
  so `?refscale=` would be the odd one in; the file is rule-bearing, and the edit it is already owed
  (the `localStorage` exception, stage 3) goes to Greg under
  [edit-important-docs.md](../reusable/edit-important-docs.md). `?refscale=` is documented in full in
  [referee-mode.md](../project/referee-mode.md) and beside its parser.

**Measured rather than assumed**, in Chrome through `playwright-core`, against the real stylesheets:
`--h0: var(--div-rg-0-rgb)` computes to `linear-gradient(rgb(255, 171, 161), …)` — the red end —
so the existing `mark.hit[data-hues]` rules needed no change; two opposite valences over one phrase
compute to a hard-stop gradient of `rgb(255,171,161)` and `rgb(143,217,154)` with `data-dir="mixed"`;
an identity mark still computes `--cat-3-rgb` unchanged; and the marked paragraph's `textContent` is
the author's sentence with no sign in it.

#### What the code review of stage 1 changed

[260902f-make-referee-mode-understandable-stage1-review-sol.md](260902f-make-referee-mode-understandable-stage1-review-sol.md) — *ship with changes*, twelve
findings, and nine of them were real defects rather than opinions. Two of the nine were the reversal
quietly contradicting itself, and both were invisible to the whole suite:

- **A reader's own comment marker could be erased by our sign** (2). One element, one `::after`, two
  rules at equal specificity, and the later one — ours — won on any passage a criterion also marked.
  Fixed with a higher-specificity rule per direction that prints both glyphs. A real element inside
  the mark was refused outright: text nodes inside a mark move the block's rendered-text offset
  space, which [block-ids.md](../project/block-ids.md) says nothing may disturb.
- **Six identity stripes could starve the valence stripe entirely** (3), leaving a phrase drawn in
  categorical colours and signed `−` — the colours and the sign describing different facts, which is
  the one thing the mark must never do, since the sign is what pays for painting a judgement at all.
  `shareStripes` in [`annotate.ts`](../../src/web/annotate.ts) now guarantees each kind a floor and
  hands back what the other does not use.
- **Pressing a result did nothing unless its criterion was already ticked** (1) — an unticked
  criterion draws no marks, so the open key named a mark nothing was drawing, and the band's own
  absence check then cleared it. The press now switches the criterion on, which is what a finished
  run already does.
- **`mixed` was derived from the marks that *end* on a run rather than those covering it** (5), so a
  partial overlap of opposite directions printed one of the two signs — a verdict the renderer had
  invented.
- **The visible copy was false for new runs** (7): it said nothing is marked until you tick, on the
  screen where a finished run ticks itself.
- Plus (4) the sign's alt text, above; (6) the tick and the colour control still claiming an
  identity hue that no longer reaches a diverging criterion's marks; (8) `SANITIZER_VERSION`, which
  the `data-dir` change should have bumped; (9) a source-of-truth docstring in
  [`referee-criteria.ts`](../../src/referee-criteria.ts) still asserting the pre-reversal rule; and
  (11) `Mark`'s valence arm, now discriminated on `kind: "hit"`, with the docstring's claim about
  *invalid slots* corrected rather than restated — the runtime guard is what catches those, and a
  nominal slot type would need a validator at every construction site.

Finding 10 (`?refscale=` in [url-state.md](../project/url-state.md)) is a rule-bearing doc and goes
to Greg under [edit-important-docs.md](../reusable/edit-important-docs.md) rather than being slipped
in here. Finding 12's missing cases are all covered now, including one Chrome-backed computed-style
check — [`tests/mark-sign-in-chrome.test.ts`](../../tests/mark-sign-in-chrome.test.ts) — because the
`::after` rules are where findings 2 and 4 lived and no assertion on the DOM can see them.

### Stage 2 — say what every control does

Referee mode has **zero** `Tooltip`/`ControlTip` usage today. Almost everything below already has a
carefully-written sentence sitting in a code comment or a constant; almost none of it reaches the
screen attached to the control it is about.

- `ControlTip` cards on the four sub-mode chips (`RefereeViews`), wrapped in a `TooltipGroup` — the
  only radiogroup in the mode with no tooltip of any kind.
- Criteria: the kind chips (wire the existing `KIND_NOTE` in), the colour swatch button
  (labelled *mark colour* or *bar and rail colour* since Sol's finding 6, but with no hint that it
  opens anything), "Automatic", the preset chips (they
  **overwrite** the form and nothing says so), delete, "Try again", the rank numeral, "Run this
  criterion" (a model call over the whole paper).
- Claims: Pull, the tick, the "other text in quotes" heading.
- Mirror: the per-row evidence tag, and the coverage row that deliberately has no jump button.
- Candidates: the shortlist heading (each turn **replaces** the shortlist), the tool strip.
- `PlaceOnCriterion`: the criterion `<select>`, which silently discards a placement when you switch
  criterion. The highest-value "how" sentence in the mode.

**Labels that change, because a tooltip is not read by anybody in a hurry** — which is what a referee
is, and which [`MirrorPanel.tsx`](../../src/web/MirrorPanel.tsx) already says about itself:

- `KIND_LABEL.diverging`: **"Two ends" → "For / against"**. Ours is not a referee's vocabulary.
- Mirror's row badges: **"Tested in a trial" → "A kind tested in a trial"** (and its negative). Beside
  one remark the current wording reads as a claim that *this remark* was verified.
- `title="Go to this passage"` in Mirror becomes a real `Tooltip` — a native `title` is the
  anti-pattern [`Tooltip.tsx`](../../src/web/Tooltip.tsx)'s own docstring argues against.
- The **ramp glyph** that says "this criterion paints by direction" is a glyph beside the criterion,
  **not** a tinted checkbox: Sol's finding 7 — the tick is styled through `accent-color`, which
  cannot hold a gradient, so the first draft's "miniature ramp tick" was unbuildable as written.

#### Built, 2026-09-02 — what landed, and the five places it is not what is written above

Eighteen `ControlTip` sites across the four sub-modes and `PlaceOnCriterion` — about thirty controls
once the two chip rows and the six presets are counted out — three label changes and one message. [referee-mode.md § Every control says what it
does](../project/referee-mode.md#every-control-says-what-it-does) is the table of what each card
says; [tooltips.md](../project/tooltips.md) now carries `ControlTip`'s rule and two jsdom traps, and
its claim that the obvious second customer was a gist cell is gone — Referee mode is the largest
customer by a factor of five. Everything above landed except:

- **The ramp glyph is not built**, and it is the one item deferred rather than done. Its job — *this
  criterion paints by direction, so its colour control does something else* — is carried for now by
  the two things stage 1 already changed: the swatch's `aria-label` reads *"Bar and rail colour"* on
  a diverging row, and its card says in a sentence what the button does and does not reach. A glyph
  is still the better answer for a referee who is not hovering, and it wants the visual pass stage 3
  is doing anyway rather than a third mechanism bolted on now.
- **A fourth label changed**, unplanned: Criteria's *Try again* now carries
  `aria-label="Run this criterion again"`. `DiagramPanel`'s `TryAgain` had already found this —
  *"Try again" on its own names nothing*, and a referee arriving by Tab hears "button, Try again"
  with no object. The visible words are unchanged.
- **The rank numeral's card is hover-only, and that is a real gap said out loud** rather than
  quietly accepted. The numeral is a `<span>` inside the jump button, so it takes no focus and the
  keyboard route `Tooltip` gives for free is not there; a `tabIndex` on it would put a tab stop
  inside a button, which is worse, and wrapping the whole row would fire a card over the
  neighbouring rows every time a referee ran their eye down the list. If the gap is worth closing it
  wants a visible line above the list, not a card.
- **The *Run this criterion* card cannot be read while the button is disabled**, which is exactly
  when a referee wants it. A `disabled` button emits no pointer or focus events, so Floating UI
  never hears about it. Left alone deliberately: the fix is `aria-disabled` plus a `:disabled`
  rule in the stylesheet, and this stage changed no layout. Recorded beside the button.
- **`ANSWER_OVERFLOWED` was reworded rather than split.** The browser pass found Claims printing
  *"Asking for something narrower usually fits"* with nothing on screen to narrow, and the message is
  shared: `parseHits` is Search's parser and Referee mode's, so Criteria, Claims and Mirror all reach
  it and none of the three has a scoping control. A second message for the referee callers was the
  alternative — three call sites, one more code for a reader to quote — and the smaller honest fix
  was to name the retry first (the lever every screen has, and the one the `retry` kind already draws
  a button for) and condition the narrowing clause. Two docstrings in
  [`src/search.ts`](../../src/search.ts) that quoted the old advice were corrected with it.

**Tests**: [`tests/referee-tooltips.test.tsx`](../../tests/referee-tooltips.test.tsx), nine cases —
a card on each of the four sub-mode chips and each card that chip's; `KIND_NOTE` reaching the kind
chips as *one string* rather than a second copy; cards on the presets and the run button; the three
changed labels as literals; the badge's card carrying `EVIDENCE_NOTE`; the jump's `title` gone; the
coverage row explaining its own missing door; and `ANSWER_OVERFLOWED` naming a lever every screen
has. Suite after: **4 files / 4 tests red** — `doc-links`, `pdf-bundle-trace`,
`store-artefact-manifest`, `store-roundtrip` — which is the baseline this stage started from and
which is smaller than the ten files § *Baseline* records, because six of those were fixed elsewhere
in between. Nothing that was green went red.

Two things about testing a card in jsdom were **measured rather than reasoned about**, and both are
now in [tooltips.md](../project/tooltips.md) because either one silently makes the test assert
nothing: a native `mouseleave` does not close a card (React's synthetic `onMouseLeave` does, and it
is synthesised from a bubbling `mouseout`), and the close needs **two** `act` blocks rather than one
long one, because the transition's unmount timer is only scheduled by the render that the first
block's queued state update produces.

### Stage 3 — the card, and the tab that spends money

- **"How Referee mode works"**, under the chips at the top of `.ref-panel` — not inside `.ref-brief`,
  which is capped at 40% of the band and already holds the two notices that may never be dismissed. A
  closable card beside a non-closable one invites closing the wrong one.
- Re-openable from a **"How this works"** button in the mode header, so dismissal and reopening are
  one bit rather than two discoveries.
- **Candidates stops spending money on a tab press.** `CandidatesBand` fires a model call with
  server-side web searches the moment the sub-mode first opens. The other three chips are inert; a
  first-time referee clicking through the radiogroup pays for a run and sends paper-derived terms to
  a search engine — a *different* third party at a *different* time from the one the band's notice is
  about. It goes behind one labelled press.
- The `localStorage` exception gets written into [url-state.md](../project/url-state.md), which is a
  rule-bearing doc, so that edit goes to Greg as a before/after under
  [edit-important-docs.md](../reusable/edit-important-docs.md) rather than being slipped in.

### Stage 4 — drive it, then write it down

A Playwright pass on a real paper through all four sub-modes, fixing what it finds; the remaining doc
updates ([tooltips.md](../project/tooltips.md)); final cross-family review.

## The card's words

Corrected per Sol's finding 8 — the first draft said marks appear when a criterion runs (they do not;
`?crits=` starts empty and the tick is what paints), and said "every row is a door into the prose"
(Mirror's coverage row deliberately has no jump, and an empty Claims row has no passage).

> **How Referee mode works**
>
> You are the referee. Nothing here scores the paper or drafts your review — a tool that hands you a
> verdict makes you lenient, and the research has measured it.
>
> **Criteria** — write what you have been asked to judge against. A criterion marks its passages
> while its tick is on, and a new run turns its tick on for you.
> **Claims** — what the paper says it shows, and where it takes each claim up. Whether a passage
> carries the claim is your call, not the model's.
> **Mirror** — the model reads your own comments, never the paper, and flags ones an author could not
> act on.
> **Candidates** — for editors: who could review this, each name with a link a web search returned.
>
> **What the colours mean.** On a for/against criterion, colour is direction: red counts against,
> green counts for — in the panel and in the paper alike, and marked `−` or `+` in the paper so the
> colour is never the only thing saying it. Every other colour just says *which* of your criteria or
> claims made a mark; it carries no judgement.

## Where this plan still disagrees with the review

Sol's finding 2 would **retain identity stripes until there is real prose→panel provenance**, or
restrict the first version to one active diverging criterion. Neither is taken. The first is Greg's
decision reversed back again; the second removes a capability to buy back a channel that only ever
worked for a reader holding eight hues in their head. What is taken from the finding is everything
else in it: the `openPassage` fix, the honest statement of what the paragraph bar can and cannot say,
and keeping one-criterion-at-a-time named as the fallback.

## What was considered and not taken

- **Bias automatic slot assignment away from ramp-adjacent hues in Referee mode.** Fable proposed it;
  Sol agreed it should go, for better reasons than the first draft gave — it cannot fix a colour the
  reader *chose*, it would have to vary with `rg` versus `br`, and it would make identity colours
  change when `?refscale=` changed. The collision it was aimed at is instead handled by the ramp
  glyph, the sign glyph and the key, and browser-tested rather than left to be discovered.
- **A distinct underline *style* per criterion.** At 1–2px they are not distinguishable, they cap at
  three or four, and they break the stacked-stripe overlap story.
- **Hover-to-reveal provenance.** Invisible on touch, and unread by a referee in a hurry.
- **A reader-profile column for the card's dismissal.** A migration for a checkbox.

## What this leaves behind

`referee_criteria.scale` stops being read for display. New rows write the mode scale, so the column
does not start lying. It is not dropped — dropping a column is destructive and the values are already
in rows — and it is named here so the day it goes is a decision rather than a discovery, the same
note [`drizzle/0051_referee_claims.sql`](../../drizzle/0051_referee_claims.sql) carries about its own
table.

## What the baseline browser pass measured, before anything changed

A Playwright pass on `fowler-phrenology` (8,717 words), signed in through
[`scripts/browser-sign-in.ts`](../../scripts/browser-sign-in.ts), reading the computed colours out of
the DOM rather than looking at them. Criterion: *"Are the statistical claims adequately supported by
the evidence presented?"*, poles unsupported ↔ well-supported, scale `rg`.

| Passage | Panel says | Panel swatch | Prose mark |
|---|---|---|---|
| "In a vast number of instances I have selected children…" | counts against, −70 | `--div-rg-1` → `rgb(218 134 124)` red | `--cat-4-rgb` → `rgb(92 143 232)` **blue** |
| "I have again and again selected in prison the criminal…" | counts against, −70 | `--div-rg-1` red | `rgb(92 143 232)` **blue** |
| "I examined the head of a man in prison…manslaughter." | counts against, −50 | `--div-rg-2` red | `rgb(92 143 232)` **blue** |
| "Dr. Vimont…report in favour of Phrenology." | counts **for**, +10 | `--div-rg-4` near-neutral | `rgb(92 143 232)` **blue**, unchanged |

So it is not that the colours sometimes disagree. **Every hit of a criterion is the same colour
whatever the panel says about it**, and on this run that colour was neither end of the ramp. Greg
happened to draw a green slot; the fault is the same one either way.

Two criteria at once behaved correctly — two categorical hues, and a span hit by both drew
`data-hues="2"` with a split underline. That is the provenance this plan is trading away at the
phrase, and it does work today.

### Four things the pass turned up that this plan did not go looking for

1. **A run can say it finished and then be failed.** Criterion 1 streamed to five preview results with
   no error; on the next load the same run read *"The AI service sent back something this app could
   not read at all"* (`ai-unreadable`). `src/search-hits-stream.ts` documents the risk — previews are
   shown before the final parse, and the final parse can still fail — but from the referee's seat the
   app said done and changed its mind later. **Stage 4.**
2. **Claims offers an action it does not have.** The `ai-overflowed` message says *"Asking for
   something narrower usually fits"*, and Claims has no scoping control of any kind. **Stage 2**, with
   the copy.
3. **`404 POST /api/jobs/spya-*/advance` on every streamed call**, plus `net::ERR_ABORTED` on
   `POST /api/library/<slug>/open` on nearly every page load. Reproducible, nothing visibly broken.
   Not referee-specific; **reported to Greg rather than fixed here.**
4. **`scaling-hypothesis` cannot run Referee at all** — every referee endpoint 404s with *"No article
   artefacts"*, while four other articles answer immediately. An article-level gap, not a mode bug;
   **reported rather than fixed here.**

And one clean positive worth recording: Candidates' *no name without a source* rule fired live. The
model named someone, said mid-answer that it had not actually confirmed them and withdrew the name,
and the rendered shortlist contained only the five sourced candidates. The retraction never reached
the visible UI.

## Baseline, so a regression is legible

`npm test` in this worktree before any change, 2026-09-02: **10 files red, 34 tests red, 8625
passing.** Already red and *not* caused by this work: `admin-store`, `block-policy-prompts`,
`comment-referee-mark`, `doc-links`, `export-route`, `health-migrations`, `health-schema`,
`hierarchy-write-guard`, `owner-isolation`, `pdf-*`, `public-*`, `remember-route`,
`search-colour-picker`, `store-*`, `validate-tree-rows`. Two of those — `comment-referee-mark` and
`search-colour-picker` — are referee- and colour-adjacent, so they are the ones most likely to be
mistaken later for damage from this plan.
