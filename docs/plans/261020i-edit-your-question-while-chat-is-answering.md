# Edit your question while Chat is still answering

Up: [plans.md](../project/plans.md) · Report `spya-yur0eq` (#630, SPIDERYARN-READING2-KV), queue item
`qi-85psa4wh`.

> Allow the user to edit user inputs in Chat while it's thinking, rather than having to stop it
> first and then click the Edit button.
>
> — Greg, 2026-10-19 (admin, Feedback button)

## What happens today

While an answer is arriving (`busy`: the last row is `pending`), the pencil on every question is
withdrawn (`canEdit={!busy}` in `ChatTranscript`, src/web/ChatPanel.tsx). An editor that was already
open stays open, but its **Ask again** is held: pressing it says *"An answer is still arriving. Ask
again once it has finished"* (`EditQuestion`'s `held`, from postmortem 261002g). So the reader's
route is: Stop (or Esc), wait, press the pencil, rewrite, Ask again.

## What changes

1. **The pencil stays while an answer arrives.** The reader can open the editor at any time.
2. **Ask again while an answer arrives stops that answer, then asks the rewritten question.** The
   editor stays open, says *"Stopping the answer, then asking again…"*, and submits by itself the
   moment the answer has settled (`busy` goes false). Cancel in that window abandons the rewrite;
   the stop has already happened, as if the reader had pressed Stop.

So the reader's route becomes: pencil, rewrite, Enter.

```
 busy, reader presses Ask again in the editor
   ├─ onStop(last answer)            ← the existing Stop path, unchanged
   ├─ editor shows "Stopping…"        (still open, text kept)
   └─ busy → false                    (stop settled: answer stored `stopped`)
        └─ onDone(text) → onEdit      ← the existing edit path, unchanged
```

## Why stop first, rather than send the edit straight away

The server would cope with an edit arriving mid-answer: `postChat` checks `expectedTailId`, then
runs `settleThread`, which aborts the live stream in that conversation and waits for it before
`withEdit` (src/routes.ts). And GPT Sol's plan review (F3) showed the client reducer would cope too,
**once the answer has begun**: projections apply by `seq`, `startTurn` lets two turns coexist, and
an edit's repair already tells an in-flight send apart from the rows the edit owns. The first draft
of this plan said otherwise; that was wrong.

What does need waiting for is **`begin`**. Before it, the question just asked and its answer carry
ids this tab invented, so an edit sent then names a target and a tail the server has never seen, and
is refused. Stopping first is the mechanism that waits: a stop pressed before `begin` already waits
for the answer's name (`waitingOn` in chat/reduce.ts), and the edit goes after the stopped answer
settles, by which time every id is the server's. One path for both cases, made of two that each
work. The cost is a stop's round trip, normally well under a second, and the editor says so.

**Simpler option passed over:** letting **Ask again** go through as it is, relying on the server.
Right after `begin`, wrong before it — and before it is the moment the report is about.

## Details

- **The editor's text and the queued flag live in `ChatTranscript`, not in `EditQuestion`** (Sol
  F1). `Turn` is keyed by message id and `begin` renames the question just asked, so an editor
  holding its own state lost the rewrite at exactly the moment this feature is for. The transcript
  finds the row again by index and original words (`rewriteRow`). If the editor goes away (Cancel,
  conversation switched, its row deleted), the queued ask goes with it, so no rewrite fires behind
  the reader's back.
- **An unchanged or blank rewrite stops nothing** (Sol F2): it is checked before the stop, and the
  editor closes, as an unchanged edit always has.
- **A queued rewrite is not sent if the answer ended in an error** (Sol F1, second half): that is a
  turn that failed, before `begin` one whose rows the server never had. The editor stays open with
  its text and the "Stopping…" line goes; Ask again is the reader's again.
- Which answer to stop: the last row, if it is the pending assistant row — the same one the
  Composer's Stop names (`onStop(last.id)`).
- If the stop fails (*"Couldn't stop that answer"*), the answer runs to its end, `busy` goes false,
  and the edit goes then. That is still what the reader asked for. The stop's error line stays up
  under the new answer (Sol F4): the same as pressing Stop and then editing by hand today, so not
  made worse here; accepted rather than fixed, because clearing errors on a turn's start is a
  reducer-wide change for a rare case.
- If `busy` never goes false (a stream that hangs), the editor stays open with its text and its
  "Stopping…" line; nothing is lost, and Cancel works. Same as a hung Stop today.
- The bin (delete from here) is unchanged: still withdrawn while busy. The report asked for edit.
- Live: unchanged. Edit was never gated on `speaking`; nor is this.
- Applies to every conversation kind that draws `ChatTranscript` (Chat, Recall/Learn, the guide,
  Tutorial, Explore, Quiz discussion), since they share the transcript. Good: the same complaint
  applies to each. Only Chat's help page describes the pencil, so only it changes.
- Help: src/web/help/pages/modes/chat.md gets half a sentence, and the corpus is regenerated
  (`WRITE_HELP_CORPUS=1 npx vitest run tests/help-corpus.test.ts`, Sol F5).
- The bin's place is held (invisible) beside the pencil while an answer arrives, so the row keeps
  its width; before, the whole row was a hidden placeholder.

## Tests

`tests/learn-edit-asks-again.test.tsx` already drives the real band, `useChat` and `ChatPanel` with
only the network faked. Its "an editor that cannot ask again yet says why" block describes the
behaviour being replaced; it is rewritten to the new behaviour, red first:

- with an answer arriving, the pencil is offered;
- Ask again (tick and Enter) while busy sends `/stop` for the arriving answer and **no edit yet**,
  keeps the editor open with its text, and says it is stopping;
- once the stream's `done` arrives (stopped), the edit POST goes, with `expectedTailId` the stopped
  answer;
- Cancel while queued: the edit never goes;
- the question just asked, rewritten before its answer's `begin`: the stop waits for `begin`, the
  editor and its text survive the rename, and the edit names the server's ids;
- an unchanged rewrite while busy stops nothing;
- an answer that fails before `begin`: no edit goes, the editor keeps its text.

The last two guards were each mutated out and the matching test went red.

## Deferred

Nothing from the report. Not in scope: letting the *bin* act mid-answer the same way.

## Status

- 2026-10-20: plan written; Sol plan review
  ([…-plan-review-sol.md](261020i-edit-your-question-while-chat-is-answering-plan-review-sol.md)):
  F1, F2, F5 fixed as above, F3 corrected the rationale, F4 accepted. Built (9342b0ce2).
- 2026-10-20: Sol code review
  ([…-code-review-sol.md](261020i-edit-your-question-while-chat-is-answering-code-review-sol.md)),
  which also fixed what it found: C1 (P1), a queued rewrite is re-checked when it goes, so text
  restored to the original words or cleared asks nothing; C2, a stale CSS comment. Committed as
  dbf7c55e6. Browser check (Playwright, a Sonnet subagent) passed: the pencil while streaming, a
  rewrite stopping and re-asking, a rewrite before any text arrives, an unchanged Enter stopping
  nothing, Cancel while it waits, and no console errors. Over a fast model the "Stopping…" line
  shows for under 150 ms. Full `npm test` green. Done.
