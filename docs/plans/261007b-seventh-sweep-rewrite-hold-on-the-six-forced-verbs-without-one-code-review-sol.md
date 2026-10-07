**C1 — P1: Retry reopens the paid-run gap.** Input: force a run → job fails → press Retry → retried job finishes → completion GET remains pending. Reproduced red-first: the old result stays visible and forced controls become enabled. **Fixed** at the shared `useStepJob`/hold seam for all twelve hooks. Retry now records its replacement job ID in the hold. Disabling the registration produced **12 failures**; restoring it produced **12 passes**. Tests: `Retry holds…` and the picture-hook `Retry seam` cases.

**C2 — P2: FAQ/Citations docs still overstated Metadata’s exclusivity.** Input: current list plus a refused start. Reproduced: both panels offer *Find them again* in the foot. **Fixed** both docs; retained two panel tests for that control and its forced action.

**C3 — P1, wider: an unseen terminal job can leave a dead control.** Input: start a rewrite → close band → job fails → terminal row is trimmed → reopen onto the unchanged result. **Reproduced in all six**: repeated online *Try again* reads leave the hold active. **Not fixed**; this is an existing shared release limitation requiring a decision about missing job outcomes. Test: `an unseen terminal job trimmed…`. A page reload clears it.

**C4 — P1, wider: CommandBar “Run again” bypasses mode holds.** Input: use that row while the mode is held. **Reasoned from code**: [CommandBar.tsx](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/src/web/CommandBar.tsx:561) posts directly, then navigates to Metadata. **Not fixed**. Navigation does not protect the POST. Quotes’ separate *Find more* row reaches the held mode hook.

Files changed:

- [useStepJob.ts](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/src/web/useStepJob.ts), [rewrite-hold.ts](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/src/web/rewrite-hold.ts).
- [rewrite-hold tests](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/tests/rewrite-hold.test.tsx), FAQ/Citations panel tests and docs.
- [Stage plan](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/docs/plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md) and [Retry postmortem](/var/tmp/spideryarn-worktrees/sweep7-rewrite-hold/docs/postmortems/261007b-an-alternate-paid-action-bypasses-the-completion-fence.md).

Validation counts, with overlapping suites:

| Check | Result |
|---|---|
| Complete hold suite | **331 passed, 24 skipped, 0 failed** |
| Retry registration mutation | **12 failed, 343 skipped** → restored: **12 passed, 343 skipped** |
| FAQ/Citations claim reproduction | **2 failed, 155 skipped** |
| Complete FAQ/Citations suites | **157 passed** |
| Eighteen fixture suites | **726 passed** |
| Six shared-job/doc-link regression suites | **90 passed** |
| Typecheck script | **4 projects passed; 3,344 source files covered** |
| `git diff --check` | Passed |

**Verdict: ship with these fixes applied**, for the scoped stage.

Wider notes: the membership scanner misses `{["force"]: true}` and later `request.force = true` assignments; those limitations are documented. I found no fixture masking issue, sentence mismatch, or further inaccurate rewritten claim. Ordinary failure, cancellation, unchanged-result, offline-recovery and article-navigation cases pass. No further reader-facing sentences, forbidden-file edits, commits, network calls or `npm test`.