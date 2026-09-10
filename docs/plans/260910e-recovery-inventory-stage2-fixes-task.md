# Stage 2 fixes task: the review findings, applied

You are applying review findings to Stage 2 of
`docs/plans/260910e-recovery-inventory-show-interrupted-work-without-resuming-it.md`, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory`. Read Stage 2's section of the
plan first: its status, and F15–F20. The findings come from two reviews of the committed stage
(`730aec9d` plus the salvaged fixes `defba055`):

- an independent read-only Opus check (O1–O6, below);
- GPT Sol's round 2, read-only (F21 onwards, in
  `docs/plans/260910e-recovery-inventory-stage2-review-r2-sol.md`, **if it exists when you start**.
  If it does not, do O1–O6 and say so).

**Red first, for every finding with a behaviour change**: write the test, watch it fail, fix, watch
it pass. Report each red and green summary line.

## Opus check findings (the reviewer's scratch probes are in the scratchpad: `ri-oc-probe.ts`, `ri-oc-reverts-out.txt`)

**O1, P1, established. Derived dispositions are appended from the stale fold while the recovery
replay is `not-run`.** `runRecoveryTick` returns early, but `take()`'s accept path still calls
`appendDerived()`. The reproduction:

1. A store holds a verified run under TOKEN_ONE and a reboot, leaving one unresolved record.
2. A `resumed` for that record is appended via `openStore` with no checkpoint, then an unparseable
   line `{not an event}\n`.
3. On reopen the replay is `not-run` and the record reads `unresolved`.
4. One accepted collection runs the same conversation under TOKEN_TWO. That gives **two** `resumed`
   events; the control run, without the stale tail, gives one.

Fix: `appendDerived` returns early (true) while `store.recovery.replay.kind === "not-run"`. Add the
probe as a daemon test that calls `runOverseer` directly (the suite's `run()` helper throws on the
planted bad line) and counts only the parseable lines.

**O2, P2. The `not-run` hold is silent, and can outlive every restart.**
- `scripts/overseer-recovery.ts dismiss`: after writing the request, if the recovery index's replay
  is `not-run`, also print `HELD: the recovery index is incomplete (<why>); this request stays
  pending until a daemon start can read the whole log`. Use the arm name `list` actually uses.
- The daemon logs once per start when the replay is `not-run` and the inbox is non-empty.

**O3, P2. The 100-directory transcript bound will misreport this box.** There are 63 project
directories today, and every worktree adds one.
- Raise `RECOVERY_TRANSCRIPT_PROJECT_DIR_LIMIT` to 2000, with the measurement in its comment.
- When the listing is incomplete **and** a transcript was already found, return `found`, not
  `cannot-tell`.
- F20 reimplemented `findTranscript` inside `recovery-view.ts`, although plan §4 says to reuse it.
  Either make the reuse work (a bounded variant, exported from `tools/fleet/transcript.ts`, is
  **not** in your file set, so do not), or keep the local copy and say in its header comment why it
  departs. I record the departure in the plan.

**O4, P2. The inbox scan stops silently at its limit.** Pass `log` into `pendingRequests`, and log
one line when the scan stops at `scanLimit`.

**O5, P3. The view can be starved.** `trustInventory` invalidates the running pass on every
accepted collection. Only *withdrawing* trust should invalidate it: use
`requestView(!(before.kind === "trusted" && next.kind === "trusted"))`. Test: a slow view pass
(inject a slow `stat`) across two trusted accepts still publishes.

**O6, P3. A claimed file that cannot be read is never refused.** A symlink swapped into
`processing/` is logged on every tick. Fix: in the claimed-file read's `catch`, `refuse(...)` it,
with the cause.

## Files — yours

`tools/overseer/daemon.ts` (the recovery parts only), `tools/overseer/recovery-inbox.ts`,
`tools/overseer/recovery-view.ts`, `tools/overseer/recovery.ts`, `scripts/overseer-recovery.ts`,
`tests/overseer-daemon-recovery.test.ts`, `tests/overseer-recovery-view.test.ts`,
`tests/overseer-recovery.test.ts`. **Not** `tools/fleet/`, and not any other test file. If Sol's
findings need a file outside this set, stop and tell me.

## Gates, constraints, report

The same as the Stage 1 brief (`docs/plans/260910e-recovery-inventory-stage1-task.md` § Gates you
run, § Constraints, § What to report back). Use a `ri2f-` scratchpad prefix. Do not merge
`origin/dev`. Do not commit. Report back with one line per finding ID: fixed (red→green) /
not reproduced / declined, and why.
