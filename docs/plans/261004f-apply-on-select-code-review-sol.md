Verdict: **land after fixes (made)**. No unresolved P0–P3 findings. Nothing committed.

### Findings

- **F1 — P1 — fixed:** A `pagehide` replayed create could finish after a later DELETE and restore the removed highlight. Reused IDs could also forget an older replay barrier. Fixed by retaining and awaiting every replay promise before deletion. [useComments.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/useComments.ts:397), [test](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/use-comments-create-waits-for-the-opening-read.test.ts:724). Both regressions failed before the fix.

- **F2 — P1 — fixed:** “Copy, don’t highlight” lost its removal when the dialog unmounted. A first fix exposed a worse race: reopening and editing the highlight before the clipboard answered could delete the changed row, including unblurred typed words. Duplicate pending copies could also issue multiple deletes. The outcome is now checked against current parent-owned state and claimed once. [CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/CommentDialog.tsx:870), [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2402), [tests](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selecting-applies-the-highlight.test.tsx:865). Close/reopen/recolour and close/reopen/type-without-blur tests failed before their fixes.

- **F3 — P2 — fixed:** Native copy from the dialog textarea could delete the highlight when the document retained the old prose selection. Editor-originated copy events are now excluded. [CommentDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/CommentDialog.tsx:322), [test](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selecting-applies-the-highlight.test.tsx:1004).

- **F4 — P2 — fixed:** `closedFresh` could survive completed mouse, touch, or pen gestures and suppress a later keyboard/assistive-technology activation. Mouse state now clears after `mouseup`; non-mouse state clears on `pointerup`. [Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/reader/Reader.tsx:2432), [tests](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selecting-applies-the-highlight.test.tsx:747).

- **F5 — P2 — fixed:** TableView’s drag latch could survive a missing click and swallow a later keyboard link activation. Keyboard clicks now consume but do not obey the stale pointer latch. [TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/src/web/TableView.tsx:1324), [test](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/selecting-applies-the-highlight.test.tsx:616).

### Verification

- Requested seven suites plus `use-copy` and `internal-links`: **9 files, 233 tests passed**.
- `node --import tsx scripts/typecheck.ts`: passed all projects; all 2,978 source files covered.
- `git diff --check`: passed.
- Scoped lint only reported the existing complexity diagnostics and existing TableView `dangerouslySetInnerHTML` diagnostic.
- Full `npm test` could not start its Postgres lane: local Postgres at `127.0.0.1:54362` was unavailable. The relevant Postgres-backed follow-up is [store-comments.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbrze8qh-span-highlights/tests/store-comments.test.ts), particularly repeated same-ID/idempotent creation.

The visitor, failed-create, Referee, overlap, touch, surface-guard, and selection-restoration cases remain covered and passed. The reviewed docs/help copy matches the implementation; no documentation edits were needed. The pre-existing untracked review-prompt file was left untouched.