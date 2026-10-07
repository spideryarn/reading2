# Code review: the command bar's Run again row honours the rewrite hold

You are reviewing a small fix in this repo (worktree root is your cwd). Read AGENTS.md's working
agreements first, then:

- the plan: docs/plans/261007i-command-bar-run-again-row-honours-the-rewrite-hold.md
- the finding it fixes: docs/plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md § Left (C4)
- the diff: `git diff HEAD` (src/web/rewrite-hold.ts, src/web/CommandBar.tsx, tests/rewrite-hold.test.tsx, docs)
- the hold: src/web/rewrite-hold.ts in full; the row: src/web/CommandBar.tsx § rerunRows

The brief: "Run again" goes through the same hold as every other way of starting a forced run;
reuse the existing hold, no second mechanism; flip the pinning test.

Check in particular:

1. Is `rewriteHeld` exactly the check `run` makes (epoch fence included)? Any state where the row
   refuses forever, or lets a second run through while a mode's controls are held?
2. Step-name mismatch: is every hold keyed by the same StepName the row's METADATA_RERUN_STEPS uses
   (e.g. Thread = "tweets", Skim, Illustrated, Sketch)? A mode whose hold key differs would make
   the check silently a no-op for that mode.
3. Is the test a real test of the fix (it was seen red: `expected { kind: 'close' } ...`)? Would it
   catch a regression where the row refuses but still posts?
4. The reader-facing sentence, the docs and the postmortem: accurate?

You may fix what you find inside this scope (write-capable), then run
`npx vitest run tests/rewrite-hold.test.tsx tests/command-bar-rerun-and-find.test.tsx` and
`npm run typecheck`. Do not commit. Report: findings (severity, file:line, evidence), what you
changed, gate results, and a one-line verdict.
