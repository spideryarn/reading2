# Code review: 261022d, the reading measure counted in real characters

You are reviewing a change in /var/tmp/spideryarn-worktrees/fbvywcpu-reading-measure (a git worktree,
branch worktree-fbvywcpu-reading-measure). Read the plan first:
docs/plans/261022d-reading-measure-in-real-characters.md, then your own plan review:
docs/plans/261022d-reading-measure-in-real-characters-plan-review-sol.md.

The scope is two parts:

1. Commit fa52f023c (stage 1): `git show fa52f023c`. The measure goes from 65ch to 56ch, blockquote and callout
   become `calc(var(--reading-measure) - 7ch)`, `.prose :is(sup, sub) { line-height: 0 }`, a comment
   and copy sweep, the rule in docs/project/typography.md, and the new counter
   scripts/measure-line-length.ts.
2. The uncommitted working tree: `git diff HEAD` plus the new files
   docs/user-feedback/261021_2302-reading-measure-in-real-characters.md and
   docs/user-feedback/questions/q-z3j0ep.md. Stage 2 (PROSE_ALONE_MAX_REM 49 → 34) was built and
   then **deliberately not landed**, because it moves where mode bands widen (980 vs 1220px) and
   Greg tuned those widths by eye. See § Stage 2, held in the plan. What landed instead: corrected
   comments in src/web/layout.ts, two tests (tests/text-alone-centring.test.ts,
   tests/gutter-target-size.test.ts) that now use the true ~31rem measure, with their "under a rem
   of slack" assertions moved into `it.fails`. These are red with the cap at 34 and green at 49, both
   checked. There is also a question file for Greg.

The evidence already gathered: full `npm test` was green on stage 1 (2073 files), and `npm run
typecheck` was clean. measure-line-length.ts exited 1 on 65ch (median 70, p90 75) and 0 on 56ch
(median 60, p90 64, max 69). The four layout test files pass on the working tree (102 passed, 2
expected fail).

What to look for:
- Correctness of the CSS: anything that reads `--reading-measure` and now breaks or overflows at 56ch
  (masthead boxes, gutter position, footnotes, Quiz/Skim article-measure boxes, narrow-window.css),
  and whether `calc(var(--reading-measure) - 7ch)` resolves as intended where `ch` belongs to a
  different font size than the token was written for (a blockquote or callout with its own
  font-size or face).
- Whether `line-height: 0` on sup/sub can clip or overlap anything: footnote markers that are
  links or buttons with hit targets, focus rings, superscripts at the start of a line.
- scripts/measure-line-length.ts: does it measure what it claims? Could it pass while doing
  nothing (zero lines counted, the wrong element, an article that didn't load)? This is the check
  the rule depends on; silent success is the failure to look for.
- The `it.fails` tests: is the pattern sound, and is anything in them vacuous?
- Stale statements: anything still claiming 65ch is current, or numbers in comments that are now
  wrong.
- Docs: does the typography.md rule say something false or uncheckable?

You may fix what you find inside this scope, by editing files. Do not commit, and do not run git
commands that change the index or the working tree beyond your edits. Report anything wider for me
to decide. Do not change PROSE_ALONE_MAX_REM's value.

Finish with a line `VERDICT: ship`, `VERDICT: ship with fixes (made)` or `VERDICT: do not ship`, then
numbered findings, each saying what you changed or why you didn't.
