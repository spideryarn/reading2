# Chat keeps the previous answer when a Retry or Edit fails before the stream (qi-wymmkx8q)

Up: [plans.md](../project/plans.md). Found by
[261006a § Stage 0's code review](261006a-remember-identifiers-become-learn-all-the-way-down.md#stage-0s-code-review-gpt-sol-2026-10-06),
finding S0-2, which fixed it for one refusal only.

## The bug

Pressing Retry blanks the answer on screen, and pressing Edit rewrites the question and takes away
every turn under it. Neither is a write: both are *drawn over* what the tab already has, by a live
operation, and the stored rows are still underneath (`TurnOperation` in `src/web/chat/model.ts`).

If the request then fails **before the stream starts** — a `[db-busy]` 500, any other non-409
status, a `fetch` that never opened, the three-minute open timeout — `runTurn`
(`src/web/chat/effects.ts`) reports `sink.failed`, and the reducer's `turn.failed` **commits** the
drawing: the blank row with the error on it replaces the answer, and an edit's dropped turns are
dropped from `base`. Postgres still holds all of it, so a reload brings it back. Until then the
reader is looking at a conversation that has lost something it has not lost.

Only a 409 is handled: `turn.refused` drops the operation, which un-draws it, and registers a
repair that reads the server's copy. Stage 0 of 261006a made its own refusal a 409 so that it took
that path; every other pre-stream failure still takes the wrong one.

## The fix

One rule, in the reducer:

> A **retry or an edit** that ends in `turn.failed` **before its `begin` frame** is un-drawn and
> repaired, exactly as `turn.refused` does it. The error goes to the panel's error line.

- `!op.began` is the reducer's existing word for "the server has not named this turn". After
  `begin` the server has certainly committed the retry or the edit, so the failure belongs on the
  row, as now.
- **The repair is not optional.** A pre-stream failure does not prove the server did nothing: a
  response can be lost after the commit (the open timeout, a dead connection, a 500 from something
  after the write). Un-drawing alone would then show the old answer over a row the server has
  blanked. The repair asks, and the existing recovery scan picks up a `pending` row it finds. If
  the repair's own read fails too (the database is still busy), the screen stays as it was before
  the press, which is what the database most likely holds.
- **A send is unchanged.** Its question and empty answer are in `base`, there is nothing older
  underneath to put back, and keeping the reader's typed words with the failure and a Retry under
  them is the better outcome.
- The reducer is pure and cannot mint the repair's id, so `turn.failed` carries `repair: { id }`
  the way `turn.refused` does and `turn.disconnected` carries its recovery. The controller mints
  it on every failure; the reducer uses it only in this case. The controller's "handed over" test
  (who notifies when an operation finishes) learns the same case.
- The body of `turn.refused` becomes one function both cases call. No second copy.

### What it gives up

After a failed Edit the reader's rewritten question is no longer on screen: the original is, with
the later turns, and the error line says why. That is what a 409 already does. The alternative,
keeping the rewrite on screen, is the bug.

### The simpler option passed over

Making the server answer every pre-stream failure with a 409. It is the mechanism stage 0 used,
but a 409 means "the conversation moved on", it is not reported to Sentry, and it cannot cover a
request that never got an answer at all.

## Tests, red first

- `tests/chat-reduce.test.ts`: a retry and an edit failed before `begin` leave `base` as it was,
  retire the turn, register a repair and emit its command; a send failed before `begin` and a retry
  failed after `begin` behave as today.
- `tests/chat-pre-stream-failure-keeps-the-answer.test.ts`: the browser's real `runTurn` and the
  real `ChatController` against a fake `apiFetch` that answers the POST with a 500 carrying
  `STORAGE_BUSY`, and with a rejected `fetch`. Asserted: the rows on screen afterwards are the
  rows before the press, and the error is the reader's sentence.

## Review

GPT Sol reads this plan (read-only), then the code (write-capable). Its doc edits are grepped for
"Greg" before commit.

## The plan review (GPT Sol, 2026-10-06)

[261006d-plan-review-sol.md](261006d-plan-review-sol.md), from
[its prompt](261006d-plan-review-prompt.md). Approve with changes. Each finding was checked against
the code.

| Finding | What it said | What was done |
|---|---|---|
| F1 P1 | If the edit *had* landed and only the response was lost, the repair's merge keeps every row this tab has and the server lacks, so the turns the edit discarded come back underneath the new answer | True, reproduced red. The repair for an edit now names those turns in `drop` (`discardedBy`): the server keeps them or it does not. Rows of another turn still in flight are left out, which two existing tests caught when the first version took them |
| F2 P1 | A stream lost after the response opened and before `begin` (`sink.disconnected`) commits the drawing the same way | True, reproduced red. `turn.disconnected` before `begin` on a retry or an edit is withdrawn too, under the id the event brings for whoever takes the row over |
| F3 P1 | A Stop pressed before `begin` is dropped with the turn; if the request had landed after all, the repair finds a pending answer, the recovery resumes it, and the Stop is forgotten | True and **left**: it is not new. Before this change the same Stop was dropped by `commit` and the same answer carried on unseen. It is now on screen as "checking", with a Stop the reader can press |
| F4 P1 | The repair's read has no deadline, so after an open timeout against a hung server the repair can stay live | True and **left, reported**: no read in the controller has one (the first load, a rename, a delete), and a live repair holds up nothing on screen, only `onSettled`. Bounding them is one change for all of them, wider than this |
| F5 P3 | An edit of the first question writes its title into `base`, and a repair never takes a title from the server, so the title stays rewritten | True and **left**: the same after a 409 today, and the policy (`merged`: "the title is never taken from the server") is deliberate. So "the screen is as it was" is true of the rows, not of the title, until a reload |

It also confirmed that an `error` frame can arrive before `begin` (the route's `try` opens before
the header flush), with the store write already made; un-draw and repair is right there, given F1.

## What landed

- `src/web/chat/reduce.ts`: `withdrawn` is the old body of `turn.refused`. `turn.failed` and
  `turn.disconnected` call it for a retry or an edit that had not begun. `discardedBy` is F1.
- `src/web/chat/model.ts`, `controller.ts`: `turn.failed` carries `repair: { id }`, and the
  controller's hand-over test knows a failure can hand over.
- Tests: seven in `tests/chat-reduce.test.ts`, four in
  `tests/chat-pre-stream-failure-keeps-the-answer.test.ts`, each seen red. Two existing assertions
  changed, both of which pinned the old ending in passing rather than as their subject: the held
  Stop test now asks for no command *but* the repair, and
  `tests/chat-intent-paths.test.ts` expects the answer back where it expected an error row.
