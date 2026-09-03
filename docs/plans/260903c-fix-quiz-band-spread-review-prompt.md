# Review this plan before it is built

You are reviewing a plan in the Spideryarn repo. The working directory is a git worktree of it —
read any file you like, and you may run a test file; a finding you reproduced outranks one you
reasoned to. Do not edit anything.

**The plan:** `docs/plans/260903c-fix-quiz-build-band-spread-failure-and-lost-quiz-answers.md`.
Read it first, then the code it names.

## Context

Two production bugs in Quiz mode, reported by the product owner today.

1. A quiz build job failed, burning 36s and $0.06, because `bandQuota` in `src/quiz.ts` demanded 2
   "hard" questions from a 9-question batch and got 1. He pressed the button again and it worked.
   **Stages 1 and 2 of the plan are about this. They are what I want reviewed.**
2. Separately: quiz answers are lost on navigating away and back. Diagnosis has since established
   that attempts were *never* persisted — an explicit v1 decision recorded in
   `docs/plans/260831al-review-quiz-sub-mode.md:58-60` and in `docs/project/quiz.md`. So stage 3 is
   a product decision to reverse rather than a bug to fix, and it is with the product owner.
   **Comment on stage 3 only to say whether splitting it out is right.**

House rules are in `CLAUDE.md` — read it, especially "prefer boring", "simplest version first",
"prefer simple over easy", "let the types catch it", and the instruction to take the simplest
product decision. The process is `docs/reusable/engineering-manager.md` § Bug-mode.

## The evidence

Production Vercel logs, 2026-09-03, deployment dpl_419KZguSZEeMgEvHLUrCz2Z78Dga:

```
02:48:14  job spya-hu6m2e queued  steps:["quiz"] forced:["quiz"]
02:48:51  step failed: quiz — nagel-bat  ms:36236 aiCost:"$0.0613"
          err.message: The batch does not use both ends of the band scale, so the reader would
          meet 9 questions in an order that means nothing. wanted 2 "hard", got 1. A batch of this
          size has to carry both ends — src/quiz.ts § bandQuota. Run it again; if it keeps landing
          here, the prompt's spread rule is the thing to change.
02:48:58  job spya-xt5kmm queued  (the human pressed the button again)
02:49:40  quiz nagel-bat: 11 questions  easy:3 medium:4 hard:4  ms:40705  aiCost:"$0.0675"
```

That error text was rendered to the reader verbatim, in red, under an unchanged "Write the
questions" button.

## The questions I most want answered

Be concrete and cite file:line. Disagree freely; several of my conclusions may be wrong.

1. **Is the floor-of-one gate right?** The plan replaces `min(3, floor(kept/4))` with "at least one
   at each end". Read `bandQuota` and `quotaShortfall` (`src/quiz.ts:260-290`), the throw
   (`src/quiz.ts:515-539`), and the header comment explaining why it scales. Is a floor of 1 too
   weak — does it admit a batch of 9 easy + 1 hard that genuinely orders badly? Read how `band` is
   actually consumed by the ordering (`?order=prioritised&rank=prioritised` in the reading-view URL)
   before answering. Is there a better rule that is still monotonic?

2. **Is the non-monotonicity claim true?** I claim a 9-question batch with 1 hard fails while the
   same batch trimmed to 7 would ship. Verify against the code. If true, is it the strongest
   argument here, or am I over-weighting an artefact of `floor`?

3. **Stage 2's fallback is the real design question.** Today `src/jobs.ts:696,740` copies
   `(err as Error).message` onto `job.error`, which `src/web/JobProgress.tsx:230` renders to the
   reader. `src/messages.ts:600-620` documents that six stages already leaked provider prose through
   this seam (fixed 2026-08-26, lesson recorded as "grep the genre, not the list"), and
   `docs/project/copy.md:238-253` documents a second instance left unfixed because "the same string
   has two audiences". This is the third instance.

   I want an undeclared error to **not** fall through to `err.message`. But the other seven bands'
   error strings are unaudited and some are probably genuinely useful. Options:
   (a) generic fallback for everything undeclared, losing real information until each is migrated;
   (b) an allowlist of migrated steps — a list, and lists rot;
   (c) type-level: steps may only throw a `StepFailure`, enforced by the compiler.
   Read `src/job-failure.ts` (`stageFailure`, `failureKindOf`, and the essay on why a field beat a
   bracketed code) and `src/messages.ts` (`ReaderFacingFailure`, `kindOfMessage`).
   **Which option, and why?** If (c), say concretely how to enforce it without a big-bang migration.

4. **Should stage 1 also retry?** The plan says no — fix the rule and retry stops being
   load-bearing. `src/labels.ts` retries a short batch; find how, and say whether quiz should copy
   it. Weigh that a retry costs a second billed call and ~40s of a reader's wait, and that stage 2
   adds a reader-facing Retry button.

5. **What would have caught this?** The check has no test for the near-miss (a batch one short).
   What is the cheapest test or type change that makes the class — "a validation stricter than its
   own error message claims" — visible? This feeds the postmortem's prevention section, which
   becomes real work in this run rather than a filing.

6. Anything the plan has missed, has wrong, or is over-engineering. Is the stage split right? Is
   there a smaller change that gets most of the value?

Answer in prose with headed sections, ranked by what matters most.
