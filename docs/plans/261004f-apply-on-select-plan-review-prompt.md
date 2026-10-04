# Plan review: 261004f selecting applies the highlight; the box customises or removes it

Read-only review of a PLAN:
docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md in this
worktree (HEAD includes origin/dev). It builds on 261003e, 261003i and 261004a (all under
docs/plans/, all built). Read it, then: src/web/AnnotateDialog.tsx (whole file, header included),
src/web/reader/Reader.tsx (`selectProse`, the AnnotateDialog mount and its onSave, the
TouchSelectionChip mount, `surface.current`), src/web/TouchSelectionChip.tsx, src/web/TableView.tsx
(the marks pipeline: `anchorKey`, `marksByBlock`, the mouseup click path), src/web/annotate.ts,
src/web/useComments.ts (`create`, `createOnLeave`, the held create, tombstones),
src/web/comment-nav.ts, docs/project/comments.md § The box a selection opens,
docs/project/touch.md § A finger's selection gets a button,
tests/annotate-dialog-keeps-a-draft.test.tsx, tests/one-escape-closes-one-surface.test.tsx.

Answer:
1. The central decision: a PROVISIONAL painted highlight stored when the box goes away, instead of
   a row written on mouse-up and a box that edits it. Is the reasoning sound? Is there a way the
   reader ends up believing something is highlighted that is never stored, beyond the named
   crash window (e.g. `loaded` false, a failed create after the box closed, the held create)?
2. The deferred unmount flush for StrictMode ("defer one tick, cancel if the effect runs again"):
   is it correct in React 19, with the keyed dialog, with the latch and with `pagehide`/`pageshow`?
   Is there a simpler correct way to tell a real unmount from StrictMode's simulated one?
3. Click off: pointerdown outside closes and stores. What breaks — CommentDialog/ChatDialog opening
   in front (tests/one-escape-closes-one-surface), portals, the gutter bookmark's late
   confirmation, the touch chip, a drag that starts a new selection (ordering of pointerdown-close
   and the mouseup that opens the next box), scrollbars, the Dock?
4. The provisional mark through the marks pipeline: the id space, the click path, `anchorKey`
   caching, overlap ordering with stored comments (`commentOrder` needs a `createdAt`), the hand-off
   to the optimistic row without a flicker or a double mark, and Quotes/drawer/gutter not seeing it.
5. "Overlap means correction" decided in Reader's onSave: is the information there at that moment
   (the new anchor, whether the old draft was touched, replaced-versus-closed)? Can it drop a
   draft it should keep?
6. Copy → copy-only, and Remove highlight: any state where the draft is stored after either?
7. Touch: no autofocus from the chip, clearing the selection; anything in touch.md's rules this
   breaks (block selection by tap, the chip's suppression while a box is open)?
8. A simpler version that gets Greg what he asked for.

My suspicions, last: the tick-deferred flush racing a `pagehide`; click-off closing the box when
the reader clicks the provisional mark itself; and the provisional mark surviving a failed create.

Severity P0–P3, IDs E1, E2, …, file:line evidence, a concrete change to the plan. Verdict: build
as planned / build with changes / rethink.
