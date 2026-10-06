# Review and fix: stage 2 of 261006d — the page and the report count stalls and timeouts

Repo: this worktree, branch `worktree-qi-pwhxm2t2-count-stalls`, TypeScript + ESM, vitest, React.

## The candidate

Committed: the single commit at `HEAD` whose subject starts `261006d stage 2`.
`git show --stat HEAD` lists the paths; `git diff HEAD~1..HEAD` is the diff. Stage 1 and your fixes
to it are the two commits before it and are not the candidate, but the read side depends on them.

The spec is `docs/plans/261006d-count-stalls-and-deadlines-apart-from-a-reader-s-stop.md`
(§ Where it is shown, § What it still does not tell apart, and § Progress stage 2, which lists six
places the build differs from the plan). Start with `src/cost-cube.ts` (`failureCountsOf`,
`failureCauses`, `nothingMeasured`, `stoppedFigure`, `failureSummary`, `FAILURE_NOTES`,
`FAILURE_DEFINITIONS`), then its three readers: `src/web/AdminCostsPage.tsx`,
`scripts/cost-analysis.ts`, `scripts/cost-analysis-html.ts`; then the docs in the diff. Not a limit.

**Read the conclusions as a reviewer of the conclusions**: the sentences in `FAILURE_NOTES`,
`FAILURE_DEFINITIONS` and the three docs are what Greg will read beside the numbers in a week,
to decide whether to pay twice for a broken answer. Is each one accurate against the code as it is
after stage 1 (including your F22: a deadline is not always one call's clock)?

## What to do

You may write. Fix what is inside this stage, narrowly, red first for behaviour; report and do not
fix anything wider. Docs you correct must match the code; never write or change a quote attributed
to Greg. Do not commit.

Attack it:

- Can any view show a wrong zero, hide a real count, or call measured what was not, for stalls and
  timeouts? Walk the rule against: only old rows; only realtime rows; only `abort` rows; no aborted
  rows; mixed; a stall with a null `attempt`.
- Is anything double counted, or summed into *died part-way*, or left out of the day or task table
  by the fold-away rule (`nothingMeasured`) or the "anything to show" gate when it holds evidence?
- Do the page, the terminal, the JSON and the HTML agree with each other from the same folds?
- Mutate the folds and the filter and see whether the tests notice. These need nothing outside the
  tree: `npx vitest run tests/cost-cube.test.ts tests/cost-analysis.test.ts
  tests/cost-analysis-html.test.ts tests/admin-costs-page.test.tsx`. I ran those and
  `tests/cost-analysis-cli.test.ts`, `tests/cost-failure-docs.test.ts`, `tests/doc-links.test.ts`
  after the build: 7 files, 268 tests passed; typecheck clean.

Severity: **P0** data loss, security, incorrect charging, service broadly unusable. **P1**
user-visible wrong behaviour or an authoritative contract violated. **P2** design or
maintainability risk. **P3** prose. Established or reasoned for each. Number findings **F24
upward**. For each: what, whether fixed, red-then-green evidence. End with `VERDICT: ship it` or
`VERDICT: change first`.

## My own suspicions, worth less than yours

- `FAILURE_DEFINITIONS` says an attempt "timed out when we stopped it because the whole call had
  taken too long". After F22 that looks too strong.
- The builder's point 6 in § Progress: a view whose only evidence is unnumbered `abort` stops shows
  the summary and no tables. Harmless or a hidden count?
- The causes table prints `stall` and `deadline` as raw class words while the columns say
  "Stalled" and "Timed out".
