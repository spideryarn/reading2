# Code review: chat keeps the previous answer when a Retry or Edit fails before the stream

You are reviewing commit `c6e162610` in this worktree (`git show c6e162610`). The plan, with your
own plan review and what was done about each finding, is
`docs/plans/261006d-chat-keeps-the-previous-answer-when-a-retry-or-edit-fails-before-the-stream.md`.

You may write. Two rules:

- **Fix what is inside this change**, narrowly, and each finding red-first: write the test that
  reproduces it, watch it fail, then fix. Do not commit.
- **Report, do not fix, anything wider** (the plan lists three things deliberately left: F3, F4, F5).

Look hardest at:

1. `withdrawn`, `discardedBy` and the two new call sites in `src/web/chat/reduce.ts`. Is there a
   state in which a retry or an edit that failed before `begin` now shows something false, loses a
   row, or leaves an operation live for ever? Consider: a superseded turn, a delete or cancel of the
   conversation in flight, a rename held on the turn, a conversation this tab invented (an edit or
   retry cannot be the first turn, but check), two retries, a repair superseding a repair, the
   recovery scan finding the same row.
2. `discardedBy`: it leaves out rows of other turns in flight. Is that the right set? What about a
   row a recovery is watching, or a spoken exchange in flight?
3. `turn.disconnected` before `begin` reuses `event.recovery.id` as the repair's id. Does the
   controller's `handedOver` / `finished` logic in `dispatch` (`src/web/chat/controller.ts`) notify
   `onSettled` exactly once in every ending? Is there any other reader of that id that assumes a
   recovery?
4. The tests: `tests/chat-reduce.test.ts` (the block after "gives a refused retry back the answer it
   had blanked"), `tests/chat-pre-stream-failure-keeps-the-answer.test.ts`, and the two changed
   assertions. Would each new test fail if the fix were removed? Is anything asserted that the fake
   server makes trivially true?
5. Comments and docs that the change has made false, in `src/web/chat/` and `docs/project/`
   (`chat-tools.md`, `comments.md`, anything describing what a failed retry shows).

Run `npx vitest run tests/chat-` and `npm run typecheck` before you finish.

Answer with: a verdict (approve / approve with changes / rethink); findings ranked P1/P2/P3 with
file and line; for each, whether you fixed it and the test that shows it; and the wider things you
noticed and left. Do not attribute any sentence to Greg.
