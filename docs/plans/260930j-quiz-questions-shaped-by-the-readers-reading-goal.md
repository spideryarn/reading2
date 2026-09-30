# Quiz questions shaped by the reader's reading goal

Status: planned 2026-09-30. Sentry SPIDERYARN-READING2-6Q, from Greg (admin, verified by account id).
Note: [260930_2200](../user-feedback/260930_2200-quiz-shaped-by-your-reading-goal.md).

> If the reader has told us why they're reading this article (the "Why are you reading this?" prompt
> from spya-esua8w), the quiz questions should be shaped around that goal. For example, if I've said
> I want to understand their methods, most of the questions should be about the methods, not an even
> spread across the paper.
>
> Why: Cody Dong pointed out that when he reads with a particular goal, he retains the goal-related
> parts much better. Self-testing works best on what you actually came for. It also fits spya-jc2ub9
> (easier questions that build on one another towards the takeaways): the build-up should head
> towards the takeaways that matter for my goal.
>
> Keep it simple: one batch per article as now, written with the owner's goal when there is one,
> and the same as today when there isn't. Visitors don't see the quiz, so there's no need for a
> separate generic set. If we ever show the quiz to visitors, give them a generic batch then. If the
> reader changes their goal, the existing "Write them again" can pick up the new one; no automatic
> regeneration needed for v1.
>
> Depends on spya-esua8w landing first (somewhere to store the goal).
>
> — Greg, 2026-09-30

## The dependency has landed

Report 60 ([260930e](260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md)) is on
`dev`. It did not add a new place to store the goal: the goal is `articles.purpose`, *Why you're
reading this one*, which has existed since 2026-08-26. Report 60 made the add page and Trajectory
ask for it. So there is nothing to store here, and no second home for a goal.

## What is already there

- **Every quiz job the reading view posts already carries the goal.** `POST /api/jobs` with a slug
  resolves the reader's profile (`resolveProfile`: the *About you* box plus this article's purpose,
  rendered as one string) and freezes it on the job, for every step, unless the client sends
  `useProfile: false`. `useQuiz` does not (`useStepJob` defaults it to true). So `ctx.profile`
  reaches the quiz step today, and the step ignores it — the deliberate *No profile in v1* in
  `src/quiz.ts` and [quiz.md](../project/quiz.md). **Exceptions** (Sol F1): a CLI run
  (`scripts/stage.ts`) posts no profile; a Retry reuses the failed job's own snapshot; a shelf read
  that fails is swallowed and the job carries *About you* alone. All three are how every profiled
  mode already behaves, and are left so.
- ***Write them again* is a forced re-run**, so it resolves the profile afresh at the press. That is
  Greg's "the existing *Write them again* can pick up the new one", with no new code.
- **The profile is not in the quiz's stamp**, and stays out. So changing the goal never makes a quiz
  stale and never regenerates one: Greg's "no automatic regeneration". (Ideas and Trajectory put
  the profile in their stamps; Quotes records it outside. The quiz does neither in v1 — item 5.)

## What this changes

One stage, one prompt. No schema, no route, no client change.

1. **`generateQuiz` takes `profile: string | null`**, and the `quiz` step passes `ctx.profile`.
2. **The goal goes in the varying half of the prompt**, after the article's cache breakpoint, in
   `renderPrompt` after the skeleton — where every profiled stage puts it
   ([prompt-caching.md](../project/prompt-caching.md)). With no profile, `renderPrompt` produces
   byte-for-byte what it does today (a test pins this, as `tests/profile-prompts.test.ts` does for
   the other stages).
3. **Its own section, not the shared `profileSection`.** The shared reminder says the profile
   changes *"nothing about its proportions"*, and Greg is asking for exactly that to change: *"most
   of the questions should be about the methods, not an even spread"*. So the quiz writes its own
   short section around the rendered profile:

   ```
   === WHY THIS READER IS HERE ===

   About the reader: …
   Why they are reading this piece: I want to understand their methods

   If a reason for reading is given above, aim the path at the takeaways that matter for it … if
   not, set the ordinary path.
   ```

4. **The binding rules go in the constant `QUIZ_SYSTEM`**, as a section written conditionally
   (*"if a reason for reading is given"*), so the system prompt does not vary and the cache is not
   split (the argument `PROFILE_RULES` makes in `src/profile.ts`). The substance:
   - Most of the path is about the parts of the piece that bear on the reason. The takeaways the
     path ends at are the ones that matter for it.
   - The path still starts with what the piece plainly says, and still leans each step on the one
     before; a few early steps may set up what the goal-related part needs (you cannot ask about the
     methods' weakness before the reader has said what was measured).
   - It never changes what the article says, and every question is still answered by the article.
   - If the piece has little on the reason, write the ordinary path and never say so.
   - Never address the reader, and never say or hint that a reason was given, in a question, premise
     or reference answer; the subjects the reason names are ordinary words, used wherever the
     article does (Sol F3: "never mention the reason" could have banned the very topic).
   - **Only the reason moves the path.** The *About the reader* line may change the vocabulary a
     question assumes and the least context it needs to say what it asks — never which parts it asks
     about, which takeaways it heads for, or enough to answer itself (Sol F3). With *About* and no
     reason, the ordinary path. This is the deviation named below.
   - And the "Cover the piece" rule gets its exception: it applies when no reason is given.
   **`PROFILE_RULES` is not appended** (changed after Sol F2): it lets the profile govern "which
   things you spend words on", which is exactly what the *About* line must not do here. The one
   part of it the quiz needs, a forbidden example of addressing the reader, is written in the quiz's
   own terms.
5. **No `profileHash` on the artefact in v1**, although it would be the honest record. Adding one
   is not free: `ProfileCarrying` (src/store/pg.ts) is derived from every artefact type with a
   `profileHash`, so the compiler would pull `quiz` into `personalisedSteps`, and the owner's
   *make public* dialog would name the quiz as personalised — about an artefact a visitor never
   sees. Nothing reads the hash in v1 (no label, no staleness), so it waits for the thing that
   would read it, and that change decides the dialog question at the same time.
6. **No `PROMPT_VERSION` bump.** With no profile the prompt's behaviour is unchanged except for the
   added conditional section, and a bump would mark every stored quiz outdated for nothing. The
   2026-09-03 edit is the precedent (a wording change, no bump).
7. The step's log line gains `profileChars` (the length, never the text), as Ideas and Quotes have.

## The one deviation from Greg's words

Greg: *"written with the owner's goal when there is one, and the same as today when there isn't."*
The job carries the **whole** rendered profile — *About you* and the purpose, one string — because
that is what `Job.profile` is (src/profile.ts explains why the two halves are joined once). So a
reader with an *About you* sentence and no goal gets a quiz whose wording may be pitched to them,
where today it is not. The prompt confines that line to *the vocabulary a question assumes*, never
*which parts it asks about*, so the proportions Greg cares about move only with a goal. The eval's
About-only arm checks that.

The literal version — the quiz sees the purpose alone — needs the purpose carried on the job as a
second field beside `profile`: the job type, its work key (`sameWork`), `enqueue`, the reset route,
and the resolve at the POST. That is the "six more touchpoints" `src/quiz.ts` warned about, for a
difference in pitch. **Passed over for v1; named in the note for Greg.** If he wants it literal, it
is that plumbing. (Sol F2 confirmed there is no cheaper honest route: parsing the purpose back out
of the rendered string by its label is brittle on free text, and making `Job.profile` mean
"purpose only" for quiz jobs would split one field's meaning across mixed jobs, Retry and reset.)

## What this passes over

- **A "Written for: …" line in the Quiz band**, like Trajectory's *Reading for*. Greg said keep it
  simple, and the quiz has no header to put it in. Deferred.
- **A label when the goal has changed since the batch was written** (`profileChanged` on the GET),
  and the `profileHash` it would read. Still no migration when it comes (a field on a JSON artefact). Greg: no regeneration for v1, and
  *Write them again* is the way to pick up a new goal.
- **A visitor's generic batch.** Visitors do not see the quiz (`quiz` is not in the public page's
  modes). If that changes, a generic batch then.

## How we will know it worked

A small harness of its own, [`evals/quiz-reading-goal.ts`](../../evals/quiz-reading-goal.ts)
(not a flag on `evals/quiz.ts`, whose positional-directory parsing Sol F7 flagged), calls
production's `generateQuiz` with a purpose and/or an *About* line rendered as `resolveProfile`
would, and counts the questions whose evidence sits **mostly** in a predeclared part.

Article: `entropy-24-00930-spya-pywwkq` (a review of partial information decomposition in neural
circuits, nine parts). Target, declared before any goal run: **part 7, *Practical Considerations in
PID***. Three arms, two runs each: no profile; a purpose aimed at part 7; an *About* line alone (a
neuroscientist who records neurons — the control that *About* does not move the path).

The bar (Sol F7): with the purpose, **more than half** of the questions in part 7 in both runs, **and
at least 20 points above** the pooled no-profile share; the About-only arm within the no-profile
arm's run-to-run spread. And read every question: that it is still a path, premises still lean,
nothing addresses the reader or says a goal was given.

## Tests

- `tests/profile-prompts.test.ts`: the quiz's `renderPrompt` carries the profile when there is one,
  says nothing about a reader when there is none, and gains not a blank line (byte-equal to the
  no-profile call).
- `tests/quiz-step-registration.test.ts`: `ctx.profile` reaches the model request (the stub captures
  the request's user message); with no profile, no trace in the request. Watched red before the
  stage change.
- `tests/quiz-step-registration.test.ts` also asks the request's **shape** (Sol F4): the reader's
  words are in the user message and nowhere in the system part, where the article's cache
  breakpoint is; and a changed goal does not make the quiz stale (no automatic rewrite).
- `tests/quiz-job-carries-the-reading-goal.test.ts` (Postgres, Sol F1/F8): `POST /api/jobs` for a
  quiz, unforced and forced, freezes `articles.purpose` onto the job row; `useProfile: false` is the
  control. Nothing asked this of any step before. Mutation: without the purpose written, both cases
  red.
- `tests/quiz.test.ts`: whatever pins `QUIZ_SYSTEM` still passes; the new section is conditional.
- Public boundary (Sol F5): quiz is absent from `PublicArtefacts` and the public DTO; documented in
  quiz.md rather than a new test, because the type is what keeps it out and adding it there is a
  deliberate act the doc now names.

## Progress

- 2026-09-30: checked for prior work (none: `git log`, plans, notes, `gjd-remote ls`); report 60
  confirmed on `dev`. Plan written.
- 2026-09-30: GPT Sol plan review ([prompt](260930j-quiz-reading-goal-plan-review-prompt.md),
  [answer](260930j-quiz-reading-goal-plan-review-sol.md); exit 0, file fresh). *Revise before build*,
  no P0. Taken: F1 (claim narrowed, exceptions named, route→job test), F2 (no `PROFILE_RULES`;
  reminder conditional; About-only eval arm), F3 (wording), F4 (request-shape test), F5 (public
  boundary documented), F6 (no bump, recorded in quiz.md), F7 (stricter bar, own harness), F8
  (quiz.md). Declined: failing a quiz when the purpose read fails (F1 asked us to decide) — every
  profiled mode fails open there, and a quiz lost over an unread sentence is worse than one written
  without it.
- 2026-09-30: built as revised. Tests: the three prompt cases (one red before the change), four in
  the step registration (one red before, plus the request-shape and no-rewrite cases), and the
  Postgres route→job file (mutation: 2 of 3 red without the purpose). Typecheck clean.
- 2026-09-30: **the measurement.** Six paid generations on `entropy-24-00930-spya-pywwkq`, results
  under `evals/results/quiz-reading-goal/`. The purpose: *"I want to apply this to my own
  recordings, so I need to know the practical problems: what makes PID hard to use on real data."*
  The About line: *"A computational neuroscientist who runs multi-electrode array recordings."*
  The two `none` arms ran on the first draft of the prompt (before Sol's wording fixes; the
  no-profile text differs only in the conditional section); the other four on the final one.

  | Arm | Mostly in part 7 (predeclared proxy) | On-goal (blind judge) |
  |---|---|---|
  | none-1 / none-2 | 2/20 (10%) · 1/20 (5%) | 3/20 (15%) · 4/20 (20%) |
  | about-1 / about-2 | 1/20 (5%) · 1/14 (7%) | 4/20 (20%) · 2/14 (14%) |
  | goal-1 / goal-2 | 9/19 (47%) · 8/19 (42%) | 14/19 (74%) · 14/19 (74%) |

  **Against the predeclared bar: the lift (+37 points over pooled none) and the About-only control
  pass; "more than half in part 7" does not** — 47% and 42%. Reading the goal arms, the questions
  outside part 7 are largely on-goal too (*why picking a redundancy formula is a genuine difficulty
  for someone applying the method*, from part 5; the authors' caveat about their transfer-entropy
  networks, part 6; what a redundancy function needs for local analysis, part 8 *Future
  Directions*) — the proxy Sol warned undercounts. Rather than accept my own reading of that, a
  **blind judge** (a Sonnet subagent, all 112 questions shuffled across arms, arm hidden, labelling
  each on or off the reader's goal; `blind/`) gave the right-hand column: **74% in both goal runs**,
  against 15–20% with no profile and 14–20% with About alone. Each goal path still opens with 3–4
  setup steps (what mutual information is, what synergy is) before it turns to the goal, which is
  the prompt's "it is still a path" rule working. No question or premise addresses the reader or
  says a goal was given (scanned, all six arms). `about-2` dropped 7 questions for quotes that
  could not be found — a drop rate the baseline has shown before (quiz.md), not a profile effect
  as far as one run can say.
