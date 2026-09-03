# Fix the quiz build's band-spread cliff, and the answers it forgets

Greg filed a bug report from production on 2026-09-03 (feedback `spya-z6daky`, kind *problem*, on
`/read/nagel-bat?mode=remember&remember=quiz`). The report's own text is lost — see § The report we
could not read — so this plan is built from the Vercel logs of the same session, which are
unambiguous.

Then, while this plan was being written, Greg found a second one:

> I had answered one of the questions, and was on Question 2. Then I switched away from the article
> and came back, and it seems to have forgotten my answer to Question 1!
>
> — Greg, 2026-09-03

Both are in Quiz mode ([quiz.md](../project/quiz.md), the half of
[remember-mode.md](../project/remember-mode.md) where the article asks). They are unrelated
mechanically, so they are separate stages.

## What happened, from the logs

Production, deployment `dpl_419KZguSZEeMgEvHLUrCz2Z78Dga`, all times UTC:

| time | event |
|---|---|
| 02:48:11 | `GET /api/quiz/nagel-bat` → **404**, no quiz yet |
| 02:48:14 | quiz build job `spya-hu6m2e` queued, `steps: ["quiz"]`, `forced: ["quiz"]` |
| 02:48:51 | **job failed** after 36.2s and $0.0613 of model spend |
| 02:48:55 | `GET /api/quiz/nagel-bat` → 404 again |
| 02:48:58 | Greg pressed the button again — job `spya-xt5kmm` |
| 02:49:40 | succeeded: 11 questions, easy 3 / medium 4 / hard 4, 40.7s, $0.0675 |
| 02:53:15 | Greg filed the report |
| 02:54:13 | `POST /api/quiz/nagel-bat/mark` → 200, an answer marked |

The failure:

> The batch does not use both ends of the band scale, so the reader would meet 9 questions in an
> order that means nothing. wanted 2 "hard", got 1. A batch of this size has to carry both ends —
> src/quiz.ts § bandQuota. Run it again; if it keeps landing here, the prompt's spread rule is the
> thing to change.

## The three defects behind that one line

**1. The gate is stricter than its own error message claims, and rejection is disproportionate.**
[`bandQuota`](../../src/quiz.ts) is `min(3, floor(kept / 4))`, measured against what survived
validation, and [`quotaShortfall`](../../src/quiz.ts) throws if either end is short
(`src/quiz.ts:530-539`). At 9 survivors it wants 2 hard; the model produced 1.

Note the gap between the code and its own error message. The sentence says *"does not use both ends
of the band scale"* and *"has to carry both ends"* — that is a **floor of one**. The code demands a
**proportion**. The prose is the intent; the arithmetic is not. Sol's review put the essential point
better than the plan's first draft did: the rejected batch **still satisfies the ordering's real
invariant** — it carries both ends — and rejecting it discards a paid 36-second call. The
consequence is out of proportion to the defect.

What the ordering actually does, checked rather than assumed: questions are sorted once by band,
then value, then document position (`src/quiz.ts:453`), and the panel preserves that stored order
(`src/web/QuizPanel.tsx:18`). So the worst a floor-of-one batch produces is nine easy questions
followed by one hard — an abrupt progression, but a real one. (The `rank=prioritised` and
`order=prioritised` in Greg's URL are Quotes and Search respectively; Quiz consumes neither.)

There is a threshold smell too, reproduced by Sol running the exported functions directly:

```
7 questions, one hard: []
9 questions, one hard: [{ band: "hard", want: 2, have: 1 }]
```

Adding two valid non-hard questions to a passing seven-question batch makes it fail. That is
supporting evidence rather than proof — sample-size rules legitimately have thresholds — and **the
plan's first draft overstated it as plain non-monotonicity, which is false.** Batches of three or
fewer are deliberately exempt (`bandQuota(3) === 0`, `tests/quiz.test.ts:166`), so three medium
questions pass and a fourth medium fails. Any rule keeping that exemption — and it should, since
demanding a spread from a *three*-question article is an instruction to pad — is monotonic only
among batches of four or more. That narrower claim is the true one.

The prompt (`src/quiz.ts:720-735`) disagrees with both: it demands a flat 3 of each in a full batch,
and tells the model that a failing batch means *"the article is asked again"*, which is false —
nothing retries.

Introduced by `5253ee32` (1 Sep 2026, stage 1 of
[260831al](260831al-review-quiz-sub-mode.md)) with `min(3, floor(n/4))` in its first line, and never
changed. Diagnosis put the failure rate at roughly 10–25% — 1 in 4 of the recorded generations.

**It is not true that this was never cross-family reviewed**, as the plan's first draft claimed. The
prior review *recommended* a band quota
([260831al review:135](260831al-review-quiz-sub-mode-review-sol.md)) and the implementation had a
full-file review afterwards. What went unchallenged was the specific `min(3, floor(n/4))` boundary —
which is a more interesting failure than "nobody looked", and the postmortem should say so.

**2. Nothing retries, at any layer.** Not the generator, the step, the job runner, the SDK
(`maxRetries: 0`), the queue, or the client. [`src/labels.ts`](../../src/labels.ts) is the one stage
that does retry a short batch and quiz did not copy it; both the plan and the introducing commit
said a generic retry belonged in `src/jobs.ts`, and it was never built.

And there is no retry *affordance*: [`JobProgress.tsx`](../../src/web/JobProgress.tsx) draws its
ordinary run button again after a failure and never consults `retryable`, unlike the shelf's job
card (`AddArticle.tsx:477-486`). Greg recovered by guessing.

**3. The developer's sentence is what the reader reads.** The path has no sanitiser on it:

```
src/quiz.ts:530  throw new Error(…)
  → src/jobs.ts:696   const message = (err as Error).message
  → src/jobs.ts:740   job.error = message
  → src/store/pg-jobs.ts:140   persisted and read back unchanged
  → src/web/useStepJob.ts:372  return mine.error ?? "The job failed."
  → src/web/JobProgress.tsx:230  rendered, in red, under the run button
```

So a reader was shown a source-file reference and an instruction addressed to whoever tunes the
prompt. That breaks rules 1 and 3 of [copy.md](../project/copy.md) — no bracketed code, names a file
they cannot open, and says nothing they can act on.

### This is the third time, and the class has a name

This is not a wording slip. [`src/messages.ts:600-620`](../../src/messages.ts) records that **six**
pipeline stages leaked provider prose to the screen through this exact seam, closed on 2026-08-26,
with the lesson stated as *"grep the genre, not the list"*
([260826m](260826m-simplification-audit.md)). [copy.md:238-253](../project/copy.md) records
`truncatedMessage` in [`src/token-budget.ts`](../../src/token-budget.ts) as the same shape,
deliberately *"recorded rather than fixed"*, because **the same string has two audiences** and
splitting it was judged bigger than a reword.

The band-spread message is the third instance, and it was written *after* both were documented. A
seam that has produced eight leaks is not going to stop producing them because a ninth author reads
a doc. **Stage 2 splits the audiences at the seam** so the next author cannot make this mistake by
default — which is what [engineering-manager.md](../reusable/engineering-manager.md) bug-mode means
by rearchitecting so the class cannot recur.

The machinery already exists and was built for exactly this: `ReaderFacingFailure` and its
constants in [`src/messages.ts`](../../src/messages.ts), and
[`stageFailure(kind, message)`](../../src/job-failure.ts).

## The simpler option this passes over

**Retry once inside the step, and change nothing else.** It is one `if`, it keeps the proportional
guarantee, and it would have saved Greg's session. Rejected as the *primary* fix because it treats a
1-in-4 failure as weather: it pays a second $0.06 call and another 40 seconds to satisfy a rule that
is measuring the wrong thing, and the non-monotonicity stays — a batch that fails twice still fails,
and a reader with a short article still meets a cliff that a shorter article would not have. Fix the
rule first; retry stops being the load-bearing part.

**Not doing:** trimming surplus questions until the quota is satisfiable. It works and it is
deterministic, but it throws away questions we have already paid for in order to satisfy a rule we
are about to admit is wrong.

## Stages

Each ends with the suite green and the tree safe to commit.

### Stage 1 — make the gate mean what its sentence says

- **The gate becomes presence at each end**, not a proportion: at least one `easy` and one `hard`.
- **Delete the numeric abstraction rather than retune it.** Sol's best structural suggestion:
  replace `bandQuota` / `quotaShortfall`'s `want`/`have` arithmetic with
  `missingBandEnds(questions): QuizBand[]`. A helper that returns *which ends are missing* cannot
  quietly grow back into a proportional quota while still sounding like a presence check. The
  numeric representation is precisely what let the prose and the arithmetic diverge, so removing it
  is the fix for the class, not just for the value.
- **Keep the short-batch exemption** — batches too short to carry both ends are asked for nothing,
  as today (`bandQuota(3) === 0`, so the boundary is at four). Demanding a spread from a
  three-question article is an instruction to pad, which `260831al` decided against on purpose.
  State the boundary explicitly in the code as a named constant rather than letting it fall out of
  `floor()`, which is how it came to be somewhere nobody could see or challenge.
- Keep measuring against survivors — that part was right.
- **The prompt keeps asking for three of each.** Sol is right that lowering the ask to one would
  turn the emergency floor into the normal distribution. The prompt states a target; the gate
  enforces a floor; the two are allowed to differ as long as the prompt does not call the target a
  condition. Fix only the false consequence: drop *"is thrown away whole and the article is asked
  again"*, which describes a retry that does not exist.
- **No `PROMPT_VERSION` bump.** The contract is "changes what a *question* is" (`src/quiz.ts:152`),
  and the requested distribution is unchanged — only a false statement about what happens on
  failure is removed. Bumping would mark every existing quiz `outdated` and invite a paid rebuild of
  each, for a wording fix. Worth stating because it is the kind of call that gets made silently.
- The spread we *wanted* stays in the log line, which already carries `easy`/`medium`/`hard` counts,
  so drift in the model's spread stays visible without being fatal. Count, don't gate — the choice
  this same feature already made for the marking prompt's banned words.
- **Failing tests first**, table-driven per Sol: for every gated size, a batch with exactly one easy
  and one hard has no shortfall; for every gated size, a batch missing either end fails; and the
  short-batch boundary explicitly. Plus the reported case — 9 questions, 1 hard — red before, green
  after.

Done: `npm test`, `npm run typecheck`, `npm run check` green; the new tests red before, green after.

#### What stage 1 actually landed, 2026-09-03

`bandQuota` and `quotaShortfall` are deleted. `missingBandEnds(questions): QuizBandEnd[]` is the
gate, `SPREAD_FROM = 4` is the named boundary, and `QuizBandEnd` is
`Extract<QuizBand, "easy" | "hard">` — narrower than the plan's `QuizBand[]`, so nothing downstream
can write a branch for a `medium` that cannot arrive.

The failing test reproduces production byte-for-byte: nine survivors, one `hard`, and the old error
string from the Vercel log. 62 tests in `tests/quiz.test.ts`, 118 across the quiz-adjacent files.

**Two things GPT Sol's stage-1 review changed**, both reproduced by it rather than reasoned to:

- **The first reader message was false.** It called `fresh.length` — the *survivor* count — what the
  AI "wrote", so twelve questions with seven dropped reported *"The AI service wrote 5 questions"*.
  It now reads: *"Of the questions written for this article, 5 survived checking against it — but
  there is no hard one among them to finish on, so they would not cover the full range from easier
  to harder. Writing the questions again usually gets a better spread."* The wording borrows the
  panel's own adjacent sentence so a reader who meets both gets one vocabulary, and the test that
  pins it now includes the twelve-sent-five-survived case, which is what makes the survivor wording
  load-bearing.
- **The prompt says less than the first draft did.** The draft disclosed the gate's floor, which
  sits in the same paragraph as "must contain at least three" and gives the model two definitions of
  *not optional* — Sol's point being that revealing the lower floor makes one-per-end look
  sufficient. The floor is now withheld deliberately.

**The implementer pushed back on my instruction here and was right.** I asked for the minimal edit —
remove only the false *"the article is asked again"*. But the clause it sat in, *"is thrown away
whole"*, **was true before this stage and false after it**: the gate no longer refuses a full batch
for having two of an end instead of three. The minimal edit would have traded one false sentence for
another. The whole consequence clause went instead, leaving a directive to the model rather than a
claim about our machinery — which is the thing that went stale within a day of being written.

`missingEndsInReaderWords` returns `string | null` rather than assuming a non-empty input, which
also collapses a guard that was being written in two places that could have disagreed.

#### Deferred, on purpose: the cap can manufacture a spread failure

Sol reproduced it: `toQuestions` keeps the first twelve survivors **in the model's order**
(`src/quiz.ts:481`), so a response of thirteen valid questions whose only `hard` one is thirteenth
loses it to the cap, and the gate then refuses the batch for missing an end the model did supply.
Real, pre-existing, and it contradicts the intended "over-cap degrades rather than fails" behaviour.

Not fixed, because the fix is not small: moving the gate above the loop would be wrong (the stored
twelve would still lack an end), so it needs *cap selection* that preserves one of each end. Nothing
has shown it is needed — the prompt asks for at most twelve, so it only fires when the model
overshoots. A comment at the cap records the mechanism, why the obvious fix is not one, and the
trigger to watch for: `dropped.overCap` non-zero on a run that also failed on bands.

### Stage 2 — split the two audiences at the seam

- A step's failure carries **two strings**: the developer one on `Error.message` (log and Sentry,
  keeping the band arithmetic and the file reference) and a reader one that `src/jobs.ts` copies
  onto `step.error` / `job.error` (`src/jobs.ts:696`, `:730`, `:740` — all three).
- Built on `ReaderFacingFailure` + `stageFailure`, not a new mechanism. A declared step failure
  carries a whole `ReaderFacingFailure`, keeping `kind` and reader message together, which is what
  that type is already for (`src/messages.ts:61`).
- Add the band-spread reader message, with a bracketed code, saying what the reader can do.
- **The fallback is option (a): everything undeclared gets safe generic copy.** Sol's reasoning,
  which I accept: losing useful detail on unmigrated bands is temporary and recoverable, publishing
  an unaudited internal or upstream string is neither, and the diagnostic still reaches the log and
  Sentry — only the *persisted reader copy* changes.
  - An **allowlist was rejected**: one new throw inside an "approved" step leaks immediately.
  - **Type-level enforcement is not actually available.** TypeScript has no checked throws, so
    `PipelineStep.run()`'s signature cannot constrain what is thrown (`src/pipeline.ts:662`). A
    `Result` return could, but unexpected exceptions would still need the generic fallback, and
    migrating every step is disproportionate. Worth writing down so the next person does not spend
    an afternoon rediscovering it.
  - The generic fallback is a **total map keyed by `failureKindOf(err)`**, unknown mapping to retry
    per the existing compatibility rule (`src/job-failure.ts:105`) — so a reader is not told to try
    again under a failure stored as `ours` or `bug`.
  - **Migrate shared error constructors first** — `anthropicCallFailed` and `truncationFailure` —
    rather than whole steps. One change there preserves good copy across many bands at once.
  - **"Developer-facing" still means safe to log.** Do not restore the Anthropic SDK body to
    `Error.message`; it can echo article prose and its removal is deliberate
    (`src/anthropic-call.ts:12`).
- **`useStepJob` keeps a typed terminal failure** — `{ message, retryable }` — instead of reducing
  to a string at `src/web/useStepJob.ts:369`. Making retryability a **required** prop on
  `JobProgress` turns "wire up the other seven bands" into a list the compiler produces, which is
  the difference between fixing the seam and fixing this band.
- Give `JobProgress` the retry affordance the shelf card already has (`AddArticle.tsx:477-486`).
- Pass `starting` through `useQuiz` → `QuizPanel` (`IdeasPanel.tsx:156` already does), so the button
  is not re-armed between the press and the first poll.
- **Failing test first**, and it inspects the **persisted `job.error` and `step.error`**, not only
  rendered HTML — `JobProgress` and the shelf deliberately render different fields, so a DOM-only
  test would pass while the leak survived in the other. Plus a positive control: a declared reader
  message survives intact and its `kind` controls retryability.

Done: as stage 1, plus the leak test red before the change.

#### What stage 2 actually landed, 2026-09-03

**The seam.** `stageFailure` gained a second form — `stageFailure(failure, detail)`, taking a whole
`ReaderFacingFailure` — and `readerFailureOf(err, stepLabel)` is what `src/jobs.ts` now writes onto
`step.error`, `job.error` and a cancelled job's error. The fallback is `stepGaveUp` in
[`src/messages.ts`](../../src/messages.ts): a total map over `FailureKind`, four sentences, each
naming the failed step and nothing else. `Error.message` is untouched and goes to the log — and to
Sentry only where a throw site has claimed it, which is the subject of the next-but-one paragraph.

**Migrated, so they keep their copy across the seam:** `anthropicCallFailed` (ten stages),
`truncationFailure` (eight), the ten `MODEL_REFUSED` throw sites, `TooLongForOnePass`, the upload
refusals in `src/pipeline.ts`, and both of the quiz's own refusals — the band spread as
`quizBandsNotSpread` with `[quiz-spread]`, and the every-question-unanchored case as
`QUIZ_NOTHING_ANCHORED` with `[quiz-unanchored]`. The quiz wording is unchanged from stage 1's
reviewed version.

**One thing the plan did not anticipate, whose first fix was worse than the problem.**
`authored` in [`src/monitoring-scrub.ts`](../../src/monitoring-scrub.ts) sends an `Error.message` to
Sentry **only** when `kindOfMessage` finds a registered bracketed code at the end of it. Moving the
reader sentence off `Error.message` therefore moved the code off it too — so every migrated
failure's diagnostic is withheld from Sentry, which is the surface that exists for failures nobody
is watching.

The first fix appended the reader sentence's code to the diagnostic, so it would look authored. That
was wrong, and the way it was wrong is the thing to remember: **`authored` does not ask "is there a
code", it treats a registered code as proof that we wrote the whole string**, which is why
`sanitise` then forwards it verbatim. Appending one lets any text buy that proof, and a step's
detail is free text — the place a provider body or a stretch of the article turns up. GPT Sol
reproduced `stageFailure(MODEL_REFUSED, "ARTICLE_SENTINEL: private prose")` arriving at Sentry
intact. So a correct near-miss was closed by opening a wider hole, in the one file the codebase has
for exactly this.

**The append is gone**, and `tests/job-failure.test.ts` now drives `sanitise` itself with an article
sentinel — because a test of `kindOfMessage` would have passed the whole time the hole was open.

**Then the loss turned out to be bigger than "no Sentry", which is what forced the right fix.**
Removing the append made ten tests fail — `tests/anthropic-call.test.ts` and
`tests/stop-details.test.ts`, both deterministic, both pre-dating this work. They pin the bracketed
code on the **log** line, and `stop-details.test.ts` says why in its own comment: *absence proves
nothing* — a stage that died on a missing file before it ever called a model contains no sentinel
either, and the code is the only thing that tells a refusal apart from it. So the code was never
only a Sentry token; it was the identity of the failure in the log, and the first draft of this
paragraph ("accepted knowingly") was written without knowing that.

So the channel Sol named is built after all, and it is small: **`stageFailure(failure, { authored })`**
— a second form of the argument in which the throw site claims it wrote every character and that
none of it arrived from a provider, a document or a reader. The code goes on; the sentence travels.
`anthropicCallFailed` earns it (a fixed sentence and a status the SDK handed over as a *number*) and
so do the ten `MODEL_REFUSED` sites. Free-text `detail` is unchanged and still withheld, which is
most diagnostics and all the dangerous ones.

The distinction is the entire point, so it is pinned in one test asserting **both** forms of the
same words side by side — free text withheld, `{ authored }` forwarded. Written that way on purpose:
apart, the plain case looks redundant next to the authored one and the obvious tidy-up is to
collapse them, which hands every step's free text the certificate again. It is one word at the throw
site so that grepping `authored:` returns every claim ever made, which is the list an audit wants.

**The client half took a different shape from the one asked for**, and the reasoning is worth the
paragraph. The plan said *make `retryable` a required prop on `JobProgress`*, so that the compiler
produces the list of bands to wire. What landed instead is `StepFailure` —
`{ message, retryable, retry }` — as the type of the existing `failed` prop. It produces the same
compiler-made list (thirteen call sites), and it removes a hazard the plan's shape would have
introduced: a boolean beside a string is precisely the arrangement
[`useStepJob.ts`](../../src/web/useStepJob.ts) already warns against in its own `postFailure`
comment — *"the failure and its reason are one value … so no later edit can set one and forget the
other"*. A panel cannot now wire the sentence and forget the judgement, because there is nothing to
forget. `retry` is separate from `retryable` because they answer different questions: whether
another go could work, and whether there is a job to point it at.

**`JobProgress` draws no button under a failure another go cannot change**, rather than falling back
to its ordinary run button — the shelf card's rule, and the one
[ingest-queue.md](../project/ingest-queue.md#the-failures-retry-is-not-offered-under) already
records. A retryable failed job gets **Retry**, which is `POST /api/jobs/:id/retry` and skips the
steps that finished. The run button comes back only where there is something new to ask for.

#### What the stage 2 review changed, 2026-09-03

[260903c-stage2-review-sol.md](260903c-stage2-review-sol.md). It confirmed the shape —
`failureKindOf` over `reader.kind`, the `StepFailure` type, no button under a non-retryable
empty-state failure, `stepGaveUp`'s totality, the step labels as reader-visible orientation, and
every deferral above. Six things changed:

1. **The Sentry append was removed** — see the paragraph above, which is the whole of it.
2. **The seam did not close.** `endAsStorageFailure` copied `PublishRefused.message` straight onto
   `job.error`, and that message names block hashes and ends *"re-run hierarchy"*. The exception had
   looked safe because the message *is* ours; being ours and being fit to show a reader are
   different things. The door already had good copy (`COULD_NOT_PUBLISH`) and now uses it, with the
   refusal's reasons on the log line instead. Sol found it by looking for **writers of the field**
   rather than for throwers — the same *grep the genre, not the list* the whole seam exists for,
   applied to the fix itself.
3. **A cancel was being handed a failure's sentence.** `readerFailureOf` ran before the abort
   branch, so a stopped step could be told the problem *"has been recorded"* on the one branch that
   skips Sentry — and a refusal racing with Stop left *asking again will be refused* on a step of a
   job that was about to be marked retryable. Cancellation now chooses `STEP_STOPPED` before
   anything is persisted.
4. **The generic `blocked` copy over-promised.** *"A shorter piece sometimes gets through"* is not
   true of `RawDocumentUnavailable` or `NoBlocksProduced`; a total fallback may only make the
   universal claim, which is that repeating the unchanged request will not change it.
5. **The seam test proved less than it looked.** It injected only into `STEPS.fetch.run`, so it
   structurally could not have caught (2), and it read `getJob`, which under the filesystem store
   returns a clone of the in-memory index rather than reloading the file. It now covers both other
   writers of `job.error` and reads the persisted pair back off disk.
6. A stale comment in `src/job-failure.ts` still describing the pre-split mechanism.

**Deliberately not done**, so it is not rediscovered as a mystery:

- **The thread page still does not pass `starting`.** `JobProgress`'s comment claimed both the quiz
  and the thread "watch a job they did not start"; that was false of both. The quiz is wired and
  tested; the thread needs the prop threaded through four more component prop types in a file this
  change was not otherwise touching. Recorded at the prop.
- **Several failures keep the generic copy** rather than being migrated: Readability's refusal and
  `NoBlocksProduced` (extract), the PDF page cap and chunk size, and the missing-artefact
  `stageFailure("ours", …)` calls. The PDF page cap is the one worth doing next — *"this PDF has 900
  pages and the limit is 400"* is genuinely reader-actionable — and each is one line at its throw
  site.
- **`anthropicCallFailed` still does not repeat the SDK's config error** even as a diagnostic. It
  was tried; `tests/anthropic-call.test.ts` has pinned since it was written that those words do not
  travel, and with the code now on the diagnostic they would reach Sentry too — a wider audience
  than that argument was ever made about.

### Stage 3 — the answer the quiz forgot: its own plan

**Not a regression. Attempts were never stored**, by an explicit decision in
[260831al:58-60](260831al-review-quiz-sub-mode.md):

> **Attempts are not stored** in v1. Answer, read the reply, move on; a reload starts the quiz
> fresh. The questions persist because they are an artefact. No new table, no per-reader progress
> model — that is the thing to design after using it, not before.

The code and the docs agree with each other perfectly; what they disagree with is the reader's
expectation. Greg answered a question, saw a tick, and reasonably took the tick to mean something.
Proven three ways: no `quiz_attempts` table in `src/db/schema.ts` or the live database, no
`src/store/pg-quiz.ts` among nineteen stores, and `markOneAnswer` (`src/routes.ts:1538-1655`) whose
own docstring says *"**Nothing is stored.**"* The `attemptId` in the Vercel log is `randomUUID()`
minted per request for one telemetry line (`src/routes.ts:1628`) — it identifies nothing that
outlives the request. `QuizResponse` (`src/types.ts:2923-2929`) has three fields and none is reader
data, so there is nothing for a client to hydrate from even in principle.

Four ordinary gestures each discard everything, because `QuizSubBand` is *conditionally rendered*
(`src/web/App.tsx:3386`) and the state is plain `useState` (`src/web/useQuiz.ts:196-202`): toggling
Recall↔Quiz, changing `?mode=`, going to the library, or reloading.

**Greg's decision, 2026-09-03: a `quiz_attempts` table in Postgres** — asked and answered rather
than assumed, because it reverses a stated product decision and adds a schema. Chosen over browser
storage so answers follow the reader rather than the browser.

**This stage gets its own plan doc**, on Sol's recommendation and rightly: persistence is a storage
and identity *design*, not a fix, and it must not delay stages 1–2, which are live production
defects. Stages 1 and 2 land and are pushed before it starts. Two things that plan has to settle
before it writes a migration:

- `article_revisions.quiz` is **one JSONB column, overwritten on every forced rebuild**
  (`drizzle/0046_quiz.sql:60`). So despite `260831al`'s phrase *"point at an immutable batch"*, old
  batches are destroyed — an attempt row either snapshots the question text or accepts being
  orphaned. Probably the latter; `QuizPanel.tsx:160-166` already clears on a new batch.
- It drags in the per-reader progress model `260831al` deferred. That is the design conversation,
  and it is the reason this is a plan rather than a patch.

Done: a failing test that answers question 1, remounts, and expects the answer still there.

### Stage 4 — the postmortem, and the prevention it recommends

`docs/postmortems/` — the real cause, the class named outright, `5253ee32` as the introducing
commit, and what would have caught the whole class, ranked by ease and value. The prevention becomes
work in this run rather than a filing.

Docs to update in the same stages: [quiz.md](../project/quiz.md),
[copy.md](../project/copy.md) (§ "recorded rather than fixed" stops being true).

## The report we could not read

The 523 characters Greg wrote are in the production `feedback` table and reachable from nowhere
else. The Sentry mirror **silently failed for this report**:

```
02:53:21  "feedback report handed to sentry"          id=spya-z6daky rows=1
02:53:21  "feedback report was not acknowledged by sentry"   id=spya-z6daky status=null
```

The test report filed 11 hours earlier reached Sentry fine, so this is not a configuration problem.
That is a defect in [feedback.md](../project/feedback.md)'s mirror and is **out of scope here** —
raised separately — but it is why this plan is built from logs rather than from the reader's words.
The mirror is best-effort by design and cannot fail the request; being best-effort and being
silently broken are different things.
