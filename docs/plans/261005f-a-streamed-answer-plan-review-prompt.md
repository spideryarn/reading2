# Plan review: 261005f — a streamed answer stays where it starts

You are reviewing a **plan**, read-only. Do not edit any file.

## The candidate

- Base: `ec37451e1` (origin/dev). The plan is untracked:
  `docs/plans/261005f-a-streamed-answer-stays-where-it-starts.md`. Read it first; it quotes the
  reader's report.
- No code has changed yet. The code it proposes to change: `src/web/ChatPanel.tsx` § `Conversation`
  (the `stick` ref, the `away` state, the effect that sets `scrollTop = scrollHeight`, `toBottom`,
  the `onScroll` handler) and § `Turn`; `src/web/styles/mode-band.css` § `.chat-scroll`;
  `src/web/styles/dialogs.css` § `.chat-dialog.in-column`. Its callers: `ChatPanel` (the band),
  `src/web/ChatDialog.tsx` (floating, docked, and the card in the Marginalia column), Remember and
  Explore (`kind`), and `src/web/live/LiveTail.tsx` (spoken lines at the end of the same scroller).
  Tests that hold today's behaviour: `tests/chat-empty-reads-from-the-top.test.tsx`,
  `tests/chat-dialog-in-column.test.tsx`, `tests/chat-latest-pill-in-flow.test.ts`,
  `tests/chat-live-handoff.test.tsx`, `tests/live-tail-handoff.test.tsx`. This list is where to
  start, not a limit.
- The measurement the plan's § The comment box rests on is in that section, with the script that
  produced it named there.

## What to do

Make your own pass first. Two questions.

1. **Is this the right behaviour?** The reader asked for "streams in, but stays in position so that
   I can start reading". The plan answers with: place the question at the top once, give it room,
   never follow streamed text, show "Latest" when the answer outgrows the panel. Say if a simpler
   rule would serve the reader as well, or if one of the options passed over was wrongly passed
   over.
2. **Does it hold in every place `Conversation` is drawn, and through every sequence?** Try to
   construct one in which the proposed rule does something worse than today's code: a send into an
   empty thread; a send into a long one; Retry and Edit (which replace the last answer); Stop; a
   stream that fails; an answer recovered after a lost stream (`recovering`); a thread opened or
   remounted while its last answer is still pending (the band and the dialog are different mounts);
   the dialog collapsed and reopened (`visible`); the composer growing or the "Latest" pill
   appearing and so shrinking the scroller mid-stream; an iPad keyboard opening; a tool strip and
   "thinking…" before the first word; a Live conversation's spoken lines arriving and then being
   saved as turns; a turn deleted; the card at and below its height cap; the room element's effect
   on anything that measures `.chat-scroll`'s `scrollHeight`. Check the claim that sizing the room
   on each streamed word adds no forced layout beyond what the effect already does, and whether
   removing the room when a hold ends can make the view jump.

You may run `npx vitest run tests/chat-empty-reads-from-the-top.test.tsx tests/chat-dialog-in-column.test.tsx`.

Severity, by consequence: **P0** data loss, security, charging, service unusable · **P1**
user-visible wrong behaviour or an authoritative contract violated · **P2** design or
maintainability risk with no wrong behaviour today · **P3** prose. Give every finding an id
(`F1`, `F2`, …), the severity, the evidence (file:line, or a test you ran), and what you would do
instead. End with a verdict line: `VERDICT: approve` / `approve with changes` / `rework`, which
takes at least one P0 or P1 to be anything but approve. Check the plan's conclusion as well as its
steps: if the "done means" line could be true while the reader's complaint is not fixed, say so.

## My own suspicions (already mine; worth less than yours — spend most of the run elsewhere)

- Whether the hold should end, and following resume, when the reader presses "Latest" mid-stream.
- Whether the card's fallback (follow until the question reaches the top) is worth its state, or
  whether the card should simply not follow.
- Whether "a pending last message that is not already held" is the right trigger, or whether it
  should be the send itself.
