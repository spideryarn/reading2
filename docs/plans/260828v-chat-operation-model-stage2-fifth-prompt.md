# Fifth look at stage 2, and the second at stage 3

You refused stage 2 a fourth time on 2026-08-28
(`docs/plans/260828v-chat-operation-model-stage2-fourth-sol.md`). Both findings are addressed in `717299f`.

Review `git diff b266ad1..HEAD -- src/web/chat tests/chat-*.ts tests/helpers/chat-reduce.ts` —
6 files, +752 / −109. The plan's new section is
`docs/plans/260828v-chat-operation-model.md` § *What the fourth review of stage 2 sent back*.

## Your findings, verbatim, and what was done

> 1. **P1 — the pre-`begin` delete/rename race remains open.** A provisional DELETE may answer
>    successfully before `turn.began`. Its operation then retires. When `turn.began` arrives,
>    `renamed()` only reissues operations still in the map, so it emits nothing. My direct reducer
>    probe produced `commands: []`. … The common case also keeps the client's thread ID, and
>    `renamed()` immediately returns when the IDs match.

The second sentence of that is what changed the approach. The compensation was not merely racy, it
was **dead in the majority case**: `beginTurn` keeps the client's id whenever it is free, so
`from === to`, and `renamed()` returned at its first line. Four rounds had been spent fixing a
request that, for most readers, was never repaired at all.

So nothing is sent into that window now. **A rename or a delete of a conversation the server has not
named is held**, and goes out in the same transition as the `begin` frame — the server saying the
thread is on disk under a name it will match. Deleted with it: `outstanding`, the `Reissuable`
interface, the reissue inside `renamed()`, and the gate's wait-for-the-last-of-two-answers branch.
`renamed()` no longer returns early when the ids match, because that is still the moment the
conversation starts existing.

Three decisions inside that you should test:

- **"The server has not named it" is recorded, not derived** — `ChatState.unnamed`, grown at the two
  places this tab invents a conversation and shrunk at the one place the server names one. Deriving
  it from a live unbegun turn is wrong three ways: the turn can retire, two sends into one new
  conversation mean the turn you pinned to may die while the other names it, and a conversation
  renamed before anything has been asked in it has no turn at all.
- **A held mutation whose turn dies stays held**, rather than being discarded. Nothing was written
  server-side, so nothing needs sending either way; holding is what carries the reader's rename into
  the next question they ask in that conversation. A held mutation something newer supersedes *is*
  dropped, because a request neither sent nor dropped never retires.
- **`accepts` refuses any answer to a held operation.** An operation that has not asked cannot be
  answered, which is your reproduction made impossible rather than survived.

> 2. **P2 — a pre-`begin` rename is visibly overwritten.** `rename.started` writes the reader's title
>    into `base`, but the opening turn's `begin` then replaces it with `begun.title`.

**A reader's rename takes the naming right away from the opening turn**, from both sides:
`readerNamed` clears `namesThread` on a live turn when a rename registers, and a turn registering
into a conversation that already has a rename starts with it false. One side alone leaves the
rename-before-send order broken.

> - **Stage 3:** the naming test samples three orders and always puts `turn.began` last; the
>   superseded symmetry test says it covers repair but only exercises rename and intent.

The naming test runs all six orders and states why the frame is deliberately last: the invariant is
about names minted *before* the server supplied one. The symmetry test now builds a real repair —
two refused turns, since a repair is superseded only by another repair. Neither claim was reworded to
match the test.

## Evidence

26 chat suites, 354 tests green; typecheck's only error is a peer's `glossary-ideas-baseline`. I
probed the rule myself in both directions rather than taking the builder's word:

| broken | reddens |
|---|---|
| nothing is ever held (the old behaviour) | 10 |
| everything is held for ever | 20 |
| `accepts` refusing an answer to a held operation | 1, named |
| the reader's naming right (`readerNamed`) | 2, named |
| dropping a held mutation a delete took over | 1, named |

and the control returns to 354 green, so my instrument was real this time.

## What I need judged

- **Is the window actually closed, or have I moved it?** The residue named in the plan is a stream
  lost *after* `beginTurn` wrote the thread and before the frame was read: the conversation exists on
  the server under a name this tab never learned, and no mutation can address it. Sending early never
  covered that either — the request raced the same write — but say if you think it is worse now.
- One I have not resolved: `namesThread` still arrives from the hook, decided from what is on screen.
  For a conversation this tab invented it is now correct from both sides. For a conversation the
  *server* named that has no messages, the hook would still say true and the frame would overwrite a
  reader's title. I could not construct that state — the server writes the thread with its first
  question — but I would rather you told me whether deriving `namesThread` from `unnamed` inside the
  reducer is the tighter rule, or a fourth vocabulary.
- `renameThread` (`src/chat.ts:193`) has the same silent-success shape as `deleteThread` — a `map`
  over a list the thread is not in, answering `200`. The client no longer sends into that window, so
  nothing exercises it; is a server-side fence still owed, beyond the `expectedTitle` fence already
  recorded as out of scope?
- **Is stage 2 done, and is stage 3?**

Read-only. Change no file. Say plainly whether it ships.
