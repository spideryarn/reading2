Found one P0, five P1s, and two P2s.

## Findings

1. **S2-01 — P0 — [tools/overseer/diff.ts:298](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:298): an unreadable generation silently bridges two tmux worlds.**

   Sequence: snapshot A has generation `100` and `$7`; tmux restarts; snapshot B has generation `null` and a newly allocated `$7`; snapshot C has generation `200`. Both `100 → null` and `null → 200` are `unverifiable`, so both are diffed normally. If the handle, claim, and status coincide, no event is emitted across the reboot. If the status differs, a plausible status transition is attributed across unrelated sessions.

   A non-empty snapshot with a null generation should not advance the diff baseline. Rejecting or separately holding it is safer. An empty fleet with null generation can remain admissible because there are no handles to equate. The current test at line 264 pins the unsafe default.

2. **S2-02 — P1 — [tools/overseer/observation.ts:223](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:223): impossible PID values pass strict parsing and manufacture generation changes.**

   Sequence: A reports `tmuxServerPid: 132280`; B is otherwise identical with an advanced clock but reports `132280.5`. It parses because it is finite. `generationRelation` calls it changed, producing closures for every old row and sightings for every new row.

   The producer only derives PIDs from bounded digit strings. The consumer should require positive safe integers. The same weak domain validation affects `panePid`, `waiting.secondsLeft`, `tookMs`, and `refreshMs`; notably, zero or negative `refreshMs` will later poison freshness calculations.

3. **S2-03 — P1 — [tools/overseer/diff.ts:130](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:130): restarting or extending a wait produces no event.**

   Sequence: A sees `{kind:"waiting", secondsLeft:60}`; the wait finishes or is replaced, and before B the session begins a new 3,600-second wait. B sees `{kind:"waiting", secondsLeft:3600}`. Both keys are `"waiting"`, so the history shows one uninterrupted wait.

   Suppressing a decreasing countdown is correct; suppressing a material increase is not. Detecting this needs comparison logic—probably an implied deadline with tolerance—not a status key that discards the only distinguishing value. The existing test covers only `900 → 840`.

4. **S2-04 — P1 — [tools/overseer/observation.ts:298](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:298): the parser accepts `reportedStatus` on causes for which the producer says it is impossible.**

   Sequence: A reports `unknown / agents-unavailable / reportedStatus:"a"` and B reports the same cause with `"b"`. Both parse; `statusKey` includes the token, so the differ emits a status transition manufactured from a malformed row.

   The producer contract says the token is present only for `unrecognised-agent-status`. Enforce that correlation, ideally with a local discriminated union so invalid combinations are also unrepresentable after parsing.

5. **S2-05 — P1 — [tools/overseer/admissible.ts:105](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/admissible.ts:105): equal clocks are trusted as identical collections without checking that the payload agrees.**

   Sequence: A at time T contains generation `100` and the old fleet; B also claims T but contains generation `200` or different rows, with `error:null`. B is labelled `duplicate`; the inconsistency and possible reboot disappear silently.

   The current producer makes equal-clock successful payloads invariant, so disagreement is evidence of contract failure and should be `reject`, not `duplicate`. The real duplicate fixture proves the ordinary case but does not test inconsistent equal-clock bodies.

6. **S2-06 — P1 — [tools/overseer/observation.ts:340](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:340): recovery metadata is less strictly validated than at the producer.**

   Sequence: a schema-1 row with `meta.dir:"relative/path"` parses and is emitted in `session-seen`. After a reboot, a later resumer can treat that as the recorded working directory and resume the real conversation in whichever directory the daemon happens to occupy.

   The producer requires an absolute path of bounded length and validates the repo value; this parser checks only non-empty `dir` and string `repo`. These are register fields specifically preserved for recovery, so the producer’s invariants should be repeated at the socket boundary.

7. **S2-07 — P2 — [tools/overseer/observation.ts:178](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/observation.ts:178): `FreshSnapshot` does not encode admissibility despite comments saying only `admissible()` can mint one.**

   Sequence: a caller parses a payload with a collected clock but `error` non-null, narrows `clock`, reconstructs `{...snapshot, clock:snapshot.clock}`, and passes it to `diff()` without a cast. Clock monotonicity and error-nullness are not represented in the type.

   An opaque admissible-snapshot brand would enforce the intended gate. This brand would earn its keep more directly than `ClaimedConversationId`, which currently distinguishes no verified counterpart and validates nothing.

8. **S2-08 — P2 — [tools/overseer/diff.ts:267](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/tools/overseer/diff.ts:267): the unavoidable between-collections blind spot is not documented.**

   Sequence: a session starts after A and exits before B. Neither snapshot contains it, so no pure differ can record it.

   That is acceptable—there is no evidence from which to derive an event—but it should be stated alongside the stale-claim limitation. The fixtures README documents observed churn, not this sampling boundary.

## Other judgments

- Event ordering is coherent: old-world closures first, then next-snapshot events in row order.
- One `session-replaced` event is preferable to a false gone/seen pair.
- `shell.busy`, unknown cause, and reported status are appropriate key material. `why` and ordinary countdown movement are correctly excluded.
- Taking `ParseResult` in `admissible()` is not itself a conflation: the union and distinct reasons preserve parse failure versus stale evidence clearly.
- `SessionKey` and `StatusKey` are useful brands. `ClaimedConversationId` is mostly documentary today and risks implying validation it does not perform.
- The real fixtures remain useful for producer-envelope drift and ordinary ordering, but they do not provide broad semantic coverage. A parser that accepts impossible numeric domains, an admissibility gate that trusts inconsistent equal-clock payloads, and a differ that loses wait resets all pass the suite. The README is candid about this weakness.

The requested test command passed: 2 files, 40 tests. No files were changed.