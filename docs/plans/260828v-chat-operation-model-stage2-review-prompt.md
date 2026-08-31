# Review the built stage 2

You have reviewed this work four times: the architecture question, the build plan (refused), the
revised plan (refused, then conditionally approved), and stage 1 (refused; the regression you found
is fixed in `b7fa818`). **Stage 2 is built and committed as `852eda2`.** Review the code.

## What to read

- `git show 852eda2` — 11 files, +3044 / −1523.
- `src/web/chat/{model,reduce,project,controller,effects}.ts` — `effects.ts` is new.
- `src/web/useChat.ts` — **1656 → 905 lines**. `legacy.apply` is gone, and with it `owned`,
  `released`, `attempts`, `watched`, `running`, `showing`, and the four mutable variables in `run`.
- `docs/plans/260828v-chat-operation-model.md` § Stage 2, which the commit updated.
- `tests/chat-reduce.test.ts`, and the characterisation net:
  `chat-write-paths`, `chat-turn-paths`, `chat-intent-paths`, `chat-cancel-before-begin`,
  `chat-title-ownership`.

## What this stage did

`send`, `retry` and `edit` are each a `TurnOperation`; every frame is an event carrying its id.
**Recovery and the 409 migrated with them**, per your second blocker on the plan. Three bugs were
fixed that could not be fixed before the turn was represented:

1. **The cancel-before-`begin` window.** `cancelAndDiscard` asks `writerOf(state, messageId)` whether
   that turn has `began`; if not, the wish waits for the frame that names the rows, and **nothing is
   sent**. This is the fact the three rejected fixes each needed and none could get — they are
   written up in the plan so they are not rediscovered.
2. **Tombstone provenance.** `tombstones` is now a `Map<string, Tombstone>` carrying `by`, so only
   the cancel that laid one down may lift it. Before, `cancel → delete → the cancel failing` removed
   the *delete's* tombstone.
3. **`withServerIds` is told whether this turn named the conversation** rather than inferring it from
   `messages.length <= 2`, which read the same for a second send into a one-turn conversation and
   dropped the server's stored title over a fresh rename.

## The evidence, and its limits

15 chat suites, 112 tests, green. `npm run typecheck` clean on all three projects. The full suite has
six failing files, all traceable to a peer's half-written `src/store/export.ts`
(`ReferenceError: exportBlobStore is not defined`); `chat-anchor` is among them because it exercises
export, and passes 11/11 alone.

**Two characterisation tests were deliberately changed**, and the plan says why: they pinned the two
doomed early requests, and there are none now. Restoring the doomed cancel in a probe copy reddens
both, with the assertion naming it:

```
× sends nothing while the server could only answer `already gone`
  AssertionError: a cancel went out that the server could only mis-answer: expected [ … ] to have a length of +0 but got 1
× brings the conversation back when the server refuses a cancel it could match
```

**Be aware of what I do not have.** The agent that built this never sent a report despite two
requests. Everything above is my own verification. I have probe evidence for the cancel fix and none
for the recovery handoff or the 409 path — I am probing those myself in parallel, but treat those two
as the least-evidenced parts of the stage and look hardest there.

## What I need judged

1. **The recovery handoff.** `turn.disconnected` should hand the answer to a `RecoveryOperation` with
   exactly one writer. Is there an ordering where a row ends up with two writers, or none?
2. **The 409.** Dropping the refused operation and registering the repair is supposed to be one
   transition. Is it, and does the refused edit's discarded turns coming back actually work — the
   payoff the whole projection was justified by?
3. **The cancel fix.** Is `writerOf(...).began` a sound answer to "does this row have a server name
   yet", including for a retry, which reuses a row that was named by an earlier attempt?
4. **Anything that now writes state without going through the gate**, now that the escape hatch is
   gone.
5. **Stage 3** is intent — folding `stopWanted` and `cancelWanted` into one field the type cannot let
   hold both — plus the invariant tests. Is that still right, and is anything left in this stage that
   should have been in it?

Read-only. Change no file. If it should not ship, say so plainly.
