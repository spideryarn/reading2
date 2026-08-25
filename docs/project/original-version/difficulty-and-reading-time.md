# Reading difficulty and reading time

Two small features that both try to answer "what am I in for?" before the reader starts. One is a
model judgment we should be wary of; the other is a well-made piece of arithmetic worth taking
almost as-is.

Reference docs: `docs/reference/TOOL_READING_DIFFICULTY.md`,
`RESEARCH_READING_DIFFICULTY_METRICS.md`, `RESEARCH_READING_SPEED_COMPLEXITY_ADJUSTMENTS.md`. Code:
`lib/utils/enhanced-reading-time.ts`, `reading-time-calculation.ts`.

## Reading difficulty: an LLM instead of a formula

A single badge on the document — High school through Post-doctoral — produced by one model call
returning `{level, confidence, factors[]}`, cached permanently once computed. It is the only tool
over there with persistent caching described as finished.

**Why they abandoned the formulas is the interesting part.** `RESEARCH_READING_DIFFICULTY_METRICS.md`
argues that Flesch-Kincaid and friends are close to useless for this: accuracy against *perceived*
difficulty measured under 49% in places, professional editors regard them as out of fashion, and
Flesch, Flesch-Kincaid and SMOG disagree with each other by several grade levels on identical text.
That is a well-sourced case, and it generalises — those formulas count syllables and sentence
lengths because those are countable, not because they are what makes prose hard.

**What is missing is any check that the replacement is better.** There is no evidence anywhere in
that repo that the LLM badge is more trustworthy than the formulas it replaced. The formulas were
discredited with citations; the model was adopted on the strength of the argument alone.

### What we'd do instead

A document-level verdict is the wrong shape for this project. "Post-doctoral, 80% confident" is a
label the reader accepts or rejects before reading — it does the reader's judging for them, which is
what [vision.md](../vision.md) is against, and it is unfalsifiable in the moment.

**Make it local and diagnostic.** Which *passages* are dense is a genuinely useful thing to know and
it maps onto structure we already have: a per-node signal, anchored to block ids, that the reading
view could express as weight in a gist column. That turns a verdict into a map — the reader still
decides where to slow down, but they can see where the hard parts are.

And if it is ever built, it needs [Q6](../open-questions.md#q6)'s question answered first: how would
we know it was right?

## Reading time: the good one

`lib/utils/enhanced-reading-time.ts` is small, self-contained, well-commented, and cites its source.
Three ideas, in increasing order of cleverness:

1. **A baseline drawn from evidence** — 238 words per minute, from Brysbaert's 2019 meta-analysis,
   cited in the code rather than folklore.
2. **A multiplier by difficulty** — from 1.0× at high-school level down to 0.55× at post-doctoral.
   Harder prose is read more slowly, which is obvious and almost never modelled.
3. **Damped by the model's own confidence** in that difficulty judgment:

   ```js
   adjustedMultiplier = 1 - ((1 - multiplier) * confidenceWeight)
   ```

   So a confident "post-doctoral" applies the full slowdown, and an unsure one barely moves the
   number. **This is the detail worth stealing even without the rest.** It is a general pattern for
   using a model's output in arithmetic: weight the correction by how sure the model was, so a
   guess degrades towards the baseline instead of towards a confident wrong answer.

### What this means for ours

[`src/reading-time.ts`](../../../src/reading-time.ts) currently uses a flat **230 wpm**, described as
"the middling end of the usual 200–250 range". That is a reasonable folk number; **238 is a cited
one**, and the citation is the whole difference. Worth adopting the figure and the reference — the
module already exists precisely so there is one place to change it.

The multiplier is a later question and depends on having a difficulty signal at all. If one ever
arrives, take the confidence damping with it; a slowdown applied at full strength on a shaky judgment
is worse than no slowdown.

Two things ours already does better, worth not losing:

- **It lives in one module** because two sides of the wire say the number out loud — the library card
  and the masthead. A drift between them would look perfectly reasonable on either page and would
  never be reported ([silent-success.md](../../reusable/silent-success.md)).
- **It never returns zero.** A two-line article still takes a moment.

## See also

- [overview.md](overview.md) — the map to that codebase
- [../vision.md](../vision.md) — why a document-level verdict is the wrong shape
- [../open-questions.md#q6](../open-questions.md#q6) — how we'd know any of this is working
- [glossary.md](glossary.md) — the other place they scored things on the reader's behalf
- [typography.md](typography.md) — the rest of what they learned about long-form reading
