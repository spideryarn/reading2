## 1. Stage 2: choose the generic fallback

Choose **(a)**: every undeclared failure gets safe generic copy. Losing useful details temporarily is preferable to publishing an unaudited internal or upstream string. The diagnostic remains in logs and Sentry; only the persisted reader copy changes.

An allowlist is especially unsafe because one newly added throw inside an “approved” step would leak immediately. Option (c) is not genuinely available with exceptions: TypeScript has no checked throws, so the `PipelineStep.run(): Promise<…>` signature cannot constrain what gets thrown ([src/pipeline.ts:662](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/pipeline.ts:662)). A typed `Result` return could enforce expected failures, but unexpected exceptions would still require the generic fallback, and migrating every step would be disproportionate.

Concretely:

- Let a declared step failure optionally carry a complete `ReaderFacingFailure`, keeping `kind` and reader message together; that existing type already provides the right pairing ([src/messages.ts:61](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/messages.ts:61)).
- Keep `Error.message` diagnostic and copy only the declared reader message into `step.error` and `job.error`. The current raw copies are at [src/jobs.ts:696](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:696), [src/jobs.ts:730](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:730), and [src/jobs.ts:740](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/jobs.ts:740).
- For legacy errors, use a small total fallback mapping keyed by `failureKindOf(err)`, with unknown mapping to retry as the existing compatibility rule requires ([src/job-failure.ts:105](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/job-failure.ts:105)). This avoids showing retry advice while storing `failureKind: "ours"` or `"bug"`.
- Migrate shared error constructors first—especially `anthropicCallFailed` and `truncationFailure`—rather than allowing whole steps. One change there preserves useful copy across many bands.

“Developer-facing” must still mean safe to log. In particular, do not restore an Anthropic SDK body to `Error.message`; that body can echo article prose, and its deliberate removal is documented at [src/anthropic-call.ts:12](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/anthropic-call.ts:12).

For the UI, make `useStepJob` retain a typed terminal failure such as `{ message, retryable }`, rather than reducing it to a string at [src/web/useStepJob.ts:369](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/useStepJob.ts:369). `JobProgress` currently always redraws the ordinary run button ([src/web/JobProgress.tsx:218](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/JobProgress.tsx:218)); making retryability a required prop lets compiler errors identify all eight callers that need wiring.

## 2. Stage 1: one per end is the right acceptance floor, but not the right prompt target

A 9-easy/1-hard batch is unbalanced, but it does not “order badly.” Quiz is sorted once by band, then value, then document position ([src/quiz.ts:453](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:453)). The panel preserves that stored order ([src/web/QuizPanel.tsx:18](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/QuizPanel.tsx:18)). Therefore those questions appear as nine easy questions followed by one hard question: an abrupt progression, but still a meaningful one.

The URL’s `rank=prioritised` and `order=prioritised` belong to Quotes and Search, respectively; Quiz does not consume either ([src/web/App.tsx:3987](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/App.tsx:3987), [src/web/App.tsx:4171](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/web/App.tsx:4171)).

So I would:

- Accept one easy and one hard as the fatal minimum.
- Keep a stronger generation target—roughly three of each in a twelve-question batch—while clearly calling it a target rather than a condition that triggers an automatic retry.
- Remove the false “article is asked again” claim at [src/quiz.ts:728](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:728).

Making the prompt itself ask for only one per end is likely to turn the emergency floor into the normal distribution.

The plan must also specify the short-batch boundary. Existing behavior deliberately exempts batches of three or fewer ([tests/quiz.test.ts:166](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/tests/quiz.test.ts:166)). Retaining that exemption means the rule is monotonic only among batches of four or more: three medium questions pass, but adding a fourth medium question fails. The absolute monotonicity claim at plan lines 125–127 is therefore false unless the product also chooses to reject every one-question batch and require both ends from size two onward—which contradicts the existing “do not pad short pieces” decision.

I recommend preserving the short exemption and stating the narrower monotonic claim honestly.

## 3. The 7-versus-9 claim is true, but it is supporting evidence

I ran the exported functions directly:

```text
7 questions, one hard: []
9 questions, one hard: [{ band: "hard", want: 2, have: 1 }]
```

That follows directly from [src/quiz.ts:273](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:273) and [src/quiz.ts:281](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:281). Equivalently, adding two valid non-hard questions to a passing seven-question batch makes it fail.

It is a good diagnostic smell, but not proof that the rule is wrong: legitimate sample-size rules often have thresholds. The stronger argument is that the rejected batch still satisfies the ordering’s essential invariant, while rejection discards a paid 36-second call. The consequence is disproportionate to the quality defect.

## 4. Do not add an automatic Quiz retry

Labels is not a close precedent. It retries only the typed `BatchIncomplete` case ([src/labels.ts:2211](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/labels.ts:2211)); when possible it asks only for the known missing labels, otherwise it redraws a small batch with more headroom ([src/labels.ts:2221](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/labels.ts:2221)). Quiz has one whole-article call and no reusable partial result.

With the acceptance threshold corrected and an explicit reader retry affordance, an automatic second billed call and another forty seconds are not justified. Reconsider only if telemetry shows floor-of-one failures remain common.

## 5. Prevention: represent the invariant directly

The cheapest useful regression test is table-driven:

- For every gated size, a batch with exactly one easy and one hard has no shortfall.
- For every gated size, a batch missing either end fails.
- Explicitly cover the chosen short-batch boundary.

Stronger and simpler: delete the numerical `bandQuota`/`want` abstraction if the product rule is merely presence at each end. A helper such as `missingBandEnds` returning `QuizBand[]` cannot accidentally grow a proportional quota while still sounding like a presence check. The current numeric representation is what allowed the prose and arithmetic to diverge.

The Stage 2 seam test should inspect both persisted `job.error` and `step.error`, not only rendered HTML, because JobProgress and the shelf deliberately render different fields. Add a positive control proving a declared reader message survives and its kind controls retryability.

If the prompt’s requested distribution changes, the plan also needs to decide whether to bump `PROMPT_VERSION`; the current contract says prompt changes that affect what a question is require it ([src/quiz.ts:152](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/src/quiz.ts:152)).

## 6. Stage split and smaller corrections

Stages 1 and 2 are correctly separate and independently valuable. Stage 3 should be removed into its own plan: persistence reverses an explicit product decision and introduces a materially different storage/identity design. It should not delay these production fixes.

Two factual corrections before building:

- “Never cross-family reviewed” is false as written. The initial review explicitly recommended a band quota ([260831al review:135](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/docs/plans/260831al-review-quiz-sub-mode-review-sol.md:135)), and the whole implementation later received a full-file review ([260831al plan:470](/home/greg/code/spideryarn2/.claude/worktrees/quiz-band-spread-fix/docs/plans/260831al-review-quiz-sub-mode.md:470)). It is fair to say the precise `min(3, floor(n/4))` boundary was not challenged.
- The plan’s link to `260831al-quiz-mode.md` is broken; the file is `260831al-review-quiz-sub-mode.md`.

The focused Vitest file could not start because this worktree lacks `node_modules/.vite-temp`; I used the exported quota functions directly for the reproduced boundary result above.