# Code review (round 1, before the paid run): 261001s — the Dig deeper answer-model eval

You are reviewing **and fixing** (workspace-write) in the worktree you are in. Candidate: commit
`e0fe8741f` on top of `6e569824a` — `git diff 6e569824a e0fe8741f` and
`git diff --stat 6e569824a e0fe8741f` give the exact change (start with `evals/dig-deeper/*.ts`,
`tests/dig-deeper-eval.test.ts`, the small exports in `src/term-lookup.ts`; that does not limit
scope). The spec is `docs/plans/261001s-dig-deeper-answer-model-eval.md` (including its "What
building changed" section) and your own plan review beside it,
`docs/plans/261001s-dig-deeper-answer-model-eval-plan-review-sol.md`.

## Why now

About **$32 of model calls** is about to be spent on the full matrix (12 arms × 6 examples × 3
answer runs; 3 judges × 6 examples × 2 judged runs × 3 anchored batches; a re-judge; a
production-shaped finalist run; a probe). A bug found after that costs a re-run we cannot afford
under the $40 ceiling. So the question is: **will this code's numbers mean what the report says they
mean?** You will see the real numbers and my conclusion in a second, narrower round afterwards.

## Evidence you cannot regenerate (no network in your sandbox)

The smoke run's report (one example, three arms, one judge) is at
`output/dig-deeper-runs/smoke2/report.md`, with its cells under `output/dig-deeper-runs/smoke2/cells/`,
`manifest.json`, `budget.json`, `probe.json` — gitignored, readable. The six frozen captures are
under `output/dig-deeper-runs/main/`. The free preflight's estimate for the full matrix was ~$36.6
with three judged runs (answers $13.5, judging $13.6, re-judge $3.7, finalists $5.7). You can run the
preflight yourself only if it needs no network or database; `npx vitest run
tests/dig-deeper-eval.test.ts` needs neither — run it.

Things the builder reported: Luna is served BYOK, so its `usage.cost` is $0 and cost is taken by the
ledger's `totalSpend` rule; a call our own deadline cut off is charged at its reserved bound; the
Opus check replaced Luna's draft in both smoke presses; DeepSeek truncated at 4,000 once (kept, as a
comment keeps it); in the smoke report the "three readings" section prints readings 2 and 3 but not
1.

## The attack

1. Any place a printed number is wrong or meaningless: aggregation, the anchor subtraction, the
   acceptable rule, first-press reconstruction, repeat-press cache test, latency sums, BYOK pricing,
   the frontier, bootstrap intervals, position bias.
2. The blinding: can a label, order, length marker, model name, or a field in the judge prompt leak
   which arm wrote what? Does the decode map each judged label back to the right arm?
3. Holding inputs fixed: does every arm really get the same messages except the declared fields?
   Is the search-again replacement real in all three places it should be? Does the Citations path
   build the request the way production does?
4. Budget and resume: can a call start past the cap, a cost be lost, a stale cell be reused, or the
   report claim "Complete" with cells missing or invalid?
5. Anything that would make the full run fail midway and waste money (context limits on the 255k
   Kuhn article, `response_format` on Sol or Kimi as judges, deadlines).

**My own suspicions, worth less:** reading 1 missing from the report; the explain `SYSTEM` still
encourages searching though no tool is given; three judges' "acceptable" thresholds scaling with
fewer judges; whether `luna+check`'s 73% cache read and Opus's 0% are being read correctly as
first/repeat.

## What to do

Fix what is inside this eval, narrowly and red-first where a test can show it (`evals/dig-deeper/`,
`tests/dig-deeper-eval.test.ts`, the plan's "What building changed" if a decision changes). Report,
do not fix, anything wider. Do not spend money and do not commit; I will read your diff and commit.

Severity: P0 data loss / incorrect charging · P1 a number the report prints that is wrong or
meaningless, or a contract violated · P2 design risk · P3 prose. IDs continue from the plan review:
start at **F10**. For each: severity, claim, evidence, and what you changed (or why not). End with:
safe to spend / spend after my fixes / do not spend.
