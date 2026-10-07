K3-REVIEW-c41d7e

Two established P1 findings fixed without committing; one additional visual change reported.

- **K3-F1 — P1, established; fixed.** With Include archived on and its listing loading or failed, search can return an unread archived article carrying the chosen tag. The omission line falsely called it “already opened” or outside the filters. Four reproductions failed before the fix. **Smallest fix applied:** during unavailable archive details, say only that the counted passages found are not shown. The stipulated filtering stays unchanged.

- **K3-F2 — P1, established contract violation; fixed.** Dispatch composing Escape in the tag input and inspect `event.defaultPrevented`: the candidate returned `true`. Keeping the popover open passed its original test while cancelling the input method’s key. The added native-default assertion failed. **Smallest fix applied:** contain composing Escape at window capture, scoped to the open popover, without cancelling its default; remove the listener when its content unmounts.

- **K3-F3 — P2, established; reported only.** `tw:rounded-xs` applies a radius to the details trigger itself in every state. Compiling the installed Tailwind utilities confirms this extra visible change beyond adding a focus outline. **Smallest correction:** remove that class. I left it unchanged under your instruction to report additional design changes.

The sixteen loaded-scope filter combinations pass, as do topic loading/failure and disjoint selections. Unloaded topics correctly remain unapplied, matching the cards. The seven replacement-copy groups check out. The Unread-only wording correction is justified by the server cap; both chip counts inherit their chip’s ink. Tailwind compilation confirms the `outline-none` rationale. Mouse-click outline appearance and native IME interaction remain unmeasured.

The source-label test honestly checks literals, not displayed progress. A new positive control confirms the passage test can observe a matching card.

**Validation:** 145 tests passed across seven files run individually; typecheck and diff checks passed. Scoped lint retains an existing helper-name error and Library complexity advisory. No commits made.

Changed files:

- [Library.tsx](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/src/web/Library.tsx), [ShelfTags.tsx](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/src/web/ShelfTags.tsx)
- [Passage tests](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/tests/shelf-passages-obey-the-filters.test.tsx), [popover tests](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/tests/shelf-tags-popover.test.tsx)
- [K3 plan](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/docs/plans/261007a-ui-sweep-k3-shelf-filter-and-false-copy.md), [library.md](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/docs/project/library.md)
- [Archive postmortem](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/docs/postmortems/261007b-filter-explanations-turn-missing-article-details-into-evidence-of-exclusion.md), [IME postmortem](/var/tmp/spideryarn-worktrees/agent-a68d551dd8fe8285a/docs/postmortems/261007c-cancelling-an-input-method-key-to-suppress-application-dismissal.md)

ready with these fixes