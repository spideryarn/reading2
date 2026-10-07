- **D1 — P2.** Input: incorrect step statuses in the first skipped-progress write. **Reasoned; fixed, Postgres unrun.** Assertions inside the `noteProgress` spy were swallowed by tolerant `note()`. The test now captures the steps and asserts outside the catcher. Repaired C3 is sound; no equivalent false-pass found in the other reviewed tests.
- **D2 — P2.** Input: an implementation that writes the receipt in an awaited second transaction. **Reasoned; coverage added, Postgres unrun.** Both replay regressions reject memory-only receipts but could accept this non-atomic implementation. Added a distinct metadata product, transaction rollback checks, a rejected-attempt check, and a successful-write control.
- **D3 — P3.** Input: failed progress writes followed by pause. **Reasoned; fixed.** The pause comment still credited `noteProgress` with storing completion. It now credits the product transaction.

**C1 is closed by code inspection.** I found no production commit path where a forced step’s product lands without its `done` receipt.

`keepStepIn`, `releaseStepIn`, and `finishIn` cover keep, release, and final publication in the product transaction. Stand-in publication and successor enqueueing remain inside that transaction. `NeedsAnotherWindow` commits no completed step product; earlier completed receipts survive.

`keepStepIn` updates only `steps`. It preserves Stop, title, lease, and requeue fields. The fence checks job ID, attempt, running status, and live lease. It has **no independent owner predicate**: ownership is established by the owner-scoped claim and article session; the attempt token authorizes subsequent writes. Preview writes drain before commit, and newer attempts fail the fence.

Fence failure throws and rolls back the product. The coordinator stands down as busy; expiry recovery can subsequently requeue the job. `finishStepRun → requireLiveJobOwnsDraft → liveJobDraft` already takes `FOR UPDATE`. The existing article→job order remains; no new inversion with claim, progress, pause, or Stop was found.

Tolerant continuation cannot repeat a committed forced step merely because its notes failed. This does not guarantee exactly-once payment for work lost **before commit**, discarded drafts, or explicit Retry. Retry deliberately restores the original force set and can repeat calls without checkpoints. Those wider behaviours are unchanged.

Changed [jobs-walk.test.ts](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/tests/jobs-walk.test.ts:1266) and one comment in [pg-jobs.ts](/var/tmp/spideryarn-worktrees/sweep7-jobs-tier0/src/store/pg-jobs.ts:1440). No commits or reader-facing copy changes.

Validation:

- Offline suite: **14/14 passed**.
- Full typecheck passed; final tests-project typecheck passed.
- Test-file lint clean. Store-file lint retains one existing `noImplicitAnyLet` error.
- `git diff --check` passed.
- **No Postgres, network, or `npm test` run.** Postgres additions remain explicitly unrun.

**Verdict: ship with these fixes applied.** Run the repaired and added Postgres cases before landing. General discovery closes after this round.