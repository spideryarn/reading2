# GPT Sol's review of Stage 3b's CODE, 2026-09-08

Verbatim, as returned. Reviewed the scoped diff `65308efd..f83f5bc9` — both of 3b's commits, the
protocol split and rule 1. The **third** review of this stage, after
[the plan review](260908g-stage3-plan-review-sol.md) and
[3a's code review](260908g-stage3a-code-review-sol.md), and weighted higher than the plan one for
the reason `CLAUDE.md` gives.

Up: [260908g](260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) § The code
review of 3b, which says what each finding changed and what was left as a stated boundary rather
than closed.

**Note on the last line.** The concurrent uncommitted edit to `tests/overseer-rules.test.ts` was
mine, made while this review was running: an assertion that `overseer status` names every rule and
its disposition rather than only the first.

**All six findings were taken.** Two of them — F1 and F2 — changed what rule 1 decides.

---

Block Stage 3b. No P0, but four P1 findings make the current conclusions materially too strong.

## Findings

1. **P1 — `cannot-tell` collapses into durable `nothing-to-do`**

   [rules.ts:514](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rules.ts:514)

   When known drift is below the threshold, the code returns `nothing` regardless of `cannotTell`. With one unreadable agent and `minSessions: 1`, I reproduced:

   ```json
   {
     "kind": "nothing",
     "why": "... 0 read auto, 1 could not be read ..."
   }
   ```

   The protocol then persists that as `nothing-to-do`. The count survives in prose, but the discriminant—the part downstream consumers branch on—says the rule successfully determined there was nothing to do. So the four wire arms stay separate numerically but collapse during the decision.

   Use three-valued threshold logic:

   ```ts
   if (notAuto >= minSessions) return propose;
   if (notAuto + cannotTell >= minSessions) return cannotTell;
   return nothing;
   ```

   `notApplicable` remains outside that calculation. The test at [overseer-rules.test.ts:846](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-rules.test.ts:846) currently enshrines the wrong result.

2. **P1 — Rule 1 trusts rows from a payload explicitly reporting that collection failed**

   [rule-work.ts:373](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rule-work.ts:373)

   `/api/state` retains the last successful rows when a later collection fails and sets `error`. The daemon’s main admissibility gate correctly rejects such a payload at [admissible.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/admissible.ts:146), but `fleetStateObserver` never reads `error`.

   I supplied a recent payload with `error: "collector failed..."` and one retained manual-mode row. The observer returned `launch-modes`, and the rule proposed relaunching that stale session.

   Require `error` to be present and `null`; non-null or malformed/missing should produce `cannot-see`. Add the failed-collection fixture to the observer tests—the current `stateBody` fixture omits this required production field entirely.

3. **P1 — The claimed fingerprint boundary does not include the machinery that supplies durability or controls repeat execution**

   [rule-jobs.ts:120](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rule-jobs.ts:120), [rule-protocol.ts:113](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rule-protocol.ts:113), [store.ts:2515](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:2515), [scheduler.ts:297](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:297), [scheduler.ts:319](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:319)

   Two claims are false:

   - `rule-protocol.ts` does not implement “append-and-fsync.” It trusts `RuleLog.append`; the actual `fsyncSync` is in unpinned `store.ts`.
   - `scheduler.ts` can still change whether and how often a rule runs: it owns authorisation, lease expiry, release, reservation and completion. Changing `sweep` can permit overlapping/repeated runs without moving the rule pin.

   The decisive mutation is deleting `fsyncSync(this.fd)`. Every rule pin remains current, and the “intent is already on disk” test still passes because reading through another file descriptor proves visibility through the page cache, not crash durability.

   A self-verifying pin can never protect its entire verifier, so define the trust boundary explicitly. Either:

   - Treat scheduler/store as a reviewed execution TCB and narrow the fingerprint claim to rule-specific policy/protocol, or
   - Extract the durable append primitive and rule lifecycle semantics into small stable modules included in the rule fingerprint.

   The current wording claims the second while implementing the first. Also, the already-acknowledged `safe-to-kill` semantics remain outside the pin.

4. **P1 — The specimen cleanup can kill a different session by prefix**

   [overseer-launch-mode-specimen.ts:96](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer-launch-mode-specimen.ts:96), [overseer-launch-mode-specimen.ts:108](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer-launch-mode-specimen.ts:108), [overseer-launch-mode-specimen.ts:184](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer-launch-mode-specimen.ts:184)

   Tmux resolves a bare target first by exact name and then by prefix. If the exact specimen is absent but `overseer-launch-mode-specimen-old` is the sole prefix match, `sessionExists()` reports true and `stop()` kills that unrelated session. This repo already documents exactly this failure at [gjd-remote-tmux.test.ts:1335](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/gjd-remote-tmux.test.ts:1335).

   Use `-t =${SPECIMEN_SESSION}` for every `has-session` and `kill-session`. Also:

   - Do not collapse every `has-session` exception into “absent”; only exit status 1 means absent.
   - Replace `out.includes(SPECIMEN_SESSION)` at line 145 with an exact parsed listing-row check. A listing containing only `overseer-launch-mode-specimen-old` currently passes.

5. **P2 — Rule-family identities are still independently representable**

   [jobs.ts:104](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:104), [diff.ts:628](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/diff.ts:628), [store.ts:1326](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/store.ts:1326)

   The types allow:

   - `JobDefinition.id === "wedged-work"` with a `launch-mode` spec.
   - `ruleId === "launch-mode"` with a `wedged-work` finding.

   The test helper actually constructs the first shape when calling `ruleJob(LAUNCH)`. The store accepts the second because it validates both discriminants independently but never compares them.

   Define rule job definitions and intended events as mapped unions keyed by `RuleId`, and make the parser reject `finding.kind !== ruleId`. This is a better place to make the wrong state unrepresentable than the `decideRule` observer seam.

6. **P2 — The encoder tables ensure presence, not that a knob’s value is hashed**

   [rules.ts:152](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/rules.ts:152), [over Kerryseer-rules.test.ts:243](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tests/overseer-rules.test.ts:243)

   The per-arm mapped tables correctly make an omitted field a compile error. They are not airtight against:

   ```ts
   newKnob: () => "newKnob:"
   ```

   That compiles, appears in `RULE_SPEC_HASHED_FIELDS`, and passes the label-based test, while later value changes leave the hash unchanged.

   Add a derived test that perturbs every non-discriminant field and requires the canonical form to change, or use a sorted canonical scalar-object encoder that automatically includes both keys and values.

## Direct answers

- The runtime mismatch arm in `decideRule` is reasonable. It is an injected/runtime boundary and fails closed. Generic correlation would add substantial plumbing while still requiring runtime validation. I would fix the job-id/spec and event-id/finding correlations instead.
- `RULE_IDS: Record<RuleId, true>` and the per-finding switch are genuinely exhaustive. Remaining similar weak spots include `parseRuleOutcome`, whose raw-string switch is not compiler-linked to `RuleOutcome["kind"]`, and the manual two-literal `KillPolicy` check.
- The second HTTP GET is defensible for v1, but your availability argument is overstated. If `/api/state` is unreachable, the direct observer fails even while a previously accepted payload may remain usable. Conversely, GET has a real advantage you did not mention: it recomposes `servedAt`, whereas a held SSE payload’s original `servedAt` would remain frozen and could look permanently fresh unless additional age plumbing were added. I would keep GET, fix the `error` handling, and describe the trade-off that way.
- The specimen guard is not sufficient because of tmux prefix targeting and substring listing verification.
- The test most clearly unable to prove its stated claim is “intent is already on the disk”: it proves ordering and process-visible bytes, not fsync durability. The scheduler exclusion test likewise proves only that the whole file is excluded; it cannot establish that everything in the excluded file is behaviorally irrelevant.

Verification: the 138 targeted overseer rule/daemon/job tests passed; the full TypeScript wrapper passed via its non-IPC entry point and covered 1,749 files; all four pins are current; `git diff --check` passed. I changed no files. A concurrent uncommitted edit appeared in `tests/overseer-rules.test.ts` during review and is outside the reviewed revision range.