# Mark every visible quote, and make the quiz start easier

Two feedback reports from Greg, built together because both turned out to be **small remainders of
things that already exist**. The headline finding, and the first thing to say back to him:

> **Most of what both reports ask for already shipped.** Report 1Z asks for importance scoring, an
> order control, a threshold slider "like the glossary" and quotes marked in the prose. All four
> landed on 2026-08-31 and 2026-09-03. What is missing is one line of the reading view: only the
> *selected* quote is marked, so the mode does not look like a highlighter until you click a row.

- **SPIDERYARN-READING2-1Z** (quotes) — a long think-aloud that starts by asking for a separate
  "highlights" mode and ends with *"why don't we start by expanding the quotes mode and not create a
  new one?"* Taken at his word: no new mode.
- **SPIDERYARN-READING2-21** (quiz) — *"The quiz questions are too hard. Certainly, they should
  start much, much easier. And they should focus on what's most important."* Plus metadata and a
  slider, which are the part that is **not** being built; see the last section.

## Report 1Z — what is being built

### 1. Every visible quote is marked, not only the selected one

`useQuotesMode` in [`src/web/App.tsx`](../../src/web/App.tsx) resolved the selected quote and
returned `[]` otherwise. Search, through the identical pipe, marks all its hits at once — so this is
a change to *which list is resolved*, and nothing downstream moves.

**The list is the panel's own visible list**, so the `?bar=` slider doubles as the
highlight-density control, which is what Greg described:

> skim through it just reading the stuff that is marked

`markedQuotes` in [`QuotesPanel.tsx`](../../src/web/QuotesPanel.tsx) is the one function that
answers *what is the panel showing* — `snapToStop` → `effectiveRank` → `rankQuotes` — and the hook
and the panel both call it. The invariant is the one search already keeps: **the rows in the list
and the marks on the page are the same set, computed once.**

Two consequences that took thought:

- **All the quotes share one `runId`.** The rail's lanes are packed one per run id
  ([`spine-marks.ts` § `laneOrder`](../../src/web/spine-marks.ts)), so a run id per quote would have
  given a sixteen-lane rail in a ten-pixel gutter — marks 1.5px wide, overlapping, sorted sideways
  by an arbitrary id. Quotes are **one source**, the way the literal matcher is one source: one
  lane, one hue, one segment per paragraph, and the identity of the individual quote stays in
  `Found.key` where the mark and the ring read it.
- **The pressed quote gets `mark.hit[data-hit-open]`**, which it did not need when it was the only
  mark on the page and needs now that it is one of sixteen. Same thread as ideas, timeline and
  referee: an `openKey` state in `Reader`, pushed up from the band's layout effect beside `onFound`
  so the ring and the wash can never be about different quotes.

### 2. More quotes

`suggestedQuotes` asked for one per ~600 words clamped 4–16. Greg asked for "many more". Now **one
per ~300 words, clamped 8–32** — a 4,000-word piece goes from 7 to 14, and the ceiling doubles. Not
higher than that: a quote is a promise that this line is worth carrying out, and the slider hides
the excess but cannot make a padded line good. `PROMPT_VERSION` is bumped, so existing lists say
*"These were chosen by an earlier version of the prompt"* rather than the `stale` banner's much
stronger claim.

### What is deliberately NOT built

- **A separate highlights mode.** He talked himself out of it inside the same report.
- **The yellow highlighter.** See the decision below — it is Greg's to make.

## Report 21 — the prompt half only

The prompt now calibrates `easy` downwards, asks for **at least five easy** (it asked for three) with
the hard end left at three, and says in the VALUE section that most of a batch should be on what the
argument leans on. `PROMPT_VERSION` bumped, because the distribution asked for
is exactly what the contract in that file says a bump is for.

**It does something**, which is the only thing one run each side can establish —
`npm run eval:quiz -- --generate-only`, same article, same model, before in
[`evals/results/quiz.md`](../../evals/results/quiz.md) and after in
[`quiz-easier-2026-09-05.md`](../../evals/results/quiz-easier-2026-09-05.md):

| | `quiz/2` | `quiz/3` |
|---|---|---|
| bands | 4 easy · 3 medium · 4 hard | **6 easy** · 3 medium · 3 hard |
| value 4 or 5 | 5 of 11 | **9 of 12** |
| dropped | none | none |

Both halves of the report moved, and the first six questions the reader now meets are easy ones.
Run twice, in fact — once at five-and-two and once at the five-and-three that ships — and both
returned 6 / 3 / 3.

**One thing to watch, and it is not new.** Two questions came back joining two questions with "and",
which the prompt has banned outright since it was written. A question that would have been `medium`
alone may be reaching `easy` by having its easy half welded on, which is the specific way this edit
could go wrong.

**`missingBandEnds` is untouched, and no number goes back into it.** The number there was deleted on
2026-09-03 after a production build failed having paid for nine good questions
([260903c](260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md)). The prompt asks
for a shape; the gate refuses only a batch missing an end outright.

**The hard end stayed at three, and that is a review's correction.** The first version asked for two,
which leans a little further easier and halves the margin the gate actually runs on: `missingBandEnds`
measures what *survived validation*, so with two asked for, losing both to a bad quote throws away a
paid batch, where three has to lose three. Same failure as 260903c wearing a different number — and
the lead the reader meets is decided by the easy end anyway. GPT Sol, on the built change.

## Three questions for Greg, and one decision

### The quiz slider collides with three decisions already on the record

Greg asked for:

> metadata for each quiz question … how easy and how central … the same interface that we use in the
> glossary … a UI slider for thresholding by a combination of centrality and easiness.

The metadata exists — every question already carries `band` and `value`. The **control** is
deferred, because each of its three parts contradicts something that was decided with an argument
attached. Half an hour of Greg's time is worth more than a week built against a guess.

1. **"A combination of centrality and easiness" is the blend that was killed on review.**
   [`src/quiz.ts` § The order](../../src/quiz.ts): hard-central `(1,5)` and easy-peripheral `(5,1)`
   both sum to 6, and the tie-break towards value then opens the batch with the hardest question in
   it — the exact opposite of *"they should start much, much easier"*, which is the other half of
   this same report. A threshold on the blend has the same defect: the first thing it hides is an
   easy peripheral question, and the last thing it hides is a hard central one.
2. **The panel deliberately shows neither `band` nor `value`.** The glossary's condition for keeping
   model scores at all is that *the number you sorted by is printed on every row*
   ([glossary.md](../project/glossary.md#the-scores-and-the-condition-attached-to-keeping-them)),
   and `QuizPanel` shows neither on purpose — a difficulty label on a question changes how the
   reader answers it. Both rules cannot hold. Either the quiz starts printing "hard · 4" on every
   question, or the slider is a control over numbers the reader cannot see.
3. **The quiz sorts on the server, once.** `orderQuestions` runs against the whole batch at
   generation time; the panel never re-sorts, because *a panel that sorted would be a second opinion
   about the same list, and two lists drift.* A slider is a second opinion by construction.

**The cheapest thing that might be enough** is the change already made: a batch that leads much
easier. If Greg reads a fresh quiz and still wants the control, the question to answer first is (2)
— whether a quiz row may show its band — because the other two follow from it.

### Decision: the yellow highlighter

Greg, in report 1Z: *"maybe a yellow highlighter pen"*.

`mark.hit` is a deliberately low-chroma slate ([`styles.css` § `mark.hit`](../../src/web/styles.css)),
and the reason is a call Greg made on 2026-08-26: **the wash channel carries confidence and the hue
channel carries which search found it.** A quote mark is drawn by that same machinery, on purpose —
the whole design of the quotes band is that a marked quote *is* a hit and there is not a second way
of drawing a marked passage.

So yellow costs one of two things, and neither is free:

- **Borrow the hue channel** — give quotes a categorical slot that means "quote" rather than "which
  search". Cheap, and it puts a colour with a meaning into a palette whose meanings are assigned.
- **Add a quotes-specific wash** — a second mark kind beside `hit`. Honest, and it is the second way
  of drawing a marked passage that this band was built to avoid.

Not made here. Worth two minutes of Greg's time, now that all the quotes are marked at once and the
page actually looks like a highlighted page.

## What the review changed

GPT Sol on the built code, 2026-09-05 (`gpt-5.6-sol`, high effort) —
[the prompt](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier-review-prompt.md),
[the answer](260905g-mark-every-visible-quote-and-make-the-quiz-start-easier-review-sol.md). Four
findings, all taken:

1. **"Every visible quote is marked" was not quite true.** A quote naming a block the article no
   longer has is dropped by `resolveQuotes`, and its row stays in the panel — selectable, unwashed,
   with a jump to nowhere. The row is **kept** rather than hidden, because a list quietly shorter
   than the artefact is the failure [silent-success.md](../reusable/silent-success.md) keeps
   catching and the `stale` banner above it already says the article moved; what changed is that the
   claim is now stated with its exception, in `quotes.md`, `QuotesBand` and `useQuotesMode`.
2. **Asking for two hard questions halved the gate's margin** — see above. Put back to three.
3. **`tests/passage-mode-cleanup.test.tsx` names four bands and harnessed three.** Quotes is in it
   now, with the precondition the other three cannot have: two passages marked before anything is
   selected.
4. **Four stale comments** — `quoteParam`, `QuoteRow.onSelect`, `artifacts-fs.ts`'s "at most sixteen
   quotes", and `QuotesBand`'s "the resolved passage".

Sol checked and cleared the three things most likely to be wrong: the `hiddenSelection` guard (right,
including the loading case), the combined layout effect and its unmount cleanup, and the shared
`runId` against all six of its consumers. It found no cliff at 32 quotes — 7,540 answer tokens
inside a 47,540 budget, annotation still scoped to marked blocks, same-slot overlaps collapsing to
one stripe.

## The simpler option passed over

**Marking every quote in the artefact rather than every quote the panel is showing.** Simpler by one
argument, and wrong: the bar would then hide a row and leave its wash on the paragraph, which is the
exact failure the shared threshold rule exists to prevent, and it would take away the density
control Greg described in the same breath.

## See also

- [quotes.md](../project/quotes.md) · [quiz.md](../project/quiz.md)
- [260831j-quotes-mode.md](260831j-quotes-mode.md) — the mode, and the two foundations a review rewrote
- [260831al-review-quiz-sub-mode.md](260831al-review-quiz-sub-mode.md) — the band, the spike, the blend that was killed
- [260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md](260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md) — why `missingBandEnds` has no number in it
