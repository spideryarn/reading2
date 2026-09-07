# The quiz questions are too hard

**[SPIDERYARN-READING2-21](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-21)** · reported
2026-09-05 18:00 UTC · *the prompt half shipped; the slider declined 2026-09-06 in favour of an
adaptive quiz*

## What Greg said

> The quiz questions are too hard. Certainly, they should start much, much easier. And they should
> focus on what's most important. So … you could imagine creating metadata for each quiz question …
> that's like how easy and how central, and we want to prioritize by a combination of the two of
> them. … we could even use the same interface that we use in the glossary of … rank by placement,
> by centrality, by difficulty, with the default being prioritized … and then a UI slider for
> thresholding by a combination of centrality and easiness.

## The metadata he asks for already exists

Every question already carries `band` (`easy`/`medium`/`hard`) and `value` (1–5 centrality), and
`orderQuestions` already sorts band → value → position. So the report is not "add metadata". It is
**the questions are too hard**, which is a prompt problem, and that half is done.

## What changed — the prompt, and nothing else

`easy` is now defined against the reader rather than against the text — *answered without effort,
from one attentive read* — with the tie-break stated: a question between two bands is the harder one.
The spread target goes from three-and-three to **five easy and three hard**, and a new section tells
the model most of the batch should be about what matters most. `PROMPT_VERSION` → `quiz/3`.

**Measured, not hoped.** `npm run eval:quiz -- --generate-only`, same article, same model, before and
after:

| | easy / medium / hard | questions at value 4–5 |
|---|---|---|
| before | 4 / 3 / 4 | 5 of 11 |
| after | **6 / 3 / 3** | **9 of 12** |

Run twice, both times 6/3/3, and nothing was dropped in validation.

**One thing that nearly went wrong.** The first draft asked for five easy and **two** hard. GPT Sol
caught it: `missingBandEnds` measures what *survives validation*, so at two, losing both to one bad
quote throws away a paid batch — which is `260903c` wearing a different number. Back to three, and
the lead the reader meets is set by the easy end anyway. `missingBandEnds` itself was not touched and
no quota went back into it.

## The slider was declined on 2026-09-06, and replaced with an adaptive quiz

Greg asks to threshold on *"a combination of centrality and easiness"*. That collides with three
decisions already on the record. **The first is fatal rather than awkward:**

1. **That blend was proposed and killed on review.** Hard-central `(1,5)` and easy-peripheral `(5,1)`
   both sum to 6, so the tie-break opens with the hardest question — *the exact complaint this report
   starts with*. A threshold on the same blend inherits the same defect.
2. **The panel deliberately shows neither `band` nor `value`** — *"quoting 'hard' at a reader would be
   handing them a token with nothing behind it"* — while the glossary's condition for keeping model
   scores is that the number you sorted by is printed on every row. Both rules cannot hold at once.
3. **The quiz sorts on the server, once.** `QuizPanel` states the invariant: *"a panel that sorted
   would be a second opinion about the same list, and two lists drift."* A reader-facing order control
   reverses it.

Question 1 is the one to answer first; the other two follow from it. Half an hour on those three is
worth more than a week building against a guess.

Written up in
[260905g](../plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md) § Three questions for
Greg.

### What Greg decided

Offered four endings — decline the slider, build a narrower version, build it as asked, or go
adaptive — **he chose adaptive**, on 2026-09-06. As recorded on the day: *right answer, harder next;
wrong answer, easier.* (That sentence is the note-taker's, not Greg's; his verbatim wording was not
captured, and inventing one to fill the gap would be worse than saying so.)

**The reasoning is that it serves the goal the slider was for without the slider.** "Start easy, stay
at the right level" is what the report is asking for; a control is one way to get there and not the
only one. Adaptive gets there without a knob, and — this is the part that dissolves objections 2 and
3 rather than answering them — **without ever exposing a score**. There is no control, so there is no
number the reader would have to be shown to justify it, and no second opinion about the order: the
server ranks the batch once, as now, and the client walks that ranking one question at a time.

So the thing built is *the absence of a control*, which is why it is a better answer than the thing
asked for. The reader never learns what `band` or `value` mean and never tunes anything; the quiz
just fits.

Objection 1 — the fatal one — is honoured rather than dodged: adaptive never blends `band` with
`value` either. Band chooses the rung, value chooses which question on it, and the two judgements
stay in separate jobs exactly as `orderQuestions` keeps them.

Built in [260907d](../plans/260907d-make-the-quiz-adaptive.md), which carries the ladder's edges, the
hidden correctness signal the mark had to grow, and the measurements.
