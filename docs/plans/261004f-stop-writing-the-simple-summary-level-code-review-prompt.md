# Code review: stop writing the Simple summary level (stage 1)

You are reviewing **and fixing**. Fix what is inside this stage, narrowly, with a test that fails
first. Report, do not fix, anything wider. Do not commit. Do not touch `docs/plans/261004f-*-sol.md`
files other than by your answer.

**If you edit any doc: never write a quotation attributed to Greg that is not already in the file
you are editing or in the plan.** Do not put anyone's words in a dated blockquote.

## The candidate

- Base: `1698c6448`. The stage is one commit on this worktree's branch; its SHA is the `HEAD` you
  start on. `git show --stat HEAD` lists every path; `git diff 1698c6448 HEAD` is the whole change.
- The plan: `docs/plans/261004f-stop-writing-the-simple-summary-level.md`. Your plan review:
  `docs/plans/261004f-stop-writing-the-simple-summary-level-plan-review-sol.md` (F1 to F3, all
  addressed in this commit: check that they are).

## What it claims

1. A Summary write makes two writer calls and two fidelity checks, Brief and Fuller, and stores
   exactly those two levels. No code path asks for or stores a middle level.
2. Brief's and Fuller's system prompts are byte-identical to the base, so `simple-prompt/7` and
   `simple/2` are both unchanged.
3. A row stored before the change (three keys in `levels` and in `check.levels`) is still usable
   everywhere it was, is never rewritten, exports whole, and sends a visitor only Brief and Fuller.
4. Nothing else about when Summary is written changed.

## Start with (does not limit scope)

- `src/simple-summary.ts`, `src/types.ts` (from `SIMPLE_LEVELS`), `src/public/dto.ts` §
  `publicSimpleSummary`, `src/store/export-bundle.ts`
- `tests/simple-two-levels.test.ts` (new), `tests/simple-summary.test.ts` and
  `tests/simple-panel.test.tsx` (migrated by a subagent off the middle level; read the diff for a
  case that was weakened rather than moved), `tests/public-dto.test.ts`,
  `tests/store-export-bundle.test.ts`
- `scripts/simple-check-report.ts`, `evals/simple/probe.ts`, `evals/simple/fanout-spike.ts` (its
  paid half was deleted because it could not run; say if that was wrong), `evals/paperwork/run.ts`
- `docs/project/summaries.md` § Two levels, `docs/project/prompt-caching.md`

## What to do

Attack the four claims independently before reading my suspicions. Prove claim 2 yourself:
compare `SIMPLE_SYSTEMS.brief` and `.fuller` at `1698c6448` and at `HEAD`, not just the pinned
hashes. Look for any remaining reader of a middle level in `src/`, `scripts/`, `evals/`, `tests/`
and `docs/project/` that is now wrong, and for doc sentences that are now false.

Run these yourself; they need nothing outside the tree:

```
npx vitest run tests/simple-two-levels.test.ts tests/simple-summary.test.ts tests/simple-panel.test.tsx tests/public-dto.test.ts tests/simple-check.test.ts
npm run typecheck
```

You have no network and no Postgres: `tests/store-export-bundle.test.ts` and the full suite are
mine, and their raw result is in the plan's Ledger.

## Output

Findings `F4`, `F5`, … (F1 to F3 are the plan review's; reuse an ID only for the same finding),
each graded and marked **established** or **reasoned**, and each marked **fixed** (with the files
you changed and the red-then-green you saw) or **report-only**.

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Also check the conclusion in the plan's § Cost and wait against the result files it names
(`evals/results/simple/high-none-fbazc1|c2` before, `high-none-nosimple*` after): does the claimed
saving follow from those numbers, and is anything inconvenient explained away?

End with a verdict: approve, or refuse (only on an established P0 or P1 left unfixed).

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The owner's GET still returns an old row's middle level to the browser. I chose not to strip it.
- `isSimpleCheck` now ignores a malformed `check.levels.simple` on an old row.
- `evals/simple/fanout-spike.ts`: is a refusal plus `report` the right remainder?
