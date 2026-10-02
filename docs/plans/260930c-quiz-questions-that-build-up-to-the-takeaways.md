# Quiz questions that build up to the takeaways

Research write-up: [docs/research/261002l-quiz-prompt-evals-easier-build-up-reading-goal-and-profile.md](../research/261002l-quiz-prompt-evals-easier-build-up-reading-goal-and-profile.md).

**Status: shipped on `dev`, 2026-09-30.** Plan reviewed twice by GPT Sol (round 1 "do not build", round 2 "build
with the listed fixes"), code reviewed twice (round 2 "do not ship" on a token budget that outlived the
job claim — fixed, § What the measurements said), browser-checked on the box. Written 2026-09-30 in `worktree-quiz-build-up`, from
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

Each question may carry a **premise**: one sentence restating the answer to **the question
immediately before it**, which this one builds on. It is shown **unless the reader has just shown
they have it** — they came here by Next from that question and were judged right on it — and it is
always shown in a batch with a gap in its middle (below). Get it right, and the next step asks you to
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

**New — THE PREMISE:** optional, one sentence, restating the answer to the question **immediately
before** (R2-1). Rules, each with a bad/good example:

- **It restates, and adds nothing** — no consequence, reason or inference, and above all not the
  next step, which is what this question asks for (R2-4: the paraphrased giveaway no string match
  can catch).
- **The question must be whole without it** — no "this", "that", "it", "the result", "given this"
  pointing back (R2-4: a stem like "why does that follow?" reads fine in an eval that always shows
  the premise, and is unreadable after a right answer).
- **A premise does not make a big step small** (Sol F3's third leak).
- The list never shows premises (below), because each is an earlier question's answer.

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
it visible, which Sol rightly said the existing totals could not. **Round 2 found the hole in that
argument** — a right answer on the step *before* the gap would hide the premise that bridges it —
and the smaller safeguard Sol offered is adopted: **a batch with any gap shows every premise.** The
trigger for escalating to predecessor ids and transitive drops: any batch in the `after` arm, or
more than one in ten production batches (the pipeline logs `gaps`), with two or more gaps.

### Wire compatibility (Sol F2)

- **An old client tab reading a new quiz** would call its ladder with `band: undefined` and throw on
  Next. The GET route therefore adds `band: "easy", value: 3` to every question that lacks them,
  **in the response only, never in the stored artefact.** An old ladder given an all-`easy` batch
  walks it front to back — the path. It stays until there is an enforceable client-version boundary,
  not for a week (R2-3): a tab can outlive any date.
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
- `quiz-ladder.ts` becomes the premise rule, `showPremise`: no premise → nothing; a batch with
  `gaps` → shown; hidden **only** when the reader arrived by Next from the question before and that
  question's verdict is `right`; shown otherwise (a list jump, Previous, a wrong or absent verdict).
  Verdicts are kept in React state by question id, set when a mark reaches `done`; never rendered,
  logged or stored, as now. No `.sort()`, as now.
- **Next still waits while a mark is arriving**, because the next step's premise depends on the
  verdict.
- **Show all N lists question stems only, never premises** (Sol F3): premises are earlier answers,
  and scanning the list must not answer rows the reader has not reached. Opening a question from the
  list shows its premise unless the rule above hides it.
- The premise is drawn as a quiet lead-in line above the question, not as part of it.

### Not changed

- `QUIZ_MARK_SYSTEM`. The marker is handed **the question alone, never its premise** (R2-2): the
  reader may not have seen it, and a marker told it was part of THE QUESTION would restate it. The
  question is whole without it by the prompt's rule. Shorter marks for shorter questions are
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
  *builds up to the takeaways*, *fidelity*, four giveaways — a question containing its own answer, a
  premise revealing an answer the reader has not reached, a premise bolted onto a step that is still
  a leap, a premise that adds the next step — and *alone*: is every question understandable with its
  premise hidden, as a reader who got the last one right sees it (R2-4).
- **The eval refuses a partial comparison** (Sol F6): exact slug-set equality, unique slugs, five of
  them, arm names matching their directories, and `before`/`before-2` on the same prompt hash.
- `before` vs `before-2` is the control; `before` vs `after` is the result.

**What this cannot show**: five pairs is a handful, and the question count unblinds the judge. It is
enough to catch a regression and to see whether "builds up" happened at all, not to measure how much
better. Whether twenty is fatiguing is a question for readers after release.

## What the measurements said

All arms, screens and blind reads are in [`evals/results/quiz-build-up/`](../../evals/results/quiz-build-up/).

| arm | prompt | questions per quiz | ref. answer words (mean of means) | steps with a premise | gaps |
|---|---|---|---|---|---|
| `before`, `before-2` | `quiz/4` | 10–12 | ~48 | — | — |
| `after-1` (probe, no premise field) | first draft | 19–20 | ~29 | 0 | — |
| `after` | premise field, round-2 rules | 17–20 | ~30 | 9–16 | two batches with one each |
| `after-2` | + "a premise that says what no question asked means a missing step" | 15–20 | ~33 | 5–19 | none |
| `after-3` (shipped; 3 articles) | + "context is not a premise" | 17–19 | — | — | — |

**Blind reads**, each by a fresh Opus subagent that saw only the pairs file (with the source pack):

- **Control, `before` vs `before-2`:** effort went 4–0–1 to one side and build-up 3–1–1, and the judge
  said *"none of the ten quizzes really builds up; each is a set of standalone recall questions"*.
  So on five pairs a 4–0 split is noise.
- **Result, `before` vs `after`:** `after` won **effort 5/5 and build-up 5/5**, and the judge traced a
  concrete build sequence through every new quiz. Given the control's 4–0, the count alone is weak;
  the qualitative difference — standalone recall versus a traced route — is the stronger signal.
  The recurring defect: in three quizzes a premise stated something no question had asked.
- **The premise fix, `after` vs `after-2`:** the judge misread the pair-1 premises (it took Q1's
  restated answer, printed above Q2, as Q2's own answer; checked by hand), so its pair-1 count is
  discarded. On the other four, `after-2` had fewer stray premises in three and **far more on the
  dense paper** (*Revealing the Dynamics…*): there the model uses premises to set context ("the
  researchers applied PID to thousands of triads …") rather than to restate, and one previews half
  of its own question's answer. Shipped anyway: the essays improved, the paper's context-premises
  still leave each stem readable on its own, and a sixth noisy five-pair round would not settle it.
  **Known limitation, named for the next pass:** on dense papers the premise drifts from
  restatement to context; the reader Greg reported from was on a paper.

**Sol's code review rated the dense-paper drift P1** (W1), so it got one more pass rather than an
overrule: a rule that **context is not a premise** — a scene-setting fact goes briefly into the
question or becomes its own step. `after-3`, on the paper, *A landscape of consciousness* and the
Olah explainer, not blind-judged (my count, reading the paper's quiz): scene-setting premises on the
paper fell from about **15 of 19** (the blind judge's count on `after-2`) to about **5 of 14**. One of
the five reproduces the prompt's own BAD example almost word for word. **Improved, not solved** —
and it goes to Greg as a named limitation rather than a quiet overrule: on a paper, some premises
still set context, which a reader who is doing well never sees, and whose question then names a
setting they were not given.

**The budget did not hold, and that was the most useful thing `after-3` found.** *A landscape of
consciousness* spent **48,896 output tokens, thinking included, against a 54k ceiling**, over 7.5
minutes; the other articles stayed under 16k. The path prompt plans before it writes, and a long
paper plans at length. The first response was to give the quiz 64k of thinking room (ceiling 78k).
**Sol's round-2 code review (D1, P1) showed that was unusable**: a call that fills 78k streams for
about 1,027 s, and a job claim ends at 740 s, so the job would be killed and the paid call lost
anyway. So the ceiling stays at 54k (~711 s, which fits), exported as `QUIZ_MAX_TOKENS`, and
`STEP_BUDGET_MS.quiz` — how much claim time must be left before the step may start — goes from
150 s to **600 s** (the 452 s worst, rounded up; twice the worst no longer fits in a claim). A test in
`tests/jobs-lease-budget.test.ts` binds both to the claim, red first. **The residual risk is named:** a
paper that needs more planning than 54k tokens fails with a truncation, and the fix for that is a
smaller job, not a bigger number. Watch the pipeline's `outputTokens` for quiz jobs on long papers.

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
- **Removing the route's compatibility fields**, once there is a client-version boundary to hang it
  on.

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

**Round 2** ([review](260930c-quiz-questions-that-build-up-to-the-takeaways-review-sol-2.md);
build with the listed fixes; no P0s): F3, F5, F6, F7 resolved; F4's overrule accepted as sound with
an incomplete mitigation. **R2-1 (P1)** adopted: premises restate only the immediately preceding
answer; hidden only on arrival by Next after a right verdict; always shown in a batch with gaps.
**R2-2** adopted: the marker gets the stem only (the first build had prepended the premise; reverted).
**R2-3** adopted: the compatibility fields have no removal date. **R2-4 (P1)** adopted: "adds
nothing" and the backward-pointer ban, with examples, and the eval's *alone* judgement. **R2-5**
adopted: the eval refuses a new arm without its token and budget fields; the three older arms show
a dash. The `after` arm was restarted on the revised prompt; a half-run on the round-1 prompt was
stopped and discarded.

**Code review round 1** ([review](260930c-quiz-questions-that-build-up-to-the-takeaways-code-review-sol.md);
write-capable): C1 (a replaced batch's verdict could be recorded into the new one) and C2 (the
retired `[quiz-spread]` code) fixed red-first by the reviewer and committed; W1 (P1, dense-paper
premises) got the "context is not a premise" rule; W3 adopted; W2 (the source pack silently omits a
cited block no longer in the article, and is not bound to the generating revision) noted, not
fixed — the eval reads the local database read-only, and the five articles did not change during
the run.

**Code review round 2** ([review](260930c-quiz-questions-that-build-up-to-the-takeaways-code-review-sol-2.md)):
"do not ship" on D1 (P1, a 78k ceiling outliving the 740 s claim) — fixed as above; D2 moot once
the custom room went. Sol judged the residual dense-paper premise drift acceptable to ship, named.
[Narrow check of the D1 fix](260930c-quiz-questions-that-build-up-to-the-takeaways-code-review-sol-3.md):
fixed.

**Browser check** (Sonnet subagent, Playwright on the box, this worktree's own dev server): all six
checks passed at 1280 and 390 wide — the linear walk, the premise line, stems-only list, the premise
hidden after a right answer then Next, no difficulty words, no JS errors. One oddity noticed in a
mark: a stray code-styled chip reading `cvyfqe`, which looks like a block id rendered by
`CitedText`; the marking prompt and renderer are untouched here, so it is left for a separate look.

**Landing gates**, after merging `origin/dev`: typecheck exit 0; the full suite 1,229 files passed, 3
failed — `fleet-composed-access`, `fleet-decisions-route` and `fleet-reports-route`, each of which
starts the fleet server from a build this fresh worktree does not have (the log's own words: *"startFleetChild
FAILS without a build"*), unrelated to this change.

