# GPT Sol's review of Stage 8's plan, 2026-09-09

Verbatim, as returned. Reviewed durable commit `9efcbf5b`. The **third** Sol review of this job —
after the Stage 3 plan and the Stage 3a code — and the third to block. Up:
[260908g](260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md) § Stage 8, which
says what each finding changed. **Every finding accepted; none overruled.**

**S8-1 is the one to read first.** `scripts/overseer-pins.ts`'s own header says *"an authorisation the
authorised party can write is not one, and a script that edited the literal would be exactly that."*
I wrote that sentence during Stage 3a and then planned the script it forbids, ten hours later, in the
same repository. Sol found it by reading the tool I had built.

---

Verdict: block Stage 8 as written. I found three P0s, four P1s, and one P2.

## Findings

### S8-1 — P0 — The automatic pin writer defeats Gate 3

Plan: [260908g…md:1621](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1621); [overseer-pins.ts:12](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer-pins.ts:12); [overseer.md:123](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/project/overseer.md:123)

The mechanical premise is correct:

- `everyMs` is encoded by `DEFINITION_ENCODERS` at [jobs.ts:233](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:233).
- `schedulerTick()` checks `authorisationOf()` before `due()` at [scheduler.ts:293](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/scheduler.ts:293).
- Therefore a changed interval with the old pin is refused.

But “recompute the hashes and write the pins” computes the new hash from the entire current definition, including prompts and document bytes. If a schedule edit rides beside an unrelated document or prompt change, the script blesses both. That is exactly what the existing calculator says it must not do: it prints hashes because “a person decides,” and explicitly calls an automatic pin editor a broken authorization boundary.

Do instead: separate `JobBehaviour` from `ScheduleConfig`. Hash and manually pin the instruction, work kind/policy, and authoritative documents. Keep cadence, phase, and first eligibility outside that behavioral fingerprint. Protect abusive schedule values through validation and Gate 4, rather than turning a convenience script into an authority-granting tool.

If schedule changes must remain independently authorized, use a separate schedule pin and make the updater refuse whenever the behavioral hash has moved; do not rewrite one composite pin.

### S8-2 — P0 — The Gate 4 exception contradicts Gate 4

Plan: [260908g…md:1669](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1669); gate: [overseer.md:126](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/project/overseer.md:126)

The clock-versus-condition distinction is useful for burst analysis, but it does not satisfy the stated gate. Gate 4 expressly rejects each component keeping a “locally sensible number” and requires one shared reservation plus an explicit exhausted state. It then says the gate becomes load-bearing when the scheduler is armed.

Furthermore:

- Twelve is a steady-state ceiling on session launches, not model calls.
- Those sessions can run for hours and make multiple model calls.
- Attention, routing, recovery, and scheduled work still draw from the same subscription.
- Re-pinning currently resets cadence and permits additional immediate launches, so even the claimed session ceiling is not invariant under configuration changes.

“The schedule is the budget” is therefore the precise local-budget argument the gate rules out.

Do instead: build the shared durable admission/reservation mechanism before arming, even if its first policy is deliberately small. Otherwise Greg must explicitly amend Gate 4 after being shown this exception; the stage cannot reinterpret the existing rule on its own.

### S8-3 — P0 — The handoff commands do not install the changed unit

Plan: [260908g…md:1681](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1681); installer: [provision.sh:1296](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/infra/hetzner/provision.sh:1296)

`systemctl daemon-reload` rereads `/etc/systemd/system/overseer.service`; it does not copy the changed checked-in unit there. The only source-shown installer is `provision.sh`’s `install_unit()`. Therefore the listed `daemon-reload`, `enable`, and `restart` sequence can restart the old, disarmed unit successfully.

There is a second trap: if `restart` precedes stopping the tmux daemon, the systemd process loses the store lock and can exhaust the unit’s ten-start limit before the tmux process disappears.

Do instead: provide one idempotent activation command that:

1. Validates config, definitions, and authorization.
2. Installs the substituted unit or required environment file atomically.
3. Stops the tmux daemon before starting systemd.
4. Reloads and restarts systemd.
5. Waits for a fresh checkpoint.
6. Exits nonzero unless systemd is active, the checkpoint says fully armed, and both named jobs are eligible/scheduled.

### S8-4 — P1 — Every schedule update discards cadence and can duplicate live work

Plan: [260908g…md:1628](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1628); [jobs.ts:609](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:609)

`lastRunOf()` considers only occurrences whose `definitionHash` equals the current hash. Changing `everyMs` and re-pinning therefore makes all prior occurrences disappear from cadence calculation; `due()` reads that as `never` and dispatches immediately.

This is the accepted SC-3 finding from the earlier code review. Stage 8 exercises the unsafe migration path deliberately and currently does not repair it. A recently dispatched detached session can overlap its replacement.

Do instead: give occurrence lineage a stable identity independent of the behavioral authorization hash. Preserve the behavior hash on each occurrence for audit, but use the stable schedule lineage to find the latest run and hold unsettled legacy occurrences.

I cannot verify from source that neither standing job has ever run. That requires inspecting the live occurrence store before activation.

### S8-5 — P1 — A one-shot offset does not survive the recurrence model

Plan: [260908g…md:1634](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1634); [jobs.ts:565](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/jobs.ts:565)

“Once separated they stay separated” is false.

Each next run is independently measured from its previous outcome. Different launcher durations accumulate phase drift. More decisively:

- After a day’s downtime, both jobs are overdue and dispatch in the same scheduler tick.
- A missed run does not retain the original phase.
- A stuck occurrence is converted to unresolved and subsequently schedules from its reservation time, producing an arbitrary new phase.
- The recorded outcome is the short-lived `gjd-remote` launcher finishing, not the detached Claude session finishing, as explained at [dispatch.ts:17](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/dispatch.ts:17).

Do instead: encode the real invariant—a durable minimum separation between session launches. When two jobs are due, dispatch one and leave the other visibly waiting until that spacing expires. A fixed UTC epoch plus per-job phase can provide nominal timing, but catch-up still needs the cross-job spacing gate.

### S8-6 — P1 — `notBefore` has no durable anchor

Plan: [260908g…md:1657](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1657)

The prohibition on a synthetic `finished` occurrence is right. It would fabricate history.

But `offsetMs` alone does not say what it is relative to. If it is relative to process startup, every restart postpones the first run again; a repeatedly restarting service may remain “armed” forever without dispatching.

Do instead: record a genuine scheduler-control fact such as `armedAt`, distinct from the occurrence ledger, and derive `firstEligibleAt = armedAt + initialDelayMs`. `lastRunOf()` should continue to say `never`; status should say “never run; first eligible at …”. Missing or inconsistent arming state should fail closed and visibly.

### S8-7 — P1 — Editing or applying config can appear successful without affecting the daemon

Plan: [260908g…md:1628](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1628); [standing-jobs.ts:183](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/tools/overseer/standing-jobs.ts:183); [overseer.ts:740](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/scripts/overseer.ts:740)

Definitions are built once at daemon startup. A hand edit does not immediately cause refusal; the running daemon continues with the old in-memory schedule. Writing new pins also does not make the running definitions match anything until restart.

The refusal is not literally silent after restart: it is logged as `NOT AUTHORISED`. But `schedulerWiring()` derives the `ARMED` headline solely from the environment flag, even when definitions failed to build or are unauthorized. Thus systemd can be active and status can begin with `ARMED` while one or both requested jobs cannot run.

Do instead: define an apply postcondition, not just file mutation. The command must validate, restart, wait for a fresh checkpoint, verify exact loaded schedule values and current behavior pins, and fail nonzero otherwise. Missing, malformed, non-finite, non-positive, unknown, or duplicate schedules should be fatal under full arming.

### S8-8 — P2 — Arming belongs in a required runtime state file, not hardcoded in the unit

Plan: [260908g…md:1651](/home/greg/code/spideryarn2/.claude/worktrees/overseer-scheduler/docs/plans/260908g-the-overseer-runbook-its-gates-and-the-scheduler-that-wakes-it.md:1651)

Hardcoding `OVERSEER_JOBS_ENABLED=1` makes every ordinary service restart a re-arm and requires a repo edit plus unit installation to disarm paid work while retaining the observational daemon. That is the wrong control plane for a 3am operational switch.

Use `EnvironmentFile=/etc/overseer.env` without the optional `-`. Provision it once with an explicit disarmed value and never overwrite an existing file. An idempotent arm/disarm command should update it atomically, restart, and verify the checkpoint. The real state is then untracked but not invisible; it is explicit runtime state reported by both systemd and the daemon.

The byte-comparison test protects the necessary delivery duplicate in `provision.sh`; it is not a reason to embed mutable arming state in both copies.

## Config format

Use a TypeScript config module, not JSON:

- Comments and `hours(6)`/`minutes(90)` make 3am edits readable.
- `satisfies` can enforce exactly the two known job IDs.
- No dependency is added.
- `StandingJobId` can be derived from the config keys.
- `standing-jobs.ts` should import this one object and delete both interval constants.
- Runtime validation must still enforce safe numeric bounds.

Pins should remain a separate fact only for behavior—not a second copy of schedule values.

The two requested test files passed at the reviewed tree. Relevant code is unchanged from `9efcbf5b`; the later revision only changes `docs/project/overseer.md` among the files reviewed. No files were changed.