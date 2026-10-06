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
