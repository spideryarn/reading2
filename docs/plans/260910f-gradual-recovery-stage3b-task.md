# Stage 3b task: the launch, for real

You are implementing Stage 3b of
`docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md` in the
worktree `/home/greg/code/spideryarn2/.claude/worktrees/recovery-resume`.

**This starts only once `launch-protocol`'s Stages 1, 1b and 2 are on `dev` and merged here.** The
facts below were settled against its branch commits `3858a4a9` and `9662df2f`. If what landed
differs, what landed wins, and say how it differed.

Read these first:

- the plan's §6, its Stage 3 section, and the "What `launch-protocol`'s Stage 2 settled" and
  "…Stage 1b settled" lists;
- the dispositions G1, G2, G3, G6 and G7;
- `tools/overseer/launch-protocol.ts` (`PlanRequest`, `LaunchOutcome`, `composeLaunchProtocol`,
  `inspect`, `inFlight`, `usesTmux` and `admissionPolicy`);
- `tools/overseer/launchers.ts`;
- `scripts/gjd-remote-launch.ts`, and the four `--launch-id` insertions in `scripts/gjd-remote.ts`;
- `tools/overseer/recovery-resume.ts` (`ResumeLaunchPort`, and how the pass calls it).

**Rules:**

- Work only in this worktree. No commit or push, and no git command that changes state.
- Read outside the worktree only through Bash.
- Use the scratchpad prefix `s3b-`.
- Run long jobs through `scripts/tmux-job.ts` (`--name` only).
- **Never the default tmux server, never `~/.overseer`, and never port 8787.** Every tmux test and
  drill uses a private socket (`tmux -L <name>`).
- `scripts/gjd-remote.ts` is a shared file. Make small targeted edits on the session-creation path
  only, re-reading each region before you edit it.

## Pieces

1. **The `tmux-resume` launcher kind** in `launch-protocol.ts`.
   - Its `PlanRequest` arm carries `resume: { conversationId: string /* uuid */; dir: string /*
     absolute */ }`, and `account: string` (the pinned registry name). It is recorded in `planned`
     and in `intent.json`, and it is part of F5's conflict check.
   - Add its arm to `usesTmux`, so reconciliation probes tmux by correlation id (G7). The compiler
     should list every other switch it needs.
   - The material is the nudge, and nothing else.
   - The admission class is `recovery-resume`.
2. **gjd-remote's `--resume-conversation <uuid>`**, beside the `--launch-id` pieces, and pure where
   possible, in `scripts/gjd-remote-launch.ts`.
   - It is mutually exclusive with minting a `--session-id`.
   - The job runs `claude --resume <uuid> --permission-mode auto -- "$(cat -- <prompt>)"` in `dir`,
     through the existing `cdGuard`.
   - It sets `CLAUDE_SESSION_ID=<uuid>` in `-e` at creation.
   - It keeps `start.json` ahead of the directory guard, and `exit.json` straight after
     `_gjd_claude_status=$?`.
   - It refuses a non-uuid before any ssh.
   - **On the box, before `tmux new-session`**, it refuses when any tmux session's environment
     already has `CLAUDE_SESSION_ID=<uuid>`. The spike showed nothing stops two processes resuming
     one conversation. Fold this check into the existing box-check round trip.
   - It uses the pinned `--account <name>`, never `auto`.
3. **The adapter in `launchers.ts`**: the `tmux-resume` launcher, passing
   `gjd-remote new-claude <name> --account <name> --resume-conversation <uuid> --dir <dir>
   --launch-id … --launch-dir … -p -`, on the existing tmux adapter's pattern. That pattern covers
   the injectable spawner, the explicit-socket variant for tests, and material as a regular file.
   Its environment is composed deliberately: a new tmux session takes its environment from the
   creating client. **No `CLAUDE_CONFIG_DIR` may leak in from the daemon.** The account's comes
   from gjd-remote's own `--account` prefix.
4. **The port adapter**: `ResumeLaunchPort` from `composeLaunchProtocol(...)`'s `launchOccurrence`,
   `inspect` and `inFlight`.
   - The request's `recoveryOrigin(candidateId)`.
   - `inspect` answering `null` and then being refused means **held by a history reset**. That is a
     `refused` request which names the reset, and it is never free to launch. Test it.
   - `failed-before-launch`'s `reservation: released | held` maps to the G1 table.
   - The port's `drive(candidateId)`, added by the G13 fix, maps to the composed protocol's
     `resumeOccurrence(occurrenceIdOf(recoveryOrigin(candidateId)))`. Confirmed by
     `launch-protocol`, 2026-09-10. It drives a stored `planned` or `waiting-admission` record
     with no re-plan. From any other state it answers `not-launchable`, and for an unknown id or a
     lost history it answers `refused`. `reserved` is never driven: reconciliation settles it.
5. **The daemon** composes the launch protocol with the `tmux-resume` launcher, and hands the port
   to the resume pass, replacing `unwired`. Make small targeted edits, and merge first. If
   `launch-protocol` already composes the protocol in the daemon for the scheduler, **reuse that one
   composition**; do not build a second store or a second owner. Name the flag it waits behind, if
   any, the way `OVERSEER_JOBS_ENABLED` gates the scheduler. Recommend one in your report rather
   than inventing one silently: the Overseer and Greg decide arming.
6. **The drill**: `scripts/overseer-recovery-drill.ts --resume`, extending it, not forking it.
   - It runs a scratch store, a scratch launch store and a private tmux socket.
   - A fake `claude` on `PATH` for the drill writes one transcript line with the resumed
     `sessionId`, and stays alive.
   - Assert, counting with an independent marker the fake writes:
     - two requests give one launch, a defer until verification, then the second launch;
     - **killing the daemon between invocation and the move to `done/`, then restarting, gives no
       second invocation**;
     - a third candidate tapped twice gives one launch;
     - a transcript deleted after the preview gives a refusal;
     - **a no-op launcher, as a negative control, must make the drill fail.**
   - It never uses the default tmux server or `~/.overseer`, and it never reboots anything.

## Red first; mutations; gates

Every new test must go red for its intended reason before it goes green. The required tests:

- **gjd-remote:**
  - the job text for `--resume-conversation` has no `--session-id <new>`, sets `CLAUDE_SESSION_ID`
    to the resumed id, and keeps both artefact lines;
  - a non-uuid is refused before ssh;
  - the box check refuses a live duplicate;
  - without the flag, the job text and the tmux command are byte-for-byte unchanged.
- **The adapter**, on a real private socket, skipped where tmux is absent:
  - the session's first process sees the correlation id;
  - `CLAUDE_CONFIG_DIR` is the account's, never the daemon's.
- **Reconciliation** (G7): a tmux effect with no `start.json` reaches `observed-running` for
  `tmux-resume`.
- **The port adapter**: every `LaunchOutcome` arm, and the reset case.
- **The drill**: the counts above, and the negative control.

After it is green, run these mutations and confirm each turns a test red:

- drop the box check;
- drop `usesTmux`'s `tmux-resume` arm;
- let `auto` through;
- skip the reset rule.

Gates:

- the focused suites, plus every launch-protocol, launchers, gjd-remote and recovery suite;
- `npm run typecheck` (read the exit code);
- `npx biome lint` on the files you touched.

## Report back

- files;
- the red→green counts;
- the mutations;
- the gate exit codes;
- the drill's output table;
- every decision, including the arming-flag recommendation;
- anything outside your file set.

Conclusions, not code.
