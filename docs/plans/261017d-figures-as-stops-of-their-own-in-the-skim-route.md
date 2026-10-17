# Figures as stops of their own in Skim's Gist · More · Most

Report `spya-c8z66b` (#584, `SPIDERYARN-READING2-J5`), question
[q-z27hq2](../user-feedback/questions/q-z27hq2.md), queue item `qi-77vvdcac` (it supersedes
`qi-r4rvhyqw`). Up: [skim.md](../project/skim.md). The fork was laid out in
[261015b § #584](261015b-figures-follow-ups-tables-as-pictures-louder-structure-marks.md).

> It's good that we have a "Figures" sub-mode in Skim now.
>
> Perhaps we should also have the option to include some figures along with quotes in the main
> Gist/More/Most Skim trajectories (as the LLM sees fit)
>
> — Greg, 2026-10-15 (`spya-c8z66b`)

> I was thinking 1B, perhaps with some kind of commentary or cue to make it easier to see why the
> figure is being included. Use your judgment. / 2A
>
> — Greg, 2026-10-17 (`spya-zrfpc0`, reply to q-z27hq2)

So: **a figure is a stop of its own, between quotes** (1B), **with a cue saying why it is there**,
and **the model chooses which** (2A). Greg left the rest to judgment, including the one decision the
question named: whether a figure counts toward a pass's length.

## What the reader gets

On a paper with figures, a pass can step from a quote to a figure and on to the next quote. The
figure's row carries the figure icon and its caption (the author's words, cut on the row and whole
on the current one), and on the current row, above it, the cue: one or two sentences saying what to
look at in the figure and why it is on this walk, in the model's voice, never what it shows the
result to be. Stepping to it scrolls the figure to the centre and flashes the whole block, as the
Figures walk does; the door under it says *Next stop ›*. The *Figures* chip and its walk are
unchanged.

A route planned before this (`skim/13` and earlier) has no figure stops and walks as it did. It is
*outdated*, which is not announced (plan 260929c); it gains figures when it is planned again.

## Decisions

1. **A figure counts toward its pass's length, as walked.** The reader steps through it, so
   *Stop k of N* and the depth chips' counts include it, and so does the growth rule a pass is
   held to (`growthFailure`: no deeper pass shorter, and with eight or more quotes each strictly
   longer). The quote **targets** are unchanged — they were measured over five prompt versions —
   and a figure is on top of them. The prompt says so, and says a figure in a shallower pass must
   still leave each deeper pass longer. **The backstop** is new and simple: after the quote route
   is final (`growPasses`, unchanged), if the figures make a pass too long for the one after it,
   the latest figure in that pass is dropped, and again, until the rule holds. It always ends,
   because the quotes alone pass the rule. Figures are extras; dropping one costs the reader one
   picture, never a quote.

   *Simpler option passed over:* figures not counted at all (a separate count in the head). Two
   numbers for one walk is harder to read, and *Stop 4 of 5* that is really the sixth step is
   wrong.

2. **A figure is walked in one pass only.** No `again`. Carrying exists so that quotes the deeper
   pass leans on are met again; a figure is a picture beside a passage, and being met once is
   enough. It keeps the carry cap and the repair search (`repairSizes`) untouched.

3. **A figure may only join a pass that has quotes of its own**, and never creates one. A pass
   is offered when a quote stop is first placed there (`offeredDepths`); a figure at a depth
   nothing else is at is dropped.

4. **At most 1 figure in Gist, 2 in More, 3 in Most** (`FIGURE_CAPS`), over a cap dropped in route
   order. Numbers to measure, like `targetsFor`, not product constants. Gist is three to five
   quote stops, so at most six with its figure; two pictures in it would be a different mode.

5. **The cue is asked for on every figure**, unlike a quote's (optional since `skim/11`). Greg
   asked for it: *"some kind of commentary or cue to make it easier to see why the figure is being
   included"*. Its rules are the quote cue's — never the finding, only what the records say, no
   reference to another stop, at most `MAX_CUE_CHARS` — plus one of its own: say what to look at
   in the figure and what it bears on (a key idea, a part of the piece), because a caption often
   says what is drawn but not why a skimmer should look. A figure whose cue is missing or bad is
   **kept with no cue**, and counted, as a quote's is (Sol F25): its caption is still there.

6. **What the model is given about each figure**: a label (`F1`, `F2`, …), its kind and name
   (*Figure 2*, *Table 1* — the author's number when the caption starts with one, else ours), its
   section path, its caption (the author's words, clipped like an Idea at 300 characters, fenced as
   untrusted), and **which quotes' paragraphs name it** (*"named beside Q4, Q9"*: the quote's own
   block says *Figure 2* / *Fig. 2* / *Table 1*), computed in code, as the Ideas' *carries* are,
   so the model can put a figure next to the passage that discusses it. A figure in the abstract is
   not offered (`inAbstract`), for the reason quotes there are not. At most `MAX_FIGURES_OFFERED`
   (30), in article order.

7. **Every kind `figuresOf` finds is offered** — figure, table, media — because the Figures walk
   already treats them as one set and an embedded video in an essay is as much a figure as a chart.

## How it is built

### Stored: a second list, not a second kind of stop in `stops`

`Skim` gains `figures?: SkimFigureStop[]`:

```ts
interface SkimFigureStop {
  blockId: BlockId;      // the figure's block (figures.ts § figuresOf)
  depth: SkimDepth;      // the one pass it is walked in
  cue: string | null;
  after: string | null;  // the quote stop it follows in route order; null = before the first
}
```

**Why not a union inside `stops`**, which reads as the more natural shape: `stops` is read by
`src/public/dto.ts`, which is a listed defence ([security-map.md](../project/security-map.md)).
Keeping `stops` quote-only means **the public DTO is not edited**: it constructs `PublicSkim` field
by field, so `figures` is default-absent and a visitor's route simply has none — a visitor walks
the quotes as before. Whether figure stops should cross to visitors is written up for Greg (below),
not built. It also keeps every other reader of `stops` right without a change: `notOnRoute` in the
store, the export's count, the coverage note at Most, `publicSkim`.

**The anchor.** (Superseded after review, F3: the model names `after` itself.) The model writes one interleaved list. The server turns a figure's position into
`after`: the nearest quote entry before it in the model's list whose quote survived validation
(`null` when there is none). Several figures after one quote keep their order. Anchoring to an id,
not an index, means the quote repair (`growPasses`, which keeps order and never drops a stop) and
any dropped quote cannot misplace it.

### The walk: one list of stops, quotes and figures

`src/skim-passes.ts` gains the merged list the walk is over:

```ts
type WalkStop =
  | { kind: "quote"; key: string /* quoteId */; depth; again?; stop: SkimStop }
  | { kind: "figure"; key: BlockId; depth; stop: SkimFigureStop };
function walkOf(stops: SkimStop[], figures?: SkimFigureStop[]): WalkStop[];
```

`walkOf` places each figure after its anchor (or first), and drops one whose depth is not offered
(belt and braces: the server already did). `walkedIn`, `passRoute`, `passCount` and
`offeredDepths` become generic over `{ depth; again? }`, and `offeredDepths` counts quote stops
only, so a figure can never make a pass. `passSizes` on the server is asked of `walkOf(...)`, so
the growth rule and the band's counts stay one definition.

`src/web/skim-route.ts` (`locate`, `stepStop`, `firstStopOf`, `doorAfter`) moves from `.quoteId` to
`.key`. A figure's key is its block id — the same `?stop=` value the Figures walk writes, so a
link to a figure stop and to the same figure in the Figures walk agree.

`useSkimMode` (SkimMode.tsx) walks `walkOf(route.stops, route.figures)`:

- `blockOf(key)`: a quote's block, or the figure's own when `figuresOf` still finds it there;
  otherwise the row is *missing*, as a quote that has gone is.
- No passage for a figure: `found` is empty and nothing is ringed; arriving is `arriveAtBlock`
  (walk.ts), the Figures walk's, and a row press is `onJump(block)` with no passage.
- A figure's row: `SkimRow` gains `figure: { kind, label, voice } | null`; the panel draws the
  figure icon and the label (the caption in the author's face, or *Figure 2* in ours) where a
  quote's words go, cut on the row and whole on the current one, and the cue above it on the
  current row as a quote's is. The label helper moves from FiguresWalk.tsx to walk.ts so both
  walks use one.
- The door's next cue for a figure is its cue, else its label.
- The stop card is gathered for its block as for any stop; for a figure it is usually empty, and
  then there is no card.

The owner's band and `VisitorSkimBand` both go through `useSkimMode`; the visitor's
`PublicSkim` has no `figures`, so its walk is quote-only.

### The step (`src/skim.ts`, `skim/14`)

- `skimInput` adds `figures: FigureRecord[]` (decision 6), from `figuresOf(blocks)`.
- `skimInputHash` adds them: label → block id, kind, name, path, caption, named-beside. Only a
  route of the current version is judged stale on its hash (`loadSkim`), so every older route is
  *outdated*, not stale. An article whose figures change (a PDF figure's caption pairing fixed) has
  a stale route, as it should: the prompt would read differently.
- The prompt: *What you are given* gains the FIGURES; *What you decide* gains **5. FIGURES**
  (decisions 1–5); the output example gains a figure entry; the rules gain *only the F labels
  given*. With no figures the FIGURES part says *(none)* and section 5 says to leave them out.
- `SKIM_OUTPUT_SCHEMA`: a `figures` array beside `stops` (changed after review, below).
- `buildSkim` splits the list: quote entries go through `validateRoute` and `growPasses` exactly
  as now; figure entries through a new `validateFigures` (label resolves, one entry per figure —
  the shallowest, then the earliest —, a depth the final quote route offers, the per-pass cap in
  route order, the cue read as a quote cue is) and then `trimFigures` (decision 1). New counts on
  `SkimDrops`, all optional: `unknownFigure`, `duplicateFigure`, `figureNoPass`, `overFigureCap`,
  `figureShrink`, `noFigureCue`, `badFigureCue`.
- `ANSWER_TOKENS` grows by `MAX_FIGURES_OFFERED` figure entries; the test that builds the largest
  permitted answer builds them too.
- `introsOf` goes on judging the quote passes; an intro maps the quotes only (after review, F1).
  `visible` stays the quotes' cumulative counts, what it has always recorded.

### Measuring it before it ships

Per [prompting-guide.md](../project/prompting-guide.md) and as every Skim prompt change has been,
through `scripts/eval/skim-coverage-eval.ts` (which records `figures` too), `skim/13` (the
committed module, written to a throwaway file) against `skim/14`, two runs each, on articles with
figures: local ones with three or more figures, and a few production ones read read-only with
`skim-inputs-from-production.ts` (Greg's mental-imagery paper first, the report's own article). One
article with no figures as the control for "nothing else moved".

What has to hold, written down before the run:

- **Quotes do not regress**: walked quote pass sizes, Ideas covered in Gist and More, and long
  stops in Gist and More, within the control's own run-to-run spread.
- **Figures are chosen, not sprayed**: on papers with figures, most routes carry some figure,
  within the caps, and the trim (`figureShrink`) rarely fires.
- **Placement**: a figure sits next to (immediately before or after, in its pass) a quote in the
  same section or one whose paragraph names it, in most cases.
- **Cues**: every figure cue read; none gives a finding away, none refers to another stop, each
  says what to look at and why. Read by me and by a blind judge if the read is not clear-cut.

If figures come out sprayed or the quotes regress, the wording changes and it is measured again;
the result goes in `docs/investigations/` and its numbers into this plan.

## Not built: figure stops for visitors

`src/public/dto.ts` is a listed defence, so it is not edited here. A visitor of a public article
walks its route without the figures. Letting them cross is one line in `publicSkim`
(`...opt(skim, "figures")`) and one field on `PublicSkim`: block ids the payload already holds, a
pass, and a cue of the same kind as a quote stop's, which already crosses. Asked of Greg in the
note, not built.

## After GPT Sol's plan review

[261017d-figures-plan-review-sol.md](261017d-figures-plan-review-sol.md), SHIP-WITH-CHANGES. Every
finding taken; what changed:

- **F1, F4 — an intro never names a figure.** A visitor gets no figure stops (the DTO is not
  edited), but does get the intros, so an intro that mentioned a figure would describe a walk the
  visitor does not have; and a trimmed figure would leave a false map. Section 4 of the prompt says
  the intro maps the quotes only, and `introsOf` keeps judging the quote passes. So a figure's trim,
  cap or drop never touches an intro.
- **F3, F6 — the model writes figures in their own array, after the quotes, with `after` named.**
  `{"stops": [...quotes as today...], "figures": [{"figure": "F2", "depth": 2, "after": "Q7",
  "cue": "..."}], "intros": {...}}`. It mirrors storage, needs no `anyOf` and no positional
  reconstruction, and lets the model finish today's quote task before it looks at figures. `after`
  is required; `""` means before the first stop (the house idiom for "none", as a cue's `""`). An
  `after` naming a quote that did not survive validation drops the figure (`figureAnchorGone`):
  it is optional, and moving it somewhere else would put it beside a passage the model did not
  choose. `after` keeps the figure's place in the one route order; a repair (`growPasses`) can
  move the anchor quote to another pass, so the figure follows the quote's *place*, not its pass.
  Every quote-only sentence in the prompt is audited, not just a section added.
- **F2 — the merged walk goes to both `useSkimParts` and `useSkimMode`**, built once per band, so
  the pass chips' counts in the Figures walk and a switch from Figures to a pass that starts with
  a figure agree. `SkimRow.quoteId` becomes `key`, with every state the panel keys on it (row
  keys, follow-scroll, the tooltip and where-card ids).
- **F4 — the trim is bounded and asserted.** `buildSkim` fails the quote route on its own first, as
  now; only a passing quote route gets figures. The trim walks consecutive *offered* passes (a
  route with no More compares Gist with Most), treats equality as a failure where the rule is
  strict, and the combined route is checked again afterwards. Count-level tests cover every figure
  count within the caps, Gist + Most with no More included.
- **F5** — the Gist sentence in decision 4 says quote stops.
- **F6 — named in a paragraph, boundary-safe.** The record says *"named in the paragraph of Q4,
  Q9"*. The match is `Figure 2`, `Fig. 2`, `Figs. 2`, `Figure 2a`, `Table 1`, `Table S1`, never
  `Figure 2` inside `Figure 20`; tested.
- **F7** — `walkOf` drops a figure whose block id equals a quote id on the route (counted on the
  client only as a missing row would be; the server never stores one either).
- **F8 — the eval's criteria, fixed before it runs:**
  - Corpus: four papers with figures (`arxiv-2010`, `arxiv-1810`, `entropy-24-00930`,
    `race-human-categorization`), a Wikipedia page with many images (`axolotl`), a paper with two
    figures and many quotes (`fd-src-s41598…`), Greg's mental-imagery paper from production, and
    three with no figures (`cargocult`, `source`, and one from production). Two runs per arm.
  - **Quotes do not regress**: per article, walked quote pass sizes, Ideas in Gist and in More, and
    long stops in Gist and More sit within the `skim/13` arm's own two-run spread, ±1, on at least
    eight of the ten articles; summed Ideas in Gist not lower than the control's lower run by more
    than 2.
  - **No new failures**: zero failed routes, `figureShrink` on at most one run in five.
  - **Figures are chosen, not sprayed**: no assertion that most routes have one. Every figure stop
    is read: it is a figure a skimmer gains from (the design, a main result, a model diagram, not a
    logo or a decorative photo), and sits beside a quote in its own section or one whose paragraph
    names it. Target: four in five pass that read.
  - **Cues**: every figure cue read against the cue rules (no finding, no other stop, says what
    to look at and why). Zero that give a finding away; a blind judge on the quote cues and intros,
    old against new, as 261011b did, with no preference for the old by more than its margin there.
  - Recorded: failures, every drop count, tokens, cost, latency.

## Stages

1. **The walk generalised** — `WalkStop`, `walkOf`, the generic pass functions, `skim-route.ts` on
   keys, `useSkimMode` and the panel drawing a figure stop. Tests first: `skim-route.test.ts` for
   walking a route with figures (a figure's pass, its place, the door, *Stop k of N*), and the
   panel test for the figure row. No server change, so nothing stored has figures yet; it is
   exercised by tests and a hand-built route.
2. **The step** — `skim/14`: input, hash, prompt, schema, `validateFigures`, `trimFigures`, the
   drops, the budget. Tests first for each rule in `skim.test.ts`.
3. **The eval** — the run above, the investigation written, wording changed if needed.
4. **GPT Sol code review, a browser check of a figure stop on a real route in both themes and on a
   narrow window, the docs** (skim.md's *What shipped*, the help page if it says every stop is a
   quote), the gates, and the feedback bookkeeping.
