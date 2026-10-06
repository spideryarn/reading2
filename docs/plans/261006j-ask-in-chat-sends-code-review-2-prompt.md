# Code review, round two: 261006j — a narrow check of round one's fixes

Round one (`docs/plans/261006j-ask-in-chat-sends-code-review-sol.md`) reviewed `2d3fb0166` and
fixed three P1s. Those fixes are **unreviewed code written by the previous reviewer**, committed
as **`2c75820ae`**. `git diff 2d3fb0166 2c75820ae -- src tests` is the whole of it. Discovery is
closed: this round checks those fixes and nothing else. The plan is
`docs/plans/261006j-ask-in-chat-sends-the-question.md`.

## Check, by reading the code and running the tests

1. **CR-1's fix** (`askPassageInChat` in `src/web/reader/Reader.tsx`, the `anchor` and
   `sourceCommentId` on `ChatHandoff`, `onHandoffThread`). A follow-up or Ask AI pressed while Chat
   or Learn is open now goes through the band's hand-off.
   - Can it send twice, or not at all, in either mode? From Learn, `handToChat` switches to Chat
     in the same event: does the hand-off survive `Reader`'s effect that clears it when
     `mode !== "chat"`?
   - `onDiscuss` and the Ask AI branch call `void setThread(null)` around it. Can that land after
     the band has named the new thread and leave the reader on the list?
   - Is the first message the same text the floating dialog would have sent (`askAboutBlock`,
     including the wordless Ask AI), and do the anchor and `sourceCommentId` reach the POST?
2. **CR-2's fix** (the `queueMicrotask` in the hand-off effect of
   `src/web/modes/conversation/ConversationModes.tsx`).
   - In production (one effect setup), is there any path where the effect is cleaned up before
     the microtask runs and no later setup takes the hand-off, so the press silently sends
     nothing? `Reader` clears the hand-off from `onHandoffTaken`, which now runs inside the
     microtask.
   - Any path where it takes twice.
   - Is the one-microtask window visible to the arrival rule or to `drafts.destination`?

Run `npx vitest run tests/conversation-band-handoff.test.tsx tests/conversation-band-origin.test.tsx tests/selecting-applies-the-highlight.test.tsx tests/help-sends-once.test.tsx`.

Fix narrowly, red test first, if something is wrong. Do not commit.

## Output

Findings with an ID (`CR2-1`, …), severity on the same scale (P0 to P3), file and line, fixed or
reported. List files edited. End with `VERDICT: ship` / `VERDICT: ship with my fixes` /
`VERDICT: do not ship`.
