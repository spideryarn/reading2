# Re-check: stage 2 after your three blockers

You refused `852eda2` with three P1s and one P2
(`docs/plans/chat-operation-model-stage2-review-sol.md`). **All four are addressed in `6a928ae`.**
Review that commit.

## What changed, and what to check hardest

1. **The cancel lost at unmount.** You were right, and the finding behind it was worse than the bug:
   **every test in this repo mounts the hook and none had ever unmounted it.** There is now
   `tests/chat-unmounted-turn.test.ts` — mount, send, cancel, **unmount**, then push `begin` — plus a
   control where the reader presses nothing, so neither passing test can be satisfied by firing a
   cancel at every frame.

   The wish is state rather than a callback: an intent is an operation, the reducer emits its command
   at `turn.began`, and the controller performs it. `onNamed` and `NamedTurn` are deleted. The claim
   is that the controller outlives the hook because the in-flight stream still holds it — **please
   check that claim specifically**, including what happens if the whole `Reader` unmounts, or the
   slug changes and a new controller is built while the old one still has a stream open.

2. **`began` unsound for a retry.** Cancel no longer waits when the row is already server-named
   (`began || shape === "retry"`); stop still waits, being attempt-specific; and a turn retiring
   unnamed drops what was waiting on it. That last part came from a bug found while fixing this: a
   stop left behind by a dead retry stopped the *next* answer, because the row id is reused.

3. **The repair overwriting newer work.** It merges now rather than replacing: the server's messages
   are the record, this tab's extra rows are kept, the title is never taken from the server, repairs
   supersede each other, and a refused send's own rows ride as a `drop`. The live-turn guard is gone,
   which was discarding the repair permanently.

4. **Stop/cancel results bypassing the gate.** `intent.failed` retires the operation, lifts the
   tombstone only when `by === op.id && !final`, and sets the error, in one transition; a superseded
   intent lifts nothing and says nothing.

Also: `tombstone.added`/`tombstone.removed` are deleted — they had no sender left, and were a second
*tested* copy of a rule whose reachable copy was untested. And `turn.disconnected`'s one-writer check
was a duplicate of the one in `recovery.started`; there is one now, and the reachable ordering is
recorded (a retry into a row a live recovery is chasing).

## Evidence

16 chat suites, 132 tests, green. I probed the central claim myself: disabling the intent release at
`turn.began` reddens both unmount tests with `the cancel was lost when the dialog closed` and `the
stop was lost when the composer went`, while the control stays green.

**A warning about my own evidence.** My first probe run passed 3/3, which would have said the test
was worthless. It was not — my `sed` had missed one link, so the probe controller still imported the
real reducer and the sabotage never ran. I mention it because if you find a guard here that looks
untested, consider that it may be my probe rather than the test.

`npm run typecheck` has errors in `ProseHoverCard.tsx`, `note-markers`, `supplement` and a stray
root-level `scratch-mint-session.ts` — all another agent's in-flight work, none of it chat. The full
suite has failures from a half-written `src/store/export.ts`, same cause.

## What I need judged

- Are the four fixes right, and did any of them introduce something new? Look hardest at the repair's
  merge rule, which is the one with the most ways to be subtly wrong.
- Is there any remaining path where an asynchronous result writes state without passing the gate?
- **Stage 3 is now the seven invariant permutations plus the rename fence** (`expectedTitle`, so the
  server can refuse a stale PATCH). Is that the right remaining scope, and is anything in stage 2
  still unfinished that I would be wrong to call done?

Read-only. Change no file. Say plainly whether it ships.
