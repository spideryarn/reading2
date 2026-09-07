## Verdict

**Refuse.** I found three established P1 defects; no P0.

### F9 — P1 — established: Debate understates the paid work being authorized

The generic confirmation says “Another model call” ([Metadata.tsx:1211](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1211)), but Debate normally makes two separately metered calls ([debate.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/debate.ts:35)). Debate receives the generic copy at [Metadata.tsx:1293](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1293).

This also makes the accepted F2 exposure worse than the plan claims: its “one model call per lease window, bounded at three” statement can be **two calls per window, six calls total** for Debate. I am not reopening F2’s queue remedy; this is a newly exposed disclosure error inside one step.

(a) Open the Debate row and press “Run it again.” The confirmation promises one additional call. Allow both Debate passes to succeed: two calls are metered. If the claimant dies after those calls but before commit, the accepted lease policy can repeat both.

(b) Add a Debate-specific confirmation: at minimum, “Up to two separately metered model calls…” Preferably include its existing measured cost—typically $0.13–0.20, up to about $0.27—and add a test asserting Debate does not receive the generic sentence.

### F10 — P1 — established: failure Retry restores a one-click paid control

After a retryable failure, `JobProgress` renders a Retry button which immediately calls `failed.retry` ([JobProgress.tsx:263](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/JobProgress.tsx:263)). `RerunRow` passes the callback through unchanged; it never enters `asking` ([Metadata.tsx:1349](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1349)). That callback posts directly to the retry route ([useStepJob.ts:624](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/useStepJob.ts:624)), and the server carries the original force flag into the new job ([jobs.ts:3940](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/jobs.ts:3940)).

Thus a Retry re-buys the forced paid step without showing the cost confirmation. Each retry is also a new job with its own lease budget. This is distinct from F2’s automatic requeue.

(a) Force Quotes, Sketch, or Debate to fail after making a paid request but before producing a valid result. The row shows Retry. One click queues the forced step again; there is no confirmation.

(b) In `RerunRow`, represent the pending action as `run | retry`, wrap `failed.retry`, and send both paths through the appropriate confirmation before invoking `start` or the original retry callback. Add a Metadata-level failure/Retry test; the existing generic `JobProgress` test intentionally proves the current direct behavior.

### F11 — P1 — established: the nine controls lack mode-specific accessible names

The mode name is a sibling `<span>` rather than part of the button’s accessible name ([Metadata.tsx:1300](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/Metadata.tsx:1300)). Consequently, button navigation announces eight indistinguishable “Run it again” controls, plus similarly ambiguous “Yes, run it,” “Cancel,” and “Retry” buttons.

The new test’s own header acknowledges this—“nine buttons … have no accessible name to tell them apart”—but uses `data-rerun-step` only to make the tests distinguish them ([metadata-rerun-section.test.tsx:37](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/tests/metadata-rerun-section.test.tsx:37)).

(a) Mount Metadata with all nine stages done and navigate through buttons using a screen reader’s button list. Arc, Quotes, Ideas, Timeline, Quiz, Sketch, and Debate are all announced simply as “Run it again.”

(b) Give every action a mode-specific accessible name beginning with its visible text, such as `Run it again — Debate`, `Yes, run it — Debate`, and `Retry — Debate`. Add assertions over computed accessible names.

## Other suspicions

- Hiding `JobProgress` during confirmation is not presently an invariant break. A still-active identical cross-tab job is deduplicated; cancelling reveals its state again. It does make the accessibility ambiguity worse when several confirmations are open.
- `done === undefined` is read only to choose “Run it” rather than “Run it again”; it does not alter the request.
- The missing `hasShelfRow` gate is safe in current production routing. `OwnedArticle` is keyed by slug, and the initial article load already proves an owned article exists. The historical foreign-fixture fallback is documented as unreachable.
- Purpose seeding is safe: slug navigation remounts `OwnedArticle` ([ArticlePage.tsx:196](/home/greg/code/spideryarn2/.claude/worktrees/worktree-rerun-a-mode/src/web/article/ArticlePage.tsx:196)); same-slug revision refreshes should not overwrite a draft.
- The direct `db.update` in the failure test does not make its assertions vacuous. It tests `failRevision`’s pointer semantics, while the existing Postgres session suite separately exercises an actual throwing stage and verifies that the reader’s revision does not move.
- Nine hooks still share one engine and one poll. Completion fan-out can request the shared refresh more than once for an externally created multi-step job, but `useOrderedRead` coalesces that to the active read plus at most one trailing read. `useNow(null)` creates no timers or rerenders, although it does leave nine harmless visibility listeners.

The two permitted suites passed: **2 files, 13 tests**. `git diff --check` also passed. I made no edits.