# Code review: Find more rows in the command bar, and more mode nicknames

You are reviewing **code**, and you may fix what you find. Your sandbox is workspace-write in this
worktree.

## The candidate

Two commits on this branch, exactly:

- `2ca8bf35c` — stage 1, more nicknames for every mode (`src/mode-catalog.ts`)
- `037bcdc54` — stage 2, *Glossary › Find more* and *Quotes › Find more*

`git show --stat 2ca8bf35c 037bcdc54` lists the changed paths; `git diff a61cca17d..037bcdc54 -- src tests docs/project evals`
is the whole change (the two commits between are plan documents). The tree is clean at `037bcdc54`,
so any diff after your run is yours.

The plan, with your own plan-stage findings F1–F9 and what was done about each:
`docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md` and
`docs/plans/261004k-command-bar-find-more-plan-review-sol.md`. **Use new IDs from F10 on**; reuse
F1–F9 only to say one of those is still open.

Start with (this does not limit scope): `src/web/find-more.ts`, `src/web/find-more-handoff.ts`,
`src/web/useFindMoreHandOff.ts`, the call sites in `src/web/GlossaryPanel.tsx`,
`src/web/QuotesPanel.tsx`, `src/web/reader/Reader.tsx`, `src/web/command-runners.ts`,
`src/web/CommandBar.tsx` (`findMoreRows`), `src/web/command-match.ts` (the `define` verb's
`except`), `src/mode-catalog.ts`, and the tests `tests/find-more-commands.test.tsx`,
`tests/find-more-from-the-command-bar.test.tsx`, `tests/command-match-mode-aliases.test.ts`,
`tests/command-match-arguments.test.ts`, `tests/command-pick-catalogue.test.ts`.

## What to do

1. An independent pass first: can a reader's press do something its row did not say, spend twice,
   rewrite a list under a row that said *more*, or do nothing silently? Does a nickname put the
   wrong row first? Do the docs and the Help sentence say what the code does? Is anything attributed
   to Greg that is not one of the two sentences quoted at the top of the plan?
2. **Fix what is inside these two stages**, narrowly and red-first (a failing test before the fix).
   **Report, do not fix**, anything wider.
3. Run the test files yourself where they need nothing outside the tree (these are jsdom and pure
   tests; no Postgres): e.g. `npx vitest run tests/find-more-commands.test.tsx tests/find-more-from-the-command-bar.test.tsx tests/command-match-mode-aliases.test.ts tests/command-match-arguments.test.ts`.
   Raw output I ran at `037bcdc54`: `npm run typecheck` clean; 20 covering files, 483 passed, 2
   skipped. Do not commit.

## Output

Findings `F10`, `F11`, … each with severity, **established** or **reasoned**, evidence (file:line),
and whether you fixed it (name the files you changed).

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

End with one line: `VERDICT: land` / `VERDICT: land with my fixes` / `VERDICT: do not land`.

## Known and deliberately left (say if you disagree)

- Glossary's band label still falls back to `stale || outdated` when the server's `panelRun` is
  absent and may say *Find more*, while the command requires `panelRun === "append"`. Recorded in
  `docs/project/glossary.md`.
- `define find more` was added to the `define` verb's `except` list rather than declared as a
  collision exception.
- F8 (re-measuring the picker with the new words) has not been run yet; it is a paid eval I run
  after this review.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- `useFindMoreHandOff`'s effect does not depend on `offered`; is there a path where the read is
  `settled` but the job list has not been polled yet, so `job === null` is a not-yet-known rather
  than a no?
- Reader computes the row gate; the band computes the press gate. Can the two reads differ (two
  hook instances, one stale)?
- The glossary ask hand-off and this one are siblings with copied guards. Is the copy a risk, and
  would one generic module be smaller?
- A mode nickname that is now also a *Run again* phrase and a *Find more* phrase: any tie that puts
  a paid row above the mode for a plain word?
