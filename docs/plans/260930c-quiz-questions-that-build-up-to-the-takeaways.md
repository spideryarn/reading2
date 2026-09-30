# Quiz questions that build up to the takeaways

**Status: planned, awaiting plan review.** Written 2026-09-30 in `worktree-quiz-build-up`, from
[SPIDERYARN-READING2-5W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-5W) (report
`spya-jc2ub9`, an admin suggestion from Greg's own account, provenance checked by
`scripts/feedback-reporter.ts`, exit 0).

Context: [quiz.md](../project/quiz.md) · the earlier report
[260905_1800](../user-feedback/260905_1800-quiz-questions-too-hard.md) and Greg's decision there ·
[260907d](260907d-make-the-quiz-adaptive.md), the adaptive ladder this plan retires ·
[prompting-guide.md](../project/prompting-guide.md).

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

## The one thing this collides with, and the call

The quiz today is **a pool, not a path**. The server sorts twelve independent questions by band
(`easy` → `medium` → `hard`), then value, then position in the document; since 2026-09-07 the client
walks that pool **adaptively** — a right answer steps up a band, a wrong one steps down — with a
hidden right/wrong verdict from a second, small model call per answer.

A sequence whose questions build on one another cannot be walked that way. Question 6 leans on
question 5; a ladder that jumps from an `easy` question to the first unseen `hard` one skips the
steps that make the `hard` one small. The two designs want different things from the order:

```
today — a pool, walked by a ladder          asked for — a path, walked in order

   easy   ● ● ● ● ●                          1 → 2 → 3 → 4 → … → 17 → 18
   medium ● ● ●          ← right: step up      small steps, each leaning on the last,
   hard   ● ● ●          → wrong: step down    arriving at the takeaways and why
```

**The call: the path replaces the ladder.** The quiz walks the model's sequence in order; the ladder
and its hidden verdict are retired. Reasons:

- **Adaptivity was a means, and the path reaches its end by construction.** Greg chose the ladder on
  2026-09-06 to get *"start easy, stay at the right level"* without a control. A path of small steps
  starts easy because every step is small, and it stays at the right level because the difficulty is
  carried by the sequence rather than by any one question.
- **Keeping both is not a smaller version of either.** Adapting within a chain would need a new idea
  of what "easier" means there (repeat a step? insert a scaffold? skip one?) and a second structure
  on each question to support it. That is the kind of machinery "simplest version first" says to
  wait for evidence on.
- **It removes a model call per answer**, and the one piece of hidden per-reader judgement the
  feature carried.

**No difficulty control comes back**, in any form: no slider, no band on screen, no "easier / harder"
anywhere. Report 21's decision stands. The words `easy`, `medium`, `hard`, `harder`, `easier`,
`difficulty` and `level` still never reach the page, and the panel test that says so stays.

**This is the product trade-off in this plan, named so Greg decides it rather than inherits it.**
A reader who already knows the piece cold now walks the same small steps as one who does not; under
the ladder they would have been stepped up. *Show all* is still there for that reader, and so is
Next without answering. If that turns out to matter, the deferred version is below.

## What changes

### The prompt (`QUIZ_SYSTEM`, `quiz/4` → `quiz/5`)

The prompt **is** the feature, so this is most of the work. What goes, what stays, what is new:

**Stays**, because none of it is about bands: one question mark / one thing asked (with its examples),
nothing answerable without having read the piece, nothing about where something sits in the
document, nothing the piece leaves open, the reference answer as a draft not a key, the evidence
rules, the parse rules, `plainWords("ask", "explain")`.

**Goes:** `BAND`, `THE SPREAD IS NOT OPTIONAL`, `VALUE` and the `band`/`value` output fields. Their
job was to feed a sort; there is no sort.

**New — THE QUIZ IS A PATH.** In the prompt's own register:

- Decide first, privately, the two to four things a reader should come away with — the takeaways —
  and why each holds. The quiz is the route there.
- Walk it in small steps. Early questions are about what the piece plainly states; each later one
  leans on what the earlier ones established. The last few ask the reader to put the steps together
  into the takeaways, and into why they hold. Even those are one small step from the question before.
- **Every question is answerable in a sentence or two, without effort**, by a reader who has answered
  the ones before it. If a question needs the reader to stop and work something out, it is two
  questions — ask the first.
- **A later question may state, as its premise, what an earlier question established** — *"Given
  that the author thinks X, why does …?"* — which is how the steps stay small. It must never contain
  its own answer. (That is the old "never put the answer in the question" rule, narrowed: a premise
  from an earlier step is not a giveaway, it is the build.)
- Keep it about what matters. The path goes through what the argument leans on; a detail nothing
  rests on is a detour.

**Changes:** *"up to twelve"* → *"up to twenty, fewer where the piece does not support twenty"*; the
reference answer *"two or three sentences"* → *"one or two"*; "It stands on its own. The reader sees
the question and nothing else" → "the reader sees this question and the ones before it".

**Why twenty and not more.** Greg said "more", and "a whole bunch". Twenty is two thirds more than
today, fits one answer budget comfortably, and is a ceiling — a short piece still gets a short quiz.
It is a constant; if the eval or a reader says the path is too short to reach the takeaways, it moves.

### The stage (`src/quiz.ts`, `src/types.ts`)

- `QuizQuestion` loses `band` and `value`; `QuizBand` goes. Stored quizzes still carry the fields in
  their JSON, which is harmless — nothing reads them, and every one of those quizzes is `outdated`
  after the version bump anyway, so its reader is offered *Write them again*.
- `toQuestions` stops requiring band and value.
- `orderQuestions`, `missingBandEnds`, `SPREAD_FROM`, the spread gate in `buildQuiz` and its reader
  message `quizBandsNotSpread` go. **The order stored is the model's order**, which is the path.
- `MAX_QUESTIONS` 12 → 20; `ANSWER_TOKENS` sized for twenty shorter questions (the stage runs with
  adaptive thinking inside the same budget, so it goes up rather than down: 10 000 → 16 000).
- **A question dropped in validation leaves a gap in the path.** Accepted: the premise rule means a
  later question restates what it leans on, so a missing step makes the walk steeper by one step,
  not unanswerable. The drop counts already on the artefact are how we would see it happening often.

### The walk (`src/web/QuizPanel.tsx`, `src/web/useQuiz.ts`)

- **Next goes to the next question in the array; Previous to the one before.** An index, as it was
  before 2026-09-07. "Question *n* of *N*" is then the position on the path, which is what it looks
  like it means.
- *Show all N* stays, and picking from it jumps there. **The list shows later questions, whose
  premises are earlier answers** — a reader who opens it sees some answers in the premises further
  down. Accepted: the list is an explicit "show me everything", and hiding rows would be a second
  mechanism for a reader who chose to look.
- Next no longer waits for a mark to finish: it waited only so the verdict could land.

### Retired

- `src/web/quiz-ladder.ts` and `tests/quiz-ladder.test.ts`.
- `src/quiz-verdict.ts`, `tests/quiz-verdict.test.ts`, the `verdict` on the mark's `done` frame, and
  `QuizVerdict`. Its registrations (`ai-call.ts`, `cost-categories.ts`, `models.ts`,
  `plain-words.ts`' exempt list) go too, **unless** historical spend rows need the category name to
  stay readable — the build checks that before deleting it, and keeps the name if they do.
- `evals/quiz.ts` loses its band counts and the verdict labels on its marking cases; the marking half
  is otherwise untouched.

### Not changed

- `QUIZ_MARK_SYSTEM`. Shorter questions may want shorter marks, but the marking prompt's tone is the
  most-measured thing in this feature and a change to it is its own piece of work. Deferred below.
- `batchId`, the 409 on a replaced batch, the mark stream, the answer-binding, dictation, "not
  stored".

## Measuring it

[prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change),
through a new [`evals/quiz-build-up.ts`](../../evals/quiz-build-up.ts) shaped on
`evals/plain-words/run.ts`:

- **Five local articles** of different kinds: *The Mythology of Conscious AI* (essay, the quiz eval's
  own article), *Revealing the Dynamics of Neural Information Processing…* (a paper, the kind the
  report came from), *Cargo Cult Science* (a talk), *How to Do Great Work* (a long essay), *Distributed
  Representations: Composition & Superposition* (technical explainer).
- Production's own `generateQuiz`. **`before` and `before-2`** on the commit before the prompt edit
  (the second is the control), **`after`** on the commit with it. Each run records a hash of
  `src/quiz.ts`.
- **Screens** (`report`): questions per quiz, mean words per question and per reference answer,
  reference answers over two sentences, questions containing " and ".
- **Blind pairs** (`pairs`): one pair per article, a whole quiz against a whole quiz — the change is
  to the shape of the sequence, which one question cannot show. A fresh subagent that reads only the
  pairs file judges *effort per question*, *does it build up to the takeaways*, *fidelity* and
  *giveaway* (an answer inside its own question — the risk the premise rule creates). `before` vs
  `before-2` is the control; `before` vs `after` is the result.
- **Read the outputs anyway**, for the premise rule turning into giveaways, and for the path arriving
  at the takeaways or merely stopping.

**What this cannot show**, said now: five pairs is a handful, and the question count will often
unblind the judge. It is enough to catch a regression and to see whether "builds up" happened at all;
it is not a measurement of how much better.

## Stages

1. **Prompt and stage.** `QUIZ_SYSTEM`, the stage and types, `tests/quiz.test.ts`, the eval run.
   Gate: `npm test` on the quiz suites, `npm run typecheck`, the eval's screens and blind read.
2. **The walk, and retiring the ladder and verdict.** Panel, hook, mark stream, registrations, tests,
   `evals/quiz.ts`. Gate: quiz suites, typecheck, lint on touched files, and a browser check that the
   walk goes 1 → 2 → 3 and Previous goes back.
3. **Docs and bookkeeping.** `quiz.md` rewritten around the path (the ladder sections become a short
   "until 2026-09-30" note with a link to 260907d), the user-feedback note, this plan's status.

Sol reviews this plan read-only before stage 1, and the code before the push.

## Deferred, named

- **Adapting within the path.** If a reader who knows the piece finds the small steps slow: let a
  right answer skip the next step where the model marked it as a stepping stone. Needs a per-question
  flag and the verdict back. Wait for a reader to say so.
- **Shorter marks for shorter questions.** `QUIZ_MARK_SYSTEM` untouched; revisit if marks now dwarf
  the questions they answer.
- **Showing the takeaways at the end** — a closing "what this path was building to" card. The prompt
  decides the takeaways privately; surfacing them is a new field and a new piece of UI, and it would
  be a summary, which the product is careful with.

## Simpler options passed over

- **Prompt only, ladder kept.** Ask for smaller, building questions and leave the sort and the
  ladder alone. Cheapest, and it cannot deliver point 3: the server would re-sort the chain by band
  and the ladder would then hop across it.
- **Keep the pool, raise the count to twenty, shorten every question.** Delivers 1 and 2, not 3 or 4.
