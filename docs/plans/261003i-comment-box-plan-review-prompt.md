# Plan review: 261003i the comment box never loses a draft, and Ask AI is a button

Read-only review of a PLAN:
docs/plans/261003i-the-comment-box-never-loses-a-draft-and-ask-ai-is-a-button.md, in this worktree.
Read it, then: src/web/AnnotateDialog.tsx (all of it, header comment included),
src/web/reader/Reader.tsx (`selectProse`, the `<AnnotateDialog>` mount and its `onSave`, around
lines 2140–2170 and 3020–3090), src/web/useComments.ts (`create`, `loaded`, the queue, tombstones),
src/web/TouchSelectionChip.tsx, src/web/useEscapeToClose.ts, src/web/useDictationField.ts,
src/web/PlaceOnCriterion.tsx, docs/project/comments.md (§ What a comment is now, § Copying the
passage, § Deliberate limits), docs/postmortems/260908c-an-opening-read-can-erase-a-later-write.md,
tests/one-escape-closes-one-surface.test.tsx, tests/opening-read-gates-writes.test.tsx,
tests/annotate-dialog-copy.test.tsx.

Answer:
1. Are the five loss paths the plan lists real, and is there a sixth (e.g. CommentDialog or
   ChatDialog opening in front, a mode change, Referee mode, the touch chip's remount key, the
   `key` on the anchor that the Copy fix added)?
2. Is "flush in the anchor-change effect, in the × / Escape handlers, and in an unmount cleanup"
   implementable as described in React 19 with StrictMode (double-invoked effects, cleanup running
   with stale closures, state setters after unmount)? If the dialog is keyed on the anchor, the
   anchor-change effect never runs and unmount is the only hook: say which it is and what the plan
   must state. Can one draft be saved twice, or a draft be saved against the wrong anchor?
3. The `loaded` question the plan asks you: should `useComments.create` hold a create until the
   opening read lands, or should the flush go regardless? Which is the smaller correct change?
4. Dictation: is "store the last settled text" well-defined in useDictationField, and safe?
5. Removing the tick-box for an Ask AI button: the header of AnnotateDialog.tsx argues the
   opposite (your own review of 260828a). Greg has now asked for the button in so many words. Is
   there a failure the button reintroduces that the plan should guard (a double press, Enter in the
   textarea, ⌘+Enter, the paid call firing from a flush)?
6. Is anything in "What is not changed" wrong, and is there a simpler version?

My suspicions, last: an unmount cleanup that calls a parent callback which sets parent state; and
Reader's `onSave` calling `setAnnotating(null)` after a new selection has already replaced it.

Severity P0–P3, IDs D1, D2, …, file:line evidence, a concrete change to the plan. Verdict: build
as planned / build with changes / rethink.
