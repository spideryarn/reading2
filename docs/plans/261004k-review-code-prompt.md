# Review the code: the block chat as a card in the Marginalia column

You are the reviewer **and the fixer** for this stage. Your sandbox is write-capable in this
worktree. Fix what is inside this stage, narrowly and red-first (write or extend the test, see it
fail, then fix). Report, do not fix, anything wider you notice. Do not commit. Do not edit the plan
doc or anything under `docs/project/`; the answer file is your report. Do not write any sentence
attributed to Greg, in code or docs.

## The candidate

Committed. The plan and its review: `5d1bce8cf`. The build: `f2856b5f6`, plus any later commit on
this branch whose subject starts `261004k` (a browser check may have added CSS fixes to
`src/web/styles/dialogs.css` and screenshots; `git log --oneline 4995c5be4..HEAD` lists them).

`git diff 4995c5be4..HEAD --stat` is the complete list of changed paths. Start with:

- `docs/plans/261004k-block-chat-as-a-card-in-the-marginalia-column.md` (the spec, with your
  plan-review findings F1–F7 folded in) and `docs/plans/261004k-review-plan-gpt-sol.md`
- `src/web/ChatDialog.tsx` (the persistent portal container, the move, collapse, focus)
- `src/web/reader/Reader.tsx` (the host in `marginNotes`, `chatCardPlace`, `chatReopen`, fold)
- `src/web/layout.ts` (`chatCard`, `BLOCK_CHAT_IN_COLUMN`), `src/web/link-facts.ts` (`blockOfLink`),
  `src/web/useChatAnchors.ts` (`askedBesideCard`), `src/web/marginalia/MarginaliaColumn.tsx`
- `src/web/styles/dialogs.css` (§ `.chat-card-host`, `.chat-dialog.in-column`, `.chat-card-shut`)
- tests: `tests/chat-dialog-in-column.test.tsx`, `tests/chat-card-is-not-prose.test.tsx`,
  `tests/chat-card-switch-dock.test.tsx`, `tests/chat-dock-wiring.test.tsx`,
  `tests/layout-margin.test.ts`, `tests/marginalia-shut-notes.test.tsx`,
  `tests/no-block-no-summary.test.tsx`, `tests/asked-questions-in-the-comments-drawer.test.tsx`

That list does not limit scope.

## What to do

An independent attack first. Does the code do what the plan says, for a real reader? Trace the real
paths: opening from the gutter chip, "?", a prose mark, the Comments drawer and the margin line;
draft becoming thread; close; collapse and reopen; a resize across the threshold; a fold; `?thread=`
changing under a mounted dialog; the switch on `"dock"` giving exactly 261003p's behaviour. Check the
plan-review findings F1–F7 are each really closed, not just mentioned. Run the test files above
yourself (they need nothing outside the tree) and `npm run typecheck`. Say which tests you ran and
their result. A finding you reproduced outranks one you reasoned to.

Tests that never went red during the build, by the builder's own account, and so prove nothing yet:
in `tests/chat-dialog-in-column.test.tsx`, the dock/float fallback, the disconnected-host fallback,
the container leaving the host on close, no collapse control on a draft, a collapse not carrying
over to another conversation, help sent once across moves, the open editor surviving a move; and
all of `tests/chat-card-is-not-prose.test.tsx` (it relies on an in-test control). Mutate the code
under each and say whether the test notices.

## Output

Severity by consequence: **P0** data loss, security, charging, or broadly unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or maintainability
risk; **P3** prose. Each finding **established** or **reasoned**. Continue the ID sequence from the
plan review: start at `F8`. For each: what, the evidence, and either *fixed* (with the test that
went red) or *reported*. First line: *land* / *land after fixes (applied)* / *rework*.

## The builder's own doubts (already ours, worth less; spend most of the run elsewhere)

- The home div's ref callback must run before the portal subtree's layout effects, or the composer
  measures itself detached.
- The DOM is read during render (`keep(container)`), after the `caretWasInside` precedent.
- When `chatOpenBlock` changes under a mounted dialog the old host unmounts one commit before
  `Reader` hears; the panel goes home for that commit and focus inside is lost.
- Opening a card on a block that already has notes remounts that block's `MarginNotesSlot` (it
  becomes a fragment child), so an opened shut line there closes.
- The collapsed line shows the first line of the answer as raw markdown.
- Expanding after an answer finished while collapsed restores the old scroll offset, not the bottom.
- `CommentDialog`'s "open thread" path does not bump `reopen`.
- `preventScroll` on the close-button focus is unconditional.
- The `asked` filter keys on the card being wanted, not on the host being in hand.
