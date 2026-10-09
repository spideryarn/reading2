Review completed with three fixes in [src/latexml.ts](/var/tmp/spideryarn-worktrees/fbnhhd0x-latex-junk/src/latexml.ts:649). Documentation now matches the narrowed behavior, and the root cause is recorded in [the postmortem](/var/tmp/spideryarn-worktrees/fbnhhd0x-latex-junk/docs/postmortems/261009f-dom-siblings-are-not-rendered-text-boundaries.md).

Checks: 91 LaTeXML tests and 18 doc-link tests pass; full typecheck passes; scoped lint passes with only pre-existing advisories. The live audit removed all 136 markers and corrected the citation punctuation artifacts. No ReDoS, anchor-loss, crash, `sourceNameArgument`, or `tidyTitleBlock` interaction issue was found. Full `npm test` could not start without local Postgres. Commit/push was blocked because the sandbox mounts the worktree Git directory read-only.

1. **FIXED — High:** Removing a marker at an inline-element edge joined authored words. Test: `a marker at either edge of an inline element does not join words`.
2. **FIXED — Medium:** Citation removal stranded TeX-source whitespace before surviving punctuation, producing text such as `structure ;`. Test: `citation removal does not strand source whitespace before sentence punctuation`.
3. **FIXED — Medium:** `\sep` only inspected immediate siblings, producing `alpha ; beta` across wrappers and dangling punctuation at block edges. Test: `\sep reads across inline-element edges but leaves no separator at a block edge`.

Verdict: **PASS WITH FIXES — the scoped undefined-macro rule is ready to land.**