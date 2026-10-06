# Code review: 261006j — Ask in chat sends the question

You are reviewing **built code**, and you may fix what you find. Work in this worktree only.

## The candidate

- One commit on this worktree's branch, on top of `765c1f2f6` (`dev`): **`2d3fb0166`**.
- `git show --stat 2d3fb0166` lists every changed path; `git diff 765c1f2f6 2d3fb0166` is the diff.
  Do not use a merge-base range.
- The plan, with the decisions and the plan review's outcomes:
  `docs/plans/261006j-ask-in-chat-sends-the-question.md`. Your own plan review is
  `docs/plans/261006j-ask-in-chat-sends-plan-review-sol.md`; its log section says what was done
  with each finding, including PR-3, which was overruled after Opus arbitrated.

## Where to start (this does not limit scope)

- `src/web/modes/conversation/ConversationModes.tsx`: `ChatHandoff.send`, `beginHere`, the
  hand-off effect, `sendTo` and `sendToRef`.
- `src/web/reader/Reader.tsx`: `handToChat` and its senders, `lensInChat` and its two wrappers,
  `onDiscuss`, and the Ask AI branch that sets `sendNow`.
- `src/web/ChatDialog.tsx`: `sendNow`, `sendsItself`, `sentNowFor`.
- Copy: `src/web/OriginChat.tsx`, `src/web/DebatePanel.tsx`, `src/web/help/help-modes.tsx`,
  `src/web/help/help-topics.tsx`.
- Tests: `tests/conversation-band-handoff.test.tsx`, `tests/help-sends-once.test.tsx`,
  `tests/glossary-ask-in-chat.test.tsx`, `tests/glossary-and-citations-ask-in-chat.test.tsx`,
  `tests/debate-check-claim-in-chat.test.tsx`, `tests/debate-lens-in-chat.test.tsx`,
  `tests/summary-ask-in-chat.test.tsx`, `tests/command-bar-suggest.test.tsx`.

## What it is meant to do

Greg: *"When I click "ask in Chat" anywhere, automatically submit the input (rather than just
prefilling the input box and waiting for me to hit send)"*.

A press on any of these now sends the question as a fresh conversation's first message, once:
Glossary's two *Ask in chat*, Citations' *Ask in chat*, Debate's angle box and *Check this claim
in chat*, the follow-up box under an AI explanation, and the comment box's Ask AI. Two still wait
in the box by decision: the Summary paragraph button (no question in it yet) and the command bar's
suggested chat row (worded by a model from the reader's profile; the privacy page promises it is
sent only on Send).

## What to do

Independent pass first. Look for, at least:

1. **A double send, a send into the wrong conversation, or a send that should not happen.** Each
   costs the reader a model call. StrictMode, a re-render with a new target identity, a mode
   change and return, the list landing late, a corrected thread id, a failed first POST.
2. **A lost origin**, or one attached to the wrong conversation.
3. **The two that must still wait.** Can either now send? In particular, is there any way the
   command bar's row reaches the sending path?
4. **Ask AI.** Is the comment always stored before anything is sent, and does `sourceCommentId`
   still reach the server?
5. **Anything the old pre-filled state was quietly protecting**: focus, the soft keyboard, drafts
   bookkeeping (`markFresh`, `submitted`, `destination`), Live's `awaitsOrigin`.
6. **Tests that cannot fail**, and **copy or docs that still say the question waits for Send**
   where it no longer does (or say it sends where it still waits).

Run test files yourself where they need nothing outside the tree (these are jsdom tests with the
network mocked, so they should run): `npx vitest run tests/<file>`. `npm run typecheck` too.

**Fix what is inside this change, narrowly, red test first. Report, do not fix, anything wider.**
Do not commit. Do not touch `.env.local`, `infra/`, or anything under
`docs/project/security-map.md`'s defences.

## Output

Findings with an ID each (`CR-1`, …), a severity (**P0** loses data, spends repeatedly or breaks
chat; **P1** a correctness bug; **P2** a real improvement, not required; **P3** a nit), the file
and line, whether you **fixed** it or are **reporting** it, and for a fix the test that was red.
List every file you edited. End with one line: `VERDICT: ship` / `VERDICT: ship with my fixes` /
`VERDICT: do not ship`.

## My own doubts (read last)

- `sendToRef` is assigned during render and read in an effect.
- There is no app-level test that `Reader` wires `sendNow` for the follow-up box and Ask AI, or
  "wait" for the command bar; the dialog and the band are tested, and a browser check covers the
  wiring once by hand.
