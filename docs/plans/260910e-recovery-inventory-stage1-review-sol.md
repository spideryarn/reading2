ACCEPT — three established P1s were fixed red-first; one wider P2 remains for your decision.

- F11 — P1, established: a changed boot ID did not close the old world when the new populated snapshot lacked a readable tmux generation. `diff()` returned `held` before candidates were written. Fixed by durably closing the old world while leaving the unreadable new world un-baselined. Test: [overseer-daemon-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-daemon-recovery.test.ts:248). Fix: [daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts:1302).

- F12 — P1, established: an unchanged sighting emits no session event, so an orphaned pending candidate could swallow a later legitimate disappearance. Fixed by carrying the baseline collection identity and merging only candidates with the same last sighting. Test: [overseer-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-recovery.test.ts:299). Fix: [recovery.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/recovery.ts:515).

- F13 — P1, established: after recovery-tail replay refused a hole, `checkpoint()` advanced the recovery cursor past the entire unread range. Valid candidates around the hole could then be skipped permanently. Fixed by retaining the last accepted cursor, recording whether whole-log or tail replay must be retried, and restoring the prior replay verdict after repair. Test: [overseer-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-recovery.test.ts:402). Fix: [store.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/store.ts:3560).

- F14 — P2, reasoned, not changed: when `recovery.json` is absent or unusable, whole-log derivation deliberately sets `bootId: null`. If the machine rebooted before the first subsequent collection and tmux reused its PID and handles, no comparison can detect the old world. The smallest conservative design would close a non-empty restored register once as “boot unverifiable,” producing one-time unknown candidates during an ordinary upgrade or lost-index recovery. That changes the plan’s deliberate decision and warrants your call.

Your suspicions:

- Unstamped snapshots do not hide the normal reboot paths: changed/unverifiable generation or a known boot-ID change still creates candidates.
- The problematic boot-ID interleaving was the `held` path, fixed as F11.
- The pending merge could swallow a real second disappearance, fixed as F12.
- Torn-tail repair happens once before both replays and both use the repaired size. The separate cursor-advancement bug was F13.

Parser safety: the added sighting identity remains backward-compatible with journal lines and `recovery.json` written by the original Stage 1 commit. Both upgrade shapes have explicit tests at [overseer-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-recovery.test.ts:347).

Verification:

- Focused suites: 2 files, 49 tests passed.
- Mutation pass: all three new regression tests went red when their fixes were disabled, then returned green.
- Direct typecheck script: four TypeScript projects passed; all 1,967 source files covered.
- `npm run typecheck` itself could not start `tsx` because the sandbox refused its `/tmp` IPC socket (`EPERM`); running the same script directly with Node passed.
- `git diff --check` passed.
- No commit made.

Changed files:

- [tools/overseer/recovery.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/recovery.ts)
- [tools/overseer/store.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/store.ts)
- [tools/overseer/daemon.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tools/overseer/daemon.ts)
- [tests/overseer-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-recovery.test.ts)
- [tests/overseer-daemon-recovery.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/recovery-inventory/tests/overseer-daemon-recovery.test.ts)

The pre-existing untracked Stage 3 task document was left untouched.