## Finding

**S1-1 — P2 — [scripts/gjd-remote-tmux.ts:955](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/scripts/gjd-remote-tmux.ts:955)** — `unrecognised-agent-status` collapses potentially meaningful source transitions, and `why` does not genuinely preserve them for history.

Sequence: a future Claude version reports `compacting`, then `waiting-for-input`; both collections produce the same transition key, `unknown:unrecognised-agent-status`. The daemon emits no second event and overwrites `current.json`, permanently losing the intermediate status despite the source having changed. Unlike reworded prose, the reported status token is machine-readable observed data and may encode a real transition.

Keep the stable cause, but add a separate structured field such as `reportedStatus`, and decide explicitly whether that field participates in the canonical key. This need not block S1, hence P2.

No other P0–P3 findings.

## Requested judgments

1. **`statusOf` is equivalent.** The ordering in [sessionState()](/home/greg/code/spideryarn2/.claude/worktrees/overseer-o1-store/scripts/gjd-remote-tmux.ts:924) proves it:

   - `claudeId === null` returns `shell`.
   - An invalid ID returns `not-a-session-id` before inspecting `agents`.
   - A wait returns `waiting` before inspecting `agents`.
   - Every remaining session has a valid ID and is not waiting, so `agents === null` necessarily returns `agents-unavailable`.

   On the old empty-map replay, those last sessions become `running-but-unlisted`, `process-probe-unavailable`, or `no-claude`, so the old code appended `agentsWhy` in exactly the cases now selected by `cause === "agents-unavailable"`. The invalid-ID case survives both calls unchanged, so both implementations decline to append the box error.

2. **The other six distinctions are sound.** The five `sessionState` causes correspond one-to-one with its five unknown-producing clauses. `no-status-derived` and `client-declared` both lack an observation, but collapsing them would confuse an internal join invariant failure with an untrusted browser assertion. They belong in the final `SessionState` vocabulary even though different producers mint them.

3. **Making `cause` required is correct.** Optionality would preserve precisely the invalid state the migration exists to eliminate. The unrelated owner conflict is a landing concern, not a reason to weaken the type. `gjd-remote`’s read-only use of `kind` and `why` remains structurally compatible.

4. **The fixture is a real guard.** Adding a union member without changing the fixture produces a missing-property type error. Adding it to `Exclude` can weaken the test, but that requires an explicit test edit; no test can prevent somebody deliberately editing its assertion. The runtime loop also checks that each fixture key matches the cause actually returned. A producer-specific return subtype could remove the manual exclusions, but I do not consider that necessary for this stage.

5. **Nothing load-bearing was lost with `LISTED_NOTHING`.** Its sole behavior was determining whether the unknown survived replacing `null` with an answered-but-empty map. `cause` now records that distinction directly and avoids a second evaluation.

Verification: the four requested suites passed, **222 tests**. Direct `tsc` reported only the acknowledged missing cause in `tools/fleet/routes-steer.ts:388`. The requested full commit hash was absent locally; I reviewed the reachable `1ec23a4c334975843e52307cd4a1ea98e75808a8`, whose merge is the supplied `e98db6a0…`.