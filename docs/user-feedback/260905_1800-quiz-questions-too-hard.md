# The quiz questions are too hard

**[SPIDERYARN-READING2-21](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-21)** · reported
2026-09-05 18:00 UTC · *the prompt half shipped; the slider deferred with three questions*

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

## The slider is deferred, and these are the three questions

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
worth more than a week building against a guess — and the prompt change above may well be the whole
of what he wanted, since it addresses the sentence he actually opened with.

Written up in
[260905g](../plans/260905g-mark-every-visible-quote-and-make-the-quiz-start-easier.md) § Three questions for
Greg.
