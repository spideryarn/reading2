# Code review (reviewer-fixer): 261003i the comment box keeps a draft; Ask AI is a button

Review AND fix, in this worktree, commit 67604b379 (`git show 67604b379`). The plan is
docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md; its review
section (your findings D1–D6, full text in docs/plans/261003i-comment-box-plan-review-sol.md)
overrides the text above it, and D4 was overruled by an Opus arbitration recorded at the end of the
plan (a flush mid-dictation stores the field as it stands). Do not re-litigate D4; do check it is
implemented as arbitrated.

Check D1–D6 in the code and hunt for anything new:

- src/web/AnnotateDialog.tsx: one instance = one anchor, one draft id, one latch. Can a draft be
  sent twice, sent against the wrong anchor, or sent with `ask: true` by anything other than the
  Ask AI button? StrictMode mount/cleanup/mount with a dirty draft. The three-state latch
  (open / done / left): after a pagehide flush the tab may be restored from bfcache with the box
  open; the builder lets a later press send again under the same id. Is that right, and what does
  the server answer if the words changed (same id, different body)? Escape: the textarea's first
  Escape still clears; the box's Escape flushes. Discard really discards, including on the unmount
  that follows it.
- src/web/reader/Reader.tsx: `key={annotateKey(...)}`; onSave uses the passed anchor; the
  conditional close; `leaving` → `createOnLeave`; Ask AI's chat draft uses the passed anchor.
- src/web/useComments.ts: `create` held until the opening read settles (answered, failed, timed
  out); behaviour when the hook unmounts or the slug changes while held; tombstones and the
  per-comment queue against a held create (delete or edit of a row whose create is still held);
  `createOnLeave` builds the same request as `create`. Does holding change any existing caller
  (the gutter bookmark, `makeBlockBookmarker`, the touch chip path, Referee placement)?
- Reader-facing copy: help-topics.tsx, help-modes.tsx, Dock.tsx — is anything now untrue
  (e.g. promising a save on leaving that is only best effort)?
- docs/project/comments.md § The box a selection opens and § Deliberate limits; dictation.md.

Fix what is inside this change, narrowly and red-first; report anything wider. Run
`npx vitest run tests/annotate-dialog-keeps-a-draft.test.tsx
tests/use-comments-create-waits-for-the-opening-read.test.ts tests/annotate-dialog-copy.test.tsx
tests/opening-read-gates-writes.test.tsx tests/one-escape-closes-one-surface.test.tsx
tests/touch-selection-chip.test.tsx tests/referee-placement.test.tsx` and typecheck via
`node --import tsx scripts/typecheck.ts`. Postgres-backed tests are mine to run: name any you want
(e.g. the same-id-different-body create). Do not commit. IDs B1, B2, …; P0–P3; file:line; fixed or
not; the test. Verdict: land / land after fixes (made) / do not land.
