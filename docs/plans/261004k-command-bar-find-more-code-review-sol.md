## Findings

**F10 — P1 — established — fixed.** Before the first job poll, `job === null` means “unknown,” but both handoffs treated it as “idle” and started another paid run. The two red-first tests each observed one incorrect call before the fix: [find-more-from-the-command-bar.test.tsx:433](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/find-more-from-the-command-bar.test.tsx:433) and [find-more-from-the-command-bar.test.tsx:498](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/tests/find-more-from-the-command-bar.test.tsx:498). This contradicts the queue contract at [useStepJob.ts:263](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/useStepJob.ts:263).

Fixed by carrying `loaded` through both owners, requiring it in the shared offer predicate, waiting before consuming the handoff, and withholding the bands’ run buttons while job state is unknown: [find-more.ts:127](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/find-more.ts:127), [GlossaryPanel.tsx:298](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/GlossaryPanel.tsx:298), [QuotesPanel.tsx:835](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/QuotesPanel.tsx:835), [useGlossary.ts:757](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/useGlossary.ts:757), and [useQuotes.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/useQuotes.ts:154).

Changed those five source files, the two Find More test files, and the eight typed owner-fixture test files reported by `git status`.

**F11 — P1 — reasoned — not fixed; wider shared-queue repair required.** F10 closes only the first-ever-poll hole. `loaded` remains true forever after any successful poll; it does not mean the snapshot was reconciled after this handoff ([jobEngine.ts:136](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/jobEngine.ts:136), [jobEngine.ts:620](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/jobEngine.ts:620)). Opening a band either begins an asynchronous poll or, when an idle timer exists, does not poll immediately ([jobEngine.ts:846](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/jobEngine.ts:846)); meanwhile the handoff consumes and presses on a zero-delay timer ([useFindMoreHandOff.ts:64](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/useFindMoreHandOff.ts:64)).

Therefore a previously loaded but stale `jobs: []` snapshot can still start beside a cross-tab job. Server deduplication is incomplete protection because profile participates in the work key ([jobs.ts:81](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/store/jobs.ts:81)): Quotes Find More preserves a plain list’s `useProfile: false` ([QuotesPanel.tsx:830](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/QuotesPanel.tsx:830)), while Metadata Run again uses the current profile ([CommandBar.tsx:537](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/web/CommandBar.tsx:537), [routes.ts:10564](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/routes.ts:10564)). Those jobs can both queue and spend.

A sound fix needs the shared engine to expose a fresh reconciliation revision or promise and make the handoff wait for a successful poll newer than its arrival. A local delay or the existing `loaded` boolean cannot establish that fact.

**F12 — P3 — established — partly fixed.** The source and overview said “six to ten” aliases, but Structure has twelve. The source docblock now says six to twelve at [mode-catalog.ts:158](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/src/mode-catalog.ts:158). I also corrected the plan’s three facts that its F9 disposition claimed had already been corrected: [plan:17](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md:17).

The entry-point overview still says six to ten at [reading-view-overview.md:406](/home/greg/code/spideryarn2/.claude/worktrees/fbrbxrgc-command-bar-find-more-aliases/docs/project/reading-view-overview.md:406). I did not edit that load-bearing document without the required before/after approval.

No nickname ranking defect surfaced. Every requested matching test passed, the Help sentence matches the implementation, and I found no new attribution to Greg beyond the two supplied sentences. I agree with all three deliberately-left items, including leaving F8 for the paid evaluation.

Checks:

- Requested five test files: 125 passed, 2 skipped.
- Extended affected set: 251 passed, 2 skipped.
- Typecheck script: all four projects passed; all 3,036 source files covered.
- Changed-file lint: no errors; four existing informational diagnostics.
- `git diff --check`: clean.
- Full `npm test` could not run because local Postgres was unavailable.
- No commit made; pre-existing untracked review files and screenshots were untouched.

VERDICT: do not land