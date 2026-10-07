The implementation is fine after these small fixes. No remaining correctness defects found.

1. **Low — fixed:** [FeedbackEarlier.tsx:106](/var/tmp/spideryarn-worktrees/feedback-20k/src/web/FeedbackEarlier.tsx:106) accepted over 50 reports when `more:false`. This pre-existing gap now rejects oversized pages regardless of `more`; regression observed red before fixing.

2. **Low — coverage added:** [admin-feedback-store.test.ts:453](/var/tmp/spideryarn-worktrees/feedback-20k/tests/admin-feedback-store.test.ts:453) lacked the earlier review’s requested UTF-8, escaped-text, equal-timestamp size-boundary, and exhausted-page assertions. Added them.

3. **Low — fixed:** [feedback-payload.ts:463](/var/tmp/spideryarn-worktrees/feedback-20k/src/feedback-payload.ts:463) still referred to multiple boxes. Corrected the comment.

Both lists preserve whole bodies; continuation flags and the admin cursor are correct. The migration only loosens the CHECK. No active consumers of the old caps remain.

Validation: **198 unit tests passed**, full typecheck passed via Node, scoped lint passed. The specified five-file rerun was attempted but blocked by sandbox-denied Postgres access (`EPERM`), so the expanded database tests still need rerunning. Nothing committed.