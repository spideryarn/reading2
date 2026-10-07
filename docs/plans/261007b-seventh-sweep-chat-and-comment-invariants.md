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
   the turn is written (not before any read: the kind lookup comes first).
2. *What the client sends.* `src/web/ChatDialog.tsx` § `ask` sends anchor and `help` through
   `send(null, …)`, minting a new thread id each time. Conversation-band handoffs also carry
   anchors and start a fresh draft; their follow-ups omit them. A dialog follow-up
   (`onSend`, `send(thread.id, question, at)`) carries neither. Nothing resends a
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
  expressible: a frame without `error` drops it, and the first delta drops `replacing`.
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

### D. Comments

No code. Each corrected against the code it describes, and nothing here is a new rule.

- **The chat guarantees.** Three comments in `streamChat` said the turn lock was the guarantee
  (*"Whatever they would refuse, they refuse here"*, *"Read under `inTurnOrder`, so the thread
  cannot be created between the look and the write"*, *"this one is the guarantee"*). They sat in
  code that A and B rewrote, so they were corrected in those commits, not here. What was left for
  this one: `ChatThread.anchor` in `src/types.ts` and `ChatStore.begin`'s `turn` in
  `src/store/contracts.ts`, both of which still said only the route refuses a second anchor.
- **The comment that comes back.** `useComments.ts` said in three places (the review counted two;
  `remove` has the third) that an answer finishing after a DELETE writes the row back, so the
  DELETE is sent again. The answer's write is an `UPDATE` and cannot. Checked two ways: the SQL, and
  the new Postgres case *a comment deleted mid-answer still gets a frame*, which reads the store
  afterwards and finds no row. The second DELETE is left in; it is a no-op after the first
  succeeds, but can perform the deletion if the first failed or is still in flight.
- **SV4.** The Ask route *"writes nothing"* (a finished answer is added to the glossary:
  `makeAskAboutTerm` calls `deps.lookups.addTerm`); *"there is none to reuse … `lookup` has none
  either"* (`lookUpTerm` takes the `dig-deeper` allowance through `admitDig`); and
  `streamTermLookup`'s *"nothing it produces outlives the page"*. Ask still has no limit; the
  comment says so and says that whether it should is undecided, as
  [glossary.md](../project/glossary.md#the-allowance-dig-deeper-has-and-look-up-does-not) already
  does.

## What the brief and the investigations got wrong

- **Two tests asserted SV3's defect** and neither investigation saw them (`tests/chat-anchor.test.ts`,
  under B).
- **The review's fix for the reverse interleaving is one case short** (a counter bumped at the start
  of `send` only; under C).
- **`sameAnchor` already names something else on the client**: `src/web/selection.ts` exports a
  `sameAnchor` over two `SelectionAnchor`s. Different type, different rule (both sides always have
  a quote), no shared caller. Left alone; worth knowing when grepping.
- **"Up to four" loads** (the umbrella, C4) is five: the read outside the lock, and four inside.
- **The resurrection comments are three, not two.**
- **Help needed a class, not only a predicate.** The brief asked for no new validator and for help
  to stay a 400. `withTurn`'s only refusal class is a 409, so the 400 needed `ChatTurnRefused`.
  It validates nothing; it carries a status.
- Everything else reproduced as described: SV1, SV2, SV3/SVO4, SVO9's counts, WC1 and probes A to
  D, and all three of SV4's comments.

## Not done

- No postmortem under `docs/postmortems/` for A, B or C as built (the review's C1 has one, below).
  The class for B is already written up
  ([261005h](../postmortems/261005h-a-per-process-origin-check-leaves-the-transaction-accepting-another-origin.md));
  A and C are each a rule that existed at one layer and was not carried to the next, which is that
  postmortem's class again and the umbrella's *One level up*. If one is wanted for C (two writers
  replacing a shared row), it is not written.
- A stream that drops while the server finishes still leaves "The answer stopped arriving" until a
  reload or an uncrossed PATCH (under C, *Not changed*).
- The GPT Sol code review followed: *Code review* and *Review status*, below.

## Code review, 2026-10-07

The successful UPDATE and its returned list read are separate statements. A replacement attempt
can claim between them, making the returned row `pending`. Framing it as `done` newly left a
spinner without a watcher. Reproduced in the real route with store/model leaves stubbed: both
success and failure cases were red; the three controls passed. The fix retains current reader
fields and this attempt's committed terminal answer only when that returned row is pending. A
newer terminal row still passes unchanged. Root cause and rejected options:
[postmortem](../postmortems/261007a-a-post-write-read-can-belong-to-a-new-attempt.md).

`tests/comment-answer-terminal-frame.test.ts` also has a preceding sibling row, so `kept[0]`
cannot pass as the matching id (watched red: 1 failure). Replacing `place`'s `landPatch` with
whole-row replacement was also watched red: 2 placement failures. Both mutations were undone.
Two Postgres twins were added to
`tests/comment-answer-stream-lifetime.test.ts`; **unrun in the review sandbox**. Added hook probes
cover placement/removal, a stream wholly inside a PATCH, overlapping marks, X/Y isolation,
failed PATCH and stream, deletion and StrictMode. The mark survived all of them.

Rewritten comments were narrowed: the second DELETE is only a no-op after the first succeeds;
Ask and Lookup share an explanation generator but Lookup searches first; the transaction's
refusal need not have byte-identical punctuation to the route's. The sender trace and history
found no ordinary newly refused request; the original gateway plan already required API refusal.

Wider, unchanged: a refused completion can still frame a newer pending attempt with no watcher;
`send`'s captured `carried` row restores old error/citations/searches/model on a delta (also at
the base). The new retry-clearing wording was corrected, rather than declaring that defect fixed.
The seven answer fields are complete today but are manually listed in several places.

Final review validation: **13 unit/jsdom/doc suites, 151 tests passed, 0 failed**; all four
TypeScript projects passed and covered **3,340 source files**. Targeted Biome lint checked seven
files, with **19 informational diagnostics, no errors or warnings**. `git diff HEAD --check`
passed. Neither the full suite nor Postgres assertions were run. No commit was made.

## Review status

**GPT Sol's verdict, 2026-10-07: "ship with these fixes applied", subject to the Postgres checks
being run outside its sandbox.** They were, and they pass. The review's answer is
[261007b-…-code-review-sol.md](261007b-seventh-sweep-chat-and-comment-invariants-code-review-sol.md)
and its prompt is
[beside it](261007b-seventh-sweep-chat-and-comment-invariants-code-review-prompt.md). Its three
findings, all fixed by the reviewer and committed as one further commit:

- **C1 (P1).** A `done` frame could carry another attempt's `pending` row, leaving a spinner nobody
  was watching. Fixed in `settle`: a pending row out of the read supplies the reader's fields and
  this attempt supplies the terminal answer it committed; a newer finished answer is framed as it is.
- **C2 (P2).** The original regressions admitted `kept[0]` and a whole-row replacement in `place`.
  A sibling-row case and placement cases were added.
- **C3 (P3).** Five rewritten comments still claimed too much, and were narrowed.

**Checked afterwards, outside the sandbox** (Claude, the same day):

- *C1 red without its fix.* The four lines in `settle` edited back by hand:
  `tests/comment-answer-terminal-frame.test.ts` 2 failed, 3 passed, and the two Postgres twins in
  `tests/comment-answer-stream-lifetime.test.ts` 2 failed, 8 passed, each on
  `status: "pending"` where `done` or `error` was expected. Fix put back: 15 passed across the two
  files. **The Postgres twins had never been run before this**; they are right as written and were
  not changed.
- *C1 judged.* The frame now shows this attempt's answer over a row another attempt has already
  blanked and will overwrite. Nothing the reader wrote is involved: the reader's fields in the
  frame are the current ones, and the tab takes only the answer's half of a frame anyway
  (`putAnswer`). What the tab shows is an answer this attempt did commit; a reload shows the newer
  attempt's. The cost is that one tab can show a finished answer the store has since replaced,
  until it reloads.
- *C2's two mutations.* `kept[0]` for the id match: 1 failed, 4 passed. `place` replacing the whole
  row: 2 failed, 20 passed. Both edited back.
- *C3.* Each of the five read against the code. One more of the same kind was in this plan
  (*"before it reads anything"*, under B) and is corrected above.
- *No existing assertion was weakened*: the test diffs only add.
- *Gates, before merging `dev`.* `npm run typecheck`: all four projects, 3,340 files. By file, 144
  test files in six runs (every file the stage touched, every `tests/chat-*` and `tests/comment-*`,
  every suite that mentions `useComments`, `tests/routes.test.ts`,
  `tests/store-migration-registry.test.ts`, the tests that read `src/routes.ts` as text, and
  `tests/doc-links.test.ts`): **2,953 passed, 0 failed**. Biome on the 13 touched source and test
  files: 19 infos, no warnings or errors. The same gates are run again after the merge, before the
  push.

**Left, from Sol's wider notes.** None is new in this stage's fix, and none is fixed here:

- A **refused** completion (the attempt was superseded before its write) can still frame a newer
  `pending` attempt without adopting its stream: the same unwatched spinner as C1, by the other
  branch of `settle`.
- `send`'s captured `carried` row puts the old `error`, `citations`, `searches` and `model` back on
  a later delta. It exists at the base of this stage.
- The seven answer-owned fields are listed by hand in several places (`withAnswerOf`,
  `AnswerHalf`, `beginAnswer`, `patch`, the test harness), and nothing fails if an eighth is added
  to one list and not the others.

**History.** Commit `63c49bb72` is red on its own in `tests/store-migration-registry.test.ts`;
`8836f40ab` fixes it (under B, *A red I caused and committed*). History was not rewritten.

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
