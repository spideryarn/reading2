# Code review (reviewer-fixer): 261004f selecting applies the highlight

Review AND fix, in this worktree, commit eff2e764c (`git show eff2e764c`). The plan is
docs/plans/261004f-selecting-applies-the-highlight-and-the-box-customises-or-removes-it.md. Its
section "GPT Sol's plan review … and the design changed" REPLACES the earlier design sections: the
row is written on selection and the box is CommentDialog. The builder's "As built" section at the
end lists four things it added beyond the brief; treat those as unreviewed design, not as settled.

Check, and hunt for anything new:

- src/web/reader/Reader.tsx `selectProse` (mouse and touch), `fresh`, `closedFresh`, the guards
  copied from `bookmarkBlock`, the effect that clears `fresh`, `openCommentDialog` ignoring the id
  the same gesture just closed. Can two creates fire for one selection (StrictMode, a second
  mouseup, the gutter)? Can the box open on the wrong comment, or over another surface? Can
  overlap correction delete a row the reader wanted (touched but not yet stored as touched; a
  different block; a later gesture; touch)?
- src/web/CommentDialog.tsx `fresh`: click-off (the React-path "inside" test with portals, and
  that nothing is prevented or stopped), blur-before-close committing typed words, "Remove
  highlight", the hint, "Copy, don't highlight" following the real clipboard outcome, the native
  `copy` listener (what if the selection is some other text; what if the copy happens inside the
  box's textarea), `pristine` plus the `touched` flag.
- src/web/TableView.tsx: the one-shot latch so the click ending a drag does not follow a link or
  cross-reference; the same-words guard. Do they change any existing click behaviour (a plain
  click on a link after an earlier selection; a mark click; the block-selection tap on touch)?
- src/web/selection.ts `selectAnchor` (restoring the selection after the mark repaints): can it
  select the wrong words, steal a selection the reader has since made, or run after the box closed?
- src/web/useComments.ts: the `pagehide` replay of unsettled creates — once only, tombstoned ids
  skipped, no double row after a bfcache restore, and no interaction with yesterday's held-create
  ordering (B2, B3, C1, C2).
- A failed create: no box, no paint, the Dock told. A visitor: nothing. Referee: the old draft box,
  byte-for-byte in behaviour.
- docs/project/comments.md and touch.md, and help-topics.tsx / help-modes.tsx / Dock.tsx: anything
  untrue of the code. If you edit a doc, do not put words in Greg's mouth: quotes of him must be
  his verbatim words from the plan.

Fix what is inside this change, narrowly and red-first; report anything wider. Run
`npx vitest run tests/selecting-applies-the-highlight.test.tsx tests/touch-selection-chip.test.tsx
tests/use-comments-create-waits-for-the-opening-read.test.ts
tests/annotate-dialog-keeps-a-draft.test.tsx tests/one-escape-closes-one-surface.test.tsx
tests/short-selection-in-a-mark.test.tsx tests/highlight-marks.test.tsx` and typecheck via
`node --import tsx scripts/typecheck.ts`. Postgres-backed tests are mine: name any you want.
Do not commit. IDs F1, F2, …; P0–P3; file:line; fixed or not; the test.
Verdict: land / land after fixes (made) / do not land.
