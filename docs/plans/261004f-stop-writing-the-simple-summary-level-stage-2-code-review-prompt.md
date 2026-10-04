# Code review: stage 2, Brief shown first and a longer Fuller

You are reviewing **and fixing**. Fix what is inside this stage, narrowly, with a test that fails
first. Report, do not fix, anything wider. Do not commit. Do not edit any `*-sol.md` file.

**If you edit any doc: never write a quotation attributed to Greg that is not already in the file
you are editing or in the plan.** Do not put anyone's words in a dated blockquote.

## The candidate

- The stage is the commit you start on (`HEAD`); `git show --stat HEAD` lists every path and
  `git diff HEAD~1 HEAD` is the change. Stage 1 (already reviewed by you, F1 to F7) is below it.
- The plan: `docs/plans/261004f-stop-writing-the-simple-summary-level.md` § Stage 2, and § *Sol's
  review of this stage's plan (refuse), and what changed*, which lists what was done with each of
  your S1 to S7. Your plan review:
  `docs/plans/261004f-stop-writing-the-simple-summary-level-stage-2-plan-review-sol.md`.
- The server and client code and most tests were written by an Opus subagent from that plan; I
  read its diff. Treat it as unreviewed code by someone else.

## What it claims

1. While the `simple` step runs, once Brief is valid and checked, its paragraphs are on the job
   row (`JobStep.preview`), and the owner's band draws them with the progress row under them.
2. The preview is on the stored job row only while the step is running: removed at step start, on
   success before the commit, and on failure. A preview write can never fail, mis-settle or
   un-settle a step, whatever order writes reach Postgres in (your S4, S5).
3. The band never flashes empty between the job ending and the stored read landing, keeps Brief
   beside a failure, drops it for a successor job, and never draws a preview over a stored summary
   or for a visitor (your S3).
4. An unforced `simple` step is done when a usable summary is stored for the same article,
   whatever prompt version wrote it; *outdated* and Metadata's row still compare against the
   current version (your S1).
5. Fuller is asked for about 500 words in five to eight paragraphs; Brief's prompt is the same
   bytes; the version is `simple-prompt/8`.
6. S2 (the band's own *Write it again*) is deliberately not changed and goes to Greg as a question.

## Start with (does not limit scope)

- `src/jobs.ts` § `stepPreviews` and its three call sites in `runStep`; `src/pipeline.ts` §
  `StepContext.preview`, `simple.stamp`, `simple.run`; `src/types.ts` § `StepPreview`
- `src/web/useSimple.ts` § `keptPreview` (state adjusted during render: is it correct, and can it
  loop?), `src/web/SimplePanel.tsx` § `EarlyBrief`
- `tests/jobs-walk.test.ts` § a step's preview, `tests/stage-stamp-agreement.test.ts` § an
  unforced simple run, `tests/simple-panel.test.tsx` § Brief, before Fuller is written,
  `tests/freshness-deciders-agree.test.ts` (an existing assertion was changed on purpose: check
  the new `BY_DESIGN` pin is not hiding a real disagreement), `tests/simple-two-levels.test.ts`
- every other path that persists, copies or returns `job.steps` (requeue, cancel, deadline pause,
  the walk's other `note()` calls, `publicJob`, `/advance`): can a preview survive a settled step,
  or reach anyone but the owner, or be logged?
- `docs/project/summaries.md` § Brief first, § A longer Fuller

## What to do

Attack the six claims independently before reading my suspicions. For claim 4, also say what an
unforced job now does with a stored summary whose **model** differs from the expected one, and
whether that is consistent with the rule. For claim 5, prove Brief's bytes yourself against
`1698c6448`.

Run these yourself; they need nothing outside the tree:

```
npx vitest run tests/simple-two-levels.test.ts tests/simple-summary.test.ts tests/simple-panel.test.tsx
node --import tsx scripts/typecheck.ts
```

You have no network and no Postgres: `tests/jobs-walk.test.ts`, `tests/stage-stamp-agreement.test.ts`
and `tests/freshness-deciders-agree.test.ts` are mine to run; if you change them or the code under
them, say so plainly so I re-run them, and do not report them as passing.

Also check the conclusion in the plan's Ledger § *Stage 2: cost and wait, measured* against the
result files it names (`evals/results/simple/high-none-timed350a|b` and `high-none-timed500a|b`):
does each sentence follow from the numbers, and is anything inconvenient explained away?

## Output

Findings `F8`, `F9`, … (stable across the chain; F1 to F7 and S1 to S7 are taken), each graded,
marked **established** or **reasoned**, and **fixed** (files changed, the red-then-green you saw)
or **report-only**.

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

End with a verdict: approve, or refuse (only on an established P0 or P1 left unfixed).

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `keptPreview` compares `kept.paragraphs === live` by identity; the job list is re-parsed on each
  poll, so this may set state every second while a preview is live.
- A requeue of the same job id: the remembered Brief stays until the new attempt announces one.
- The three new reader-facing strings in `SimplePanel.tsx` against `docs/project/copy.md`.
- A legacy stored row with no `promptVersion` now also counts as done for an unforced run.
