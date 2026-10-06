# Plan review: 261006j — Ask in chat sends the question

You are reviewing a **plan**, read-only. Nothing is built yet. Do not edit any file.

## The candidate

- Base: `765c1f2f6` on `dev`, in this worktree.
- The plan is an **untracked file**: `docs/plans/261006j-ask-in-chat-sends-the-question.md`. Read
  it in full first.

## Where to start (this does not limit scope)

- `src/web/reader/Reader.tsx`: `handToChat` and its six senders (about line 920 to 1000), the
  `overlay` target (about 1100), `onDiscuss` (about 4133), and the `ChatDialog` wiring (about 3960).
- `src/web/modes/conversation/ConversationModes.tsx`: `ChatHandoff`, `startNew`, the hand-off
  effect and the arrival rule (about 700 to 960), `onSend` and `onSendNew` (about 1095 to 1160).
- `src/web/ChatDialog.tsx`: `ChatTarget`, `ask`, and the "?" send-on-mount effect (`sentHelpFor`).
- `src/web/chat-handoff.ts`, `src/web/chat-draft.ts`, `src/web/useChat.ts`,
  `src/web/chat/controller.ts`.
- `src/web/CommentDialog.tsx` § `askFollowUp`, `src/web/AnnotateDialog.tsx` (Ask AI).
- Tests: `tests/conversation-band-handoff.test.tsx`, `tests/conversation-band-origin.test.tsx`,
  `tests/glossary-and-citations-ask-in-chat.test.tsx`, `tests/summary-ask-in-chat.test.tsx`.

## What to do

Make an independent pass first. Attack the plan: is it correct, is it the simplest thing that does
what Greg asked, and what will break?

Greg's words: *"When I click "ask in Chat" anywhere, automatically submit the input (rather than
just prefilling the input box and waiting for me to hit send)"*.

Check in particular, by reading the code and not the plan's account of it:

1. **Completeness.** Grep for every way a question reaches a chat composer pre-filled. Does the
   plan's table miss one?
2. **D1.** Is calling the band's send from the hand-off effect safe: before the thread list has
   loaded, under StrictMode, with a pending origin, with the arrival rule and the `drafts`
   bookkeeping (`markFresh`, `submitted`, `destination`) running in the same commit? Can it send
   twice, send into the wrong conversation, or lose the origin?
3. **D4.** Is a `sendNow` send-on-mount in `ChatDialog` safe: can the draft target reappear and
   send a second time (look at how `Reader` clears `chatDraft`), and does the latch reset correctly
   so that the same follow-up asked twice later is two sends?
4. **D2 and the deferred items.** Is leaving the Summary button and Ask AI unsent a defensible
   reading of "anywhere"? Say if you would decide either differently and why.
5. **The mis-click bounds.** Are the plan's claims true in the code?
6. **The tests.** Would each planned test have been red before the change, and would it catch a
   double send?

## Output

Findings with an ID each (`PR-1`, `PR-2`, …), a severity from this fixed scale, and the file and
line the finding rests on:

- **P0**: the plan would ship something that loses data, spends money repeatedly, or breaks chat.
- **P1**: a correctness bug or a missed entry point.
- **P2**: a real improvement, not required.
- **P3**: a nit.

End with one line: `VERDICT: build as planned` / `VERDICT: build with the P0/P1 fixes` /
`VERDICT: do not build`.

## My own doubts (read last, after your pass)

- Whether the band's `send` for a conversation begun in the same effect tick behaves like one begun
  a render earlier.
- Whether D3 (no focus) is right on a laptop.
