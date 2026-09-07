Refuse. Three established P1s remain.

### Findings

**F12 — P1, established: Debate’s confirmation gives a disproven cost ceiling.**

- (a) Pressing Debate’s Run button shows “up to about $0.27” at [Metadata.tsx:1277](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1277). Its cited experiment records a completed run costing `$0.3527` and explicitly corrects the guidance to `$0.20–0.40 for a short article, rising with length` at [the spike results:190](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/plans/260905f-debate-mode-stage-0-spike-results.md:190). The confirmation therefore understates the purchase it guards.
- (b) Replace the ceiling with the measured range and length qualification. Keeping it inline is reasonable while this is the only reader-facing Debate price; sharing it with `SKETCH_PRICE` would not improve correctness.

**F13 — P1, established: assistive-technology users can confirm without hearing the cost sentence.**

- (a) Keyboard-focus Run, then activate it. The focused `JobProgress` button is removed and replaced by the branch at [Metadata.tsx:1403](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1403); focus falls back to `BODY`. The sentence is an unlabelled, non-live sibling span at line 1405, while Yes has only an `aria-label` at line 1416—no `aria-describedby`. Navigating to Yes therefore announces “Yes, run it — Debate,” but not “two model calls” or the price. The new test checks only the literal `aria-label`, so it misses both focus and description.
- (b) Give the sentence a stable ID, point Yes at it with `aria-describedby`, and move focus to Yes when the confirmation opens. Test `document.activeElement` and the resolved description target.

The mode-specific accessible names themselves are distinct and correctly contain the visible label; this finding concerns the confirmation sentence, not F11’s naming composition.

**F14 — P1, established: an obsolete Retry confirmation hides a newer job and Yes silently does nothing.**

- (a) Open a retry confirmation, then let another tab retry the job or introduce another matching queued job. `useStepJob` changes `failed` to `null`, but `pending` remains `"retry"`, so [Metadata.tsx:1403](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1403) continues hiding `JobProgress`. Pressing Yes reaches `failed?.retry?.()` at line 1425, does nothing, and closes the confirmation. Until then it also hides the active job’s progress, Stop control, and stalled warning.
- (b) Invalidate a pending retry when its retry callback disappears, and let an active `job` take precedence over confirmation UI. Add the other-tab/new-job interleaving to the test.

**F15 — P3, established: the evergreen queue documentation miscounts the variants.**

- (a) [ingest-queue.md:764](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/docs/project/ingest-queue.md:764) says four rows have their own copy but names only Glossary, Sketch, and Debate. Six—not five—rows use the default variant.
- (b) Change the counts to three special rows and six default rows.

**F16 — P3, established: the corrected staleness paragraph names the wrong storage fact.**

- (a) [Metadata.tsx:130](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:130) says `tree.json` and `arc.json` now carry the hashes. `Arc` carries `sourceHash`; `Tree` does not. Under the Postgres store, hierarchy currency comes from `revision_step_runs.input_hash` via `hierarchyCurrency`, and there is no filesystem `tree.json` store anymore.
- (b) Say that the Postgres store can answer because the hierarchy run records its input hash and Arc carries its source hash.

The paragraph’s substantive conclusion is otherwise correct: `done` conflates presence with currency, and adding explicit presence is the right deferred fix. The `SOON` removal is also sound.

### Suspicions

1. Rebuilding `failedAsking` causes no identity or stale-closure problem. Reading the current `failed` is preferable, but it exposes F14’s missing invalidation.
2. The outliving retry confirmation is an established P1, as F14.
3. Inline is appropriate; the value and “up to” claim are wrong.
4. Optional `about` is appropriate for a component whose ordinary pages contain one band. The aggregate Metadata surface is the caller that must provide it.
5. Hiding `JobProgress` remains acceptable only while confirmation state and job state cannot diverge. F14 shows they can; `aria-label` does not change that.

Verification: both requested suites passed, 2 files and 16 tests. `npm run typecheck` could not start in this sandbox because `tsx` was denied its `/tmp` IPC pipe (`EPERM`); no type error was reached. No files were changed.