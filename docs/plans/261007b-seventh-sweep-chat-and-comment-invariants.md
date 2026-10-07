# Seventh sweep, C4: three invariants the chat and comment routes did not carry

Cluster **C4** of [the seventh sweep's umbrella](261006m-seventh-codebase-sweep-depth-umbrella.md)
(§ C4, and § What the review changed: U7, U9, U13, U16). The areas are typed chat
([chat-tools.md](../project/chat-tools.md)) and comments ([comments.md](../project/comments.md)).

## What

Three rules existed at one layer and had not been carried to the next. Each finding below is a
claim from an investigation, reproduced here with a failing test before it was fixed.

| Item | Rule | Where it was missing |
|---|---|---|
| A. SV1 | An edit that names a stale tail is refused | The route stopped the live answer first, and only the store checked the tail |
| B. SV3 = SVO4 | A thread is anchored once; `help` is for the turn that creates a thread | Checked under a per-process lock, and not in the store's transaction |
| C. SV2 + WC1 | An answer stream owns the answer fields of a comment and nothing else | The server's `done` frame and the client's four branches each wrote a whole row from an old snapshot |
| D | Comments that claim the guarantees A to C did not give, and SV4's three glossary comments | `src/routes.ts`, `src/web/useComments.ts` |

Sources: the server zone
([Sol](../investigations/261006d-seventh-sweep-depth-server-request-path-sol.md),
[Opus](../investigations/261006d-seventh-sweep-depth-server-request-path-opus.md), and the reviews
[Opus on Sol](../investigations/261006d-seventh-sweep-depth-server-review-opus-on-sol.md),
[Sol on Opus](../investigations/261006d-seventh-sweep-depth-server-review-sol-on-opus.md)) and the
client zone
([Sol](../investigations/261006d-seventh-sweep-depth-reader-client-and-per-mode-hooks-sol.md),
[Opus on Sol](../investigations/261006d-seventh-sweep-depth-reader-client-review-opus-on-sol.md)).

## The simpler option passed over

- **A.** Make `expectedTailId` required on every edit. Simpler to state, but it refuses an old tab
  and a curl that work today. The existing helper, run one step earlier, refuses nothing new.
- **B.** Leave the two rules route-only and correct the comments that call them a guarantee. No
  client today sends the colliding pair, so that is defensible. Passed over because the same class
  was fixed for kind and origin two days ago
  ([postmortem 261005h](../postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md))
  and leaving two of four siblings out is how the next one is missed. The retreat rule below is the
  price of taking the harder one.
- **C.** Fix only the server's `done` frame. One line, and the end state heals. Passed over because
  the screen still shows the old note for the length of the stream, and a stream that drops never
  gets a `done` frame at all (the Opus review's probes B and D).

## Done when

- **A.** A stale edit leaves the other tab's answer streaming and gets its 409; an edit naming the
  real tail still stops and replaces it. Through `handleApi` and Postgres.
- **B.** `withTurn` refuses a different anchor and a `help` flag on an existing thread, before
  either message is minted. An identical anchor resent passes; a follow-up with no anchor passes.
  Help stays 400 and anchor stays 409, at the route and out of the store. The same refusals through
  `pgChatStore.begin`. **Retreat rule (the orchestrator's, not Greg's):** if any ordinary
  single-tab request (first send, resend, follow-up, "?" press) reaches a new refusal, the refusal
  is not kept: warn and accept as today, and record it as *documented, not closed*.
- **C.** With a stream held open: a body PATCH, then a delta, then the terminal frame, leaves the
  edited body on screen at every step. The same with the body removed, with no delta, with the
  stream dropping, and with a PATCH answer that arrives after `done`. One Postgres case for the
  server's frame.
- **D.** Each corrected comment says what the code does.

## What landed

Filled in per item as it was built.

### A. SV1

Reproduced. Red, before the fix (`tests/chat-route.test.ts`, the model call held open by a `fetch`
that hangs until aborted):

```text
× a stale edit gets its 409 and the other tab's answer goes on streaming
AssertionError: the live answer was ended by a request that was refused: expected true to be false
```

Fixed in `src/routes.ts` § `streamChat`: `requireTail(snapshot, threadId, expectedTailId)` runs
before `withEdit` and `settleThread` when the edit carries a tail. The store's own check inside the
transaction is untouched. Limits, both as before: the gate sees only streams in this process, and
an edit that sends no tail is not guarded.

The control (*an edit that names the real tail still stops the live answer and replaces it*) was
green before and after, as it should be.

### B. SV3 = SVO4, and SVO9

Reproduced, pure and through Postgres. Red, before the fix (12 tests; the accepting cases and the
ordinary requests were green):

```text
tests/chat-anchor-transaction.test.ts
× refuses another block                  (and five more shapes of "a different anchor")
× refuses a help flag when another process has created the thread, as a 400
tests/chat-anchor-route.test.ts, through chatStore.begin and Postgres
× a different anchor is a ChatConflict, and nothing is appended
AssertionError: expected 'accepted' to be an instance of ChatConflict
× a help flag on a thread that exists is a 400, and no press is recorded
AssertionError: expected 'accepted' not to be 'accepted'
```

Fixed in `src/chat.ts` § `withTurn`, beside the origin check and before either message is minted.

- `sameAnchor` moved from `src/routes.ts` to `src/types.ts`, beside `sameOrigin`. One predicate,
  imported by the route and by `withTurn`.
- **Statuses, checked rather than assumed:** the route's anchor refusal is a 409 and its help
  refusal a 400, as the brief said. The anchor refusal in `withTurn` is a `ChatConflict` (409).
  Help could not be one, so there is a small new class, `ChatTurnRefused`, carrying `status = 400`;
  the numeric status is what `serveApi` reads first and what `guardDbStore` lets through. The two
  sentences are constants in `chat.ts` (`ANCHORED_ELSEWHERE`, `HELP_NOT_FIRST`) used by both
  layers. No new validator.
- **Two existing tests asserted the defect.** `tests/chat-anchor.test.ts` § *does not re-anchor a
  thread that already exists* and *does not grow an anchor on a thread that never had one* called
  `withTurn` with a different anchor and expected the question to be appended with the anchor
  ignored. They now expect the refusal, and still assert what they were for: the stored anchor does
  not move. Neither investigation mentioned them.

**The retreat rule: not triggered.** The argument that an ordinary request cannot reach either
refusal rests on three things, each read or tested:

1. *The route and `withTurn` ask the same question of the same thread.* Same predicate, same
   loader. `withTurn` can pick a thread the request did not name (`targetOf`), but only for a
   single-thread kind, and the route refuses an anchor or a help flag with any kind but chat before
   it reads anything.
2. *What the client sends.* An anchor and `help` leave the browser from one place,
   `src/web/ChatDialog.tsx` § `ask`, which calls `send(null, …)` and so mints a new thread id every
   time. A follow-up (`onSend`, `send(thread.id, question, at)`) carries neither. Nothing resends a
   chat POST of its own accord; `src/web/lib/api.ts` repeats one only after a 401, which never
   reached the handler.
3. *Tested through the route and Postgres:* first send, the same send again, a follow-up, a "?"
   press and its follow-up all begin; a second "?" press on the same thread is the 400 it already
   was (`tests/chat-anchor-route.test.ts` § *the requests one tab makes*).

**SVO9, built.** Characterised first by counting `chatStore.load` calls up to `begin`: 1 for a plain
send, 4 for anchor and origin, 5 with a help flag as well (the Sol review's numbers; the umbrella's
"up to four" is the Opus document's "up to five" less the read outside the lock). The four checks
now share one read, taken only when the send carries one of the four fields: 1, 2 and 2. It is safe
because nothing is written between the four and, since this commit, `withTurn` decides all four
again in the transaction, so a single look loses nothing a second look was guarding. The earlier
read for the thread's kind stays where it is.

**A red I caused and committed.** Commit B added three describe blocks to
`tests/chat-anchor-route.test.ts` without the mutation judgement its conversion record requires, and
`tests/store-migration-registry.test.ts` was red for one commit because I had not run it. The next
commit adds the judgements (and the mutations behind them, below).

### C. SV2 + WC1, and the reverse interleaving

Reproduced, both halves, and each half separately.

Server, through `handleApi` and Postgres with the PATCHes sent through their real routes
(`tests/comment-answer-stream-lifetime.test.ts`), red before the fix:

```text
× a note and a colour changed mid-answer are in the frame when the answer finishes
× a note and a colour changed mid-answer are in the frame when the answer fails
AssertionError: the frame carries the comment as it was when the answer began:
  expected { body: 'old note', colour: undefined } to deeply equal { body: 'new note', colour: 'blue' }
× a note removed mid-answer is absent from the frame
```

Client, the real hook over a held stream and a fake server that keeps its own row
(`tests/comment-answer-stream-keeps-reader-edits.test.tsx`), red before the fix (9 of 11; the two
controls were green):

```text
× a new body survives a delta and the terminal frame      a delta put the old note back: expected 'old' to be 'new'
× a body removed stays removed                            a delta put the removed note back
× with no delta at all, the terminal frame alone does not undo it
× a colour changed mid-stream survives too, and a removed one stays removed
× the stream dropping leaves the edit, under the error    the failure branch put the old note back
× a failed Dig deeper puts the old answer back, and still not the old note
× landing after a delta, it keeps the words already streamed       expected undefined to be 'hello'
× an edit landing after the done frame does not bring the spinner back      expected 'pending' to be 'done'
× a recolour landing after the done frame does not bring the spinner back
```

The client cases send the `done` frame **an older server sends** (the answer over the opening
snapshot), so they prove the client's half without the server's; the Postgres cases prove the
server's without the client's.

Fixed:

- **Server**, `src/routes.ts` § `answer` § `settle`: on a successful write the frame is the row out
  of the list `patch` returned. *No matching row*, handled on purpose: the comment was deleted
  between the write and the read, and the frame is then this attempt's answer over the opening
  snapshot, the same thing the refused branch already sends for a comment deleted mid-answer
  (characterised by a fourth case, green before and after). `pg-comments.ts` is not touched.
- **Client**, `src/web/useComments.ts`: `withAnswerOf(row, from)` replaces a row's answer half
  (`status`, `answer`, `citations`, `searches`, `model`, `error`, `replacing`) and leaves the rest;
  `putAnswer` applies it to the row as it is in state. `send` uses it in all five places it wrote a
  row (before the POST, `begin`, `delta`, `done`, failure). Replaced, not merged, so clearing stays
  expressible: a retry drops the last attempt's `error`, the first delta drops `replacing`.
- **The reverse interleaving**: `edit`, `place` and `recolour` end in one `landPatch`. It takes the
  whole row from the PATCH's answer, as before, unless an answer stream was open at any point while
  that PATCH was out; then it takes the reader's half only. `send` keeps a per-id mark (streams
  open, streams ended) for it to ask.

**What the review got wrong, slightly.** It says a per-id counter *"bumped in `send`"* is enough,
for *"whenever an answer began on that id after the PATCH was sent"*. That misses its own headline
case: the answer began **before** the PATCH was sent and ended before the PATCH was answered, so no
answer began in between and nothing is open at either end. The mark therefore counts endings as
well as openings. The mutation `crossed = now.open > 0` shows it: the two *after the done frame*
cases go red.

**Not changed, and why.** A stream that drops leaves "The answer stopped arriving" on the row even
if the server finished; a later PATCH used to heal that by replacing the row, and still does unless
it crossed the stream. And `begin`, `delta` and `done` now ignore the reader's fields in a frame
even when the frame is newer than the tab (a PATCH committed and not yet answered): the PATCH's own
answer brings them a moment later.

## Mutations

Each applied alone by exact string replacement, the named tests run, and the line edited back
(nothing restored from git). All on 2026-10-07.

| Item | Mutation | Went red |
|---|---|---|
| A | the `requireTail` line in `streamChat`'s gate deleted | *a stale edit gets its 409 and the other tab's answer goes on streaming* (the control stays green) |
| B | `withTurn`'s anchor refusal disabled | 10: six pure shapes, two through Postgres, the two rewritten cases in `chat-anchor.test.ts` |
| B | `withTurn`'s help refusal disabled | 3: two pure, one through Postgres |
| B | help thrown as `ChatConflict`, not `ChatTurnRefused` | the same 3, on the status |
| B | `sameAnchor` false for an identical anchor | 9, including *first send, the same send again, and a follow-up* |
| B | `withTurn` refusing help whether or not the thread exists | 5, including *a help press, then a follow-up* |
| B (SVO9) | the shared read loading twice | the two cases that carry a field; the plain send stays green |
| C server | `settle` framing `{ ...comment, ...patch }` again | 3 of 4 (the deleted comment stays green, as it should) |
| C client | `delta` writing the whole row | 4 |
| C client | `done` writing the whole row | 4 |
| C client | the failure branch writing the whole row | 2 |
| C client | `begin` writing the whole row | *an edit answered before the begin frame is read is not undone by it* (written after this mutation first came back green) |
| C client | `withAnswerOf` merging instead of replacing | *clears what the last attempt left* |
| C client | `landPatch` never treating a PATCH as crossed | 3 |
| C client | `landPatch` crossed only while a stream is open | the two *after the done frame* cases |
| C client | `landPatch` always crossed | *with no answer in the air, a PATCH answer still replaces the whole row* |

One mutation was itself wrong the first time: a second load placed inside a branch the load-count
cases never enter came back green, and was replaced by one on the shared read.
