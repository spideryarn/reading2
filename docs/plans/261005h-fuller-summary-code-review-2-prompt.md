# Review 2: the measurement of Fuller-for-a-new-reader, its conclusion, and the push

Repo: this worktree, branch `worktree-fbrntjxu-fuller-summary-for-new-reader`. You reviewed the
plan and then the code for this earlier today (`docs/plans/261005h-fuller-summary-plan-review-sol.md`,
`…-code-review-sol.md`). Then the model key got room, the eval ran, and the prompt change is about
to be pushed to `dev`. **This review is mainly of the conclusion: is what the write-up says what
the result files say, and is shipping the right call on them?**

## The candidate

Live, pre-commit, on top of `origin/dev`:

- `git log origin/dev..HEAD`: one commit, `482c4f756`, the prompt edit you already reviewed
  (`src/simple-summary.ts`, two tests). Its prompt bytes are unchanged since; one comment gained
  four lines.
- Uncommitted (`git status`):
  - `docs/investigations/261005b-fuller-summary-for-a-new-reader-prompt-eval.md` — **the
    conclusion. Start here.**
  - `evals/simple/new-reader.ts` — rounds two and three were added after round one was scored
    (`ROUND`, `named`, `scorePairs`, the round-two seed).
  - `evals/results/simple/high-{about,none}-new*/` — 55 result files, eleven arms.
  - `evals/results/simple/new-reader-261005h/` — every judge's input, key and answer, three rounds.
  - `docs/project/summaries.md` (a new section), the plan (status, stages, ledger), the feedback
    note (now `ending: shipped`), `docs/user-feedback/awaiting-approval.md` (its line removed).

Reproduce every number with no model and no database:

```
npx tsx evals/simple/new-reader.ts table
npx tsx evals/simple/new-reader.ts score
npx tsx evals/simple/new-reader.ts score 2     # prints the grounded table without a database
npx tsx evals/simple/new-reader.ts score 3
```

## What you can run, and what you may change

Read-only (`--sandbox review`). No network. The four commands above run; so does
`npx vitest run tests/simple-two-levels.test.ts tests/doc-links.test.ts`.

## Attack it

Independently, before my questions.

1. **Every number in the investigation, the plan's ledger, summaries.md and the note** against
   the output of the four commands and the result files. A wrong count, a mean of the wrong
   arms, a table whose rows are not what its heading says. List each mismatch with the file and
   the right figure.
2. **The conclusion.** I say: passes for the profiled reader; mixed and *not claimed* for the
   reader with no profile; the two-bullet arm did less well, so the section ships. Try to break
   each. In particular:
   - Did I explain away the inconvenient result? The no-profile pairs prefer the OLD prompt 7 of
     10. I ship anyway, on the grounds that the report came from a profiled reader, that the
     audit count moves the other way, and that 7 of 10 is inside what the controls did. Is that
     honest, or is it a regression for some readers being shipped under a soft word? What would
     you do instead: ship, ship the two-bullet arm, or hold?
   - The pre-declared rule was "if the two-bullet arm does as well as the section, the two
     bullets ship". Head to head they split 5 to 5. I ship the section because against the OLD
     prompt it scored 9 of 10 and the two-bullet arm 6 of 10. Is that a fair reading of my own
     rule or a rescue of the version I had already built?
   - The audit criterion passes by 0.7 against 0.6. Is "passes, narrowly" a fair description?
   - Rounds two and three were designed after round one was read, and the round-two seed was
     chosen for balance. Is anything concluded from them that this does not support?
3. **`evals/simple/new-reader.ts` as it now is.** Does round one still compute exactly what it
   did (its files must not have been rewritten with different content)? Do the round-two and
   round-three paths keep the refusals you asked for (missing run, wrong blind id, repeated
   section, forbidden answer)? Is the arm-to-prompt mapping (`promptOf`) right for the four new
   arms?
4. **The judges' answer files** (`*-judge*.md`): any sign a judge did not do what its brief
   says — sections out of order, a count that disagrees with its list in a way `score` cannot
   see, a judge that plainly used one summary to understand another, a reason that contradicts
   its verdict.
5. **summaries.md's new section and the note**: true, and plain? Anything a reader of `dev`
   would take to be measured that is not?
6. **The push.** `git push origin HEAD:dev` after merging `origin/dev`. Another session
   (`brief-slightly-longer`) may land a change to Brief in the same file first; if so I take
   `simple-prompt/11`, keep both changelog paragraphs and recompute only Fuller's pinned sha.
   Anything else that must change in that case?

For each finding: an ID, a severity (P0 to P3), established or reasoned, (a) the concrete
mismatch or scenario, (b) the smallest change that closes it, as exact replacement text.

## Verdict

End with one line: `VERDICT: ship as written`, `VERDICT: ship with the changes above`,
`VERDICT: ship the two-bullet arm instead` or `VERDICT: do not ship`, and the two findings you
would fix first.
