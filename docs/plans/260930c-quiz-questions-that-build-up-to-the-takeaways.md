# Quiz questions that build up to the takeaways

**Status: revised after GPT Sol's plan review (round 1: "do not build", seven P1s); round 2
pending.** Written 2026-09-30 in `worktree-quiz-build-up`, from
[SPIDERYARN-READING2-5W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-5W) (report
`spya-jc2ub9`, an admin suggestion from Greg's own account, provenance checked by
`scripts/feedback-reporter.ts`, exit 0).

Context: [quiz.md](../project/quiz.md) · the earlier report
[260905_1800](../user-feedback/260905_1800-quiz-questions-too-hard.md) and Greg's decision there ·
[260907d](260907d-make-the-quiz-adaptive.md), the adaptive ladder ·
[prompting-guide.md](../project/prompting-guide.md). Reviews:
[round 1](260930c-quiz-questions-that-build-up-to-the-takeaways-review-sol.md).

## What Greg asked for

> For the quiz mode, maybe what we want is, like, more questions, but try and make them easier,
> where maybe only a sentence or two is needed, and make the questions build on one another
> gradually, and so that each answer is not that effortful, but that by the time you've answered a
> whole bunch of them, you know, you've kind of gradually built up towards an understanding of why
> it is the way, you know, what the key takeaways are.
>
> — Greg, 2026-09-29 (SPIDERYARN-READING2-5W)

Four things in it:

1. **More questions.** Up to twelve today.
2. **Each one easier** — answerable in a sentence or two, without effort.
3. **They build on one another**, gradually.
4. **The run arrives somewhere**: by the end the reader has worked up to the key takeaways, and
   *why* they hold.

## The shape: a path, with adaptive scaffolding

The quiz today is **a pool, not a path**: twelve independent questions, sorted on the server by band
(`easy` → `medium` → `hard`), then value, then document position, and walked by an adaptive ladder —
a right answer steps up a band, a wrong one steps down — driven by a hidden right/wrong verdict from
a second, small model call per answer.

A sequence whose questions build on one another cannot be sorted by band, and cannot be hopped
across by a band ladder: question 6 leans on question 5. So **the order becomes the model's, and it
is the path**. That much of the first draft stands.

What changed on review is what happens to adaptivity. The first draft retired it. **GPT Sol (F1)
showed a way to keep it that fits the path rather than fighting it**, and it is the better design:

```
the path never changes order                 what adapts is how much help a step carries

  1 → 2 → 3 → 4 → … → 17 → 18                 Q5 after a right answer to Q4:
                                                  Why does Seth doubt a faster computer
                                                  would ever be conscious?

                                               Q5 after a wrong answer, a skip, or a jump:
                                                  Seth ties consciousness to being alive.
                                                  Why does Seth doubt a faster computer
                                                  would ever be conscious?
```

Each question may carry a **premise**: one sentence stating what an earlier step established, which
this one builds on. It is shown **unless the reader has just shown they have it** — the previous
question on the path was answered and judged right. Get it right, and the next step asks you to
carry the thread yourself; get it wrong or skip, and the next step hands you the thread first.

Why this is right:

- **It keeps Greg's 2026-09-06 decision** (adaptive, no control) instead of silently superseding it
  with a request that did not mention it. Sol's point, and fair: the first draft had no mandate to
  delete it.
- **Adaptivity becomes pedagogical rather than a difficulty dial**: more scaffolding when it helps,
  less giveaway when it is not needed. Still no control, still nothing on screen that names a level.
- **The premise is a field, not a clause**, so the build-up is structural — the prompt has to state
  what each step leans on — and the display can decide when to show it. The first probe run without
  the field (`after-1`, below) mostly walked the article in document order with few questions
  leaning on anything: asking for "build on one another" in prose alone did not produce it.
- **It keeps the verdict machinery as it is** — `src/quiz-verdict.ts`, the `done` frame, the cost
  category — so nothing is retired and Sol's F7 (historical spend reclassified) does not arise.

**No difficulty control comes back**, in any form. The words `easy`, `medium`, `hard`, `harder`,
`easier`, `difficulty` and `level` still never reach the page, and the panel test that says so
stays.

## What changes

### The prompt (`QUIZ_SYSTEM`, `quiz/4` → `quiz/5`)

The prompt **is** the feature.

**Stays**, because none of it is about bands: one question mark / one thing asked, nothing answerable
without having read the piece, nothing about where something sits in the document, nothing the piece
leaves open, the reference answer as a draft not a key, the evidence rules, the parse rules,
`plainWords("ask", "explain")`.

**Goes:** `BAND`, `THE SPREAD IS NOT OPTIONAL`, `VALUE`, and `band`/`value` in the output.

**New — THE QUIZ IS A PATH:** decide the two to four takeaways privately first, and why each holds;
start with what the piece plainly says; each step leans on the ones before; end at the takeaways and
why they hold, each still one small step from the last.

**New — THE PREMISE:** optional, one sentence, stating something an **earlier** question on the path
asked for. Rules, each with a bad/good example:

- It is never this question's answer, nor a hint at it.
- The question must read as a whole question without it (it is sometimes hidden).
- It states an earlier step's answer, so it must not be the only place an earlier *unanswered*
  question's answer appears in the list — which is why the list never shows premises (below).
- **A premise does not make a big step small** (Sol F3's third leak): "Given X, why does the whole
  argument hold?" is still a leap. If the step from the premise to the answer is more than a
  sentence of thought, add the missing step.

**Changes:** up to **twenty**, fewer where the piece does not support twenty; the reference answer
one or two sentences; "stands on its own" becomes "reads as a whole question without its premise".

### The stage (`src/quiz.ts`, `src/types.ts`, `src/pipeline.ts`)

- `QuizQuestion` gains `premise?: string` and loses `band` and `value`; `QuizBand` goes.
- `toQuestions` reads `premise` (trimmed, dropped if empty; a premise equal to the question or
  containing the reference answer verbatim is removed rather than failing the question), stops
  requiring band and value, and **records how many dropped questions had an accepted successor** —
  a new `QuizDropped.gaps` counter, logged by the pipeline in place of the band counts.
- `orderQuestions`, `missingBandEnds`, `SPREAD_FROM`, the spread gate and its reader sentence
  `quizBandsNotSpread` go. **The order stored is the model's.**
- `MAX_QUESTIONS` 12 → 20. `ANSWER_TOKENS` 10 000 → 14 000 (the first probe: twenty questions in
  ~7.4k output tokens, thinking included, against a ceiling of answer + 40k thinking headroom).

**Sol F4 — a dropped mid-path question — is answered by counting, not failing, and that is an
overrule with a reason.** Sol proposed failing the batch whenever a dropped question has an accepted
successor. In the baseline runs **three of ten batches dropped a whole question** for an unfound
quote, so fail-closed would throw away roughly a third of paid batches — the 260903c failure again.
What limits the damage instead: the premise field carries a step's conclusion into its successor, so
a gap costs the reader the *work* of one step, not the ability to answer the next; and `gaps` makes
it visible, which Sol rightly said the existing totals could not. If `gaps` turns out to be common,
the next move is Sol's second option — predecessor ids and transitive drops.

### Wire compatibility (Sol F2)

- **An old client tab reading a new quiz** would call its ladder with `band: undefined` and throw on
  Next. The GET route therefore adds `band: "easy", value: 3` to every question that lacks them,
  **in the response only, never in the stored artefact**, with a comment dating its removal (a week
  after deploy). An old ladder given an all-`easy` batch walks it front to back — the path.
- **A new client reading an old (`quiz/4`) quiz** walks the stored band-sorted pool in order with no
  premises: easy first, as before, minus the ladder. The first draft claimed readers would be
  offered *Write them again*; that is false since 2026-09-29, when Greg decided `outdated` is not
  worth bothering the reader about (SPIDERYARN-READING2-55) and moved re-running to Metadata. So an
  existing quiz stays a pool until someone re-runs it. Accepted: it degrades to the pre-adaptive
  behaviour, not to anything broken, and forcing invalidation would contradict that decision.
- The `done` frame is unchanged.

### The walk (`src/web/QuizPanel.tsx`, `src/web/quiz-ladder.ts`)

- **Next goes to the next question in the array; Previous to the one before.** An index. "Question
  *n* of *N*" is the position on the path.
- `quiz-ladder.ts` becomes the premise rule: `showPremise(questions, index, verdicts)` — true unless
  the question before it on the path has a `right` verdict in this session. Verdicts are kept in
  React state by question id, set when a mark reaches `done`; never rendered, logged or stored, as
  now. No `.sort()`, as now.
- **Next still waits while a mark is arriving**, because the next step's premise depends on the
  verdict.
- **Show all N lists question stems only, never premises** (Sol F3): premises are earlier answers,
  and scanning the list must not answer rows the reader has not reached. Opening a question from the
  list shows its premise unless the rule above hides it.
- The premise is drawn as a quiet lead-in line above the question, not as part of it.

### Not changed

- `QUIZ_MARK_SYSTEM`. The marker is handed the question **with its premise, whether or not the
  reader saw it** — the premise is context the marker may use, never something it reveals, and
  this keeps the mark request's wire shape as it is. Shorter marks for shorter questions are
  deferred.
- `batchId`, the 409, the mark stream, answer-binding, dictation, "not stored", the verdict call.

## Measuring it

[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
through [`evals/quiz-build-up.ts`](../../evals/quiz-build-up.ts):

- **Five local articles**: *The Mythology of Conscious AI* (essay; the quiz eval's own article),
  *Revealing the Dynamics of Neural Information Processing…* (a paper, the kind the report came
  from), *Cargo Cult Science* (a talk), *How to Do Great Work* (a long essay), *Distributed
  Representations: Composition & Superposition* (a technical explainer).
- Production's own `generateQuiz`. **`before` and `before-2`** ran on commit `d9c5cec7`, before any
  prompt edit (the second is the control). `after-1` was a probe of the first prompt draft without a
  premise field and is kept, not judged. **`after`** runs on the built commit.
- **Screens** (`report`): count, mean words per question and per reference answer, reference answers
  over two sentences, questions containing " and ", share with a premise, drops and `gaps`, output
  tokens and elapsed time (Sol F8).
- **Blind pairs** (`pairs`): one per article, a whole quiz against a whole quiz, rendered as a
  skipping reader would see it (every premise shown — the worst case for giveaways). **Each pair
  carries a source pack** (Sol F5): the article's outline with its gists, and every evidence passage
  either quiz cites. A fresh subagent that reads only the pairs file judges *effort per question*,
  *builds up to the takeaways*, *fidelity*, and three giveaways — a question containing its own
  answer, a premise revealing an answer the reader has not reached, a premise bolted onto a step
  that is still a leap.
- **The eval refuses a partial comparison** (Sol F6): exact slug-set equality, unique slugs, five of
  them, arm names matching their directories, and `before`/`before-2` on the same prompt hash.
- `before` vs `before-2` is the control; `before` vs `after` is the result.

**What this cannot show**: five pairs is a handful, and the question count unblinds the judge. It is
enough to catch a regression and to see whether "builds up" happened at all, not to measure how much
better. Whether twenty is fatiguing is a question for readers after release.

## Stages

1. **Prompt, stage, wire, walk.** One stage, because the type change crosses the seam and nothing
   in between compiles. Tests red-first where behaviour is new: the premise rule, `gaps`, the
   route's compatibility fields, the list showing no premises.
2. **Measure.** `after`, screens, blind read; iterate the prompt if the read says so.
3. **Docs and bookkeeping.** `quiz.md` rewritten around the path (the band sections become a short
   "until 2026-09-30" note), the user-feedback note, this plan's status.

Sol reviews the code before the push.

## Deferred, named

- **Shorter marks for shorter questions.** `QUIZ_MARK_SYSTEM` untouched.
- **Showing the takeaways at the end** — a closing card. The prompt decides them privately;
  surfacing them is a new field, new UI, and a summary, which the product is careful with.
- **Predecessor ids and transitive drops**, if `gaps` is common.
- **Removing the route's compatibility fields**, a week after deploy.

## Simpler options passed over

- **Prompt only, ladder and sort kept.** Cheapest, and it cannot deliver point 3: the server would
  re-sort the chain by band and the ladder would hop across it.
- **A linear path with the ladder and verdict retired** — the first draft. Simpler code, but it
  deletes a behaviour Greg chose without his say, and the probe showed prose alone does not make the
  questions lean on each other.
- **Keep the pool, raise the count to twenty, shorten every question.** Delivers 1 and 2, not 3 or 4.

## Review log

**Round 1** (Sol, read-only, 2026-09-30): do not build; F1–F7 P1, F8 P2. F1 adopted (the design
above). F2 adopted (response-only compatibility fields; the `outdated` claim corrected). F3 adopted
(list shows stems only; premise rules; eval checks three giveaways). **F4 overruled** in favour of
counting — reason above. F5, F6, F8 adopted in the eval. F7 does not arise now that the verdict
stays; the pipeline's band log is replaced.
