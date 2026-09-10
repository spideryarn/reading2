# Stage 2 task: the launchers carry the correlation id

You are implementing Stage 2 of `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol`. Read the whole plan,
its "Review dispositions" section (which overrides the plan where they differ), and the Stage 1 code
it builds on: `tools/overseer/launch-protocol.ts`, `launch-store.ts`, `launch-artefacts.ts`.

## What this stage is for

The launched side of D6: each launcher carries the occurrence's correlation id in its **first
external effect**, and the launched process itself writes `start.json` and `exit.json` into the
occurrence's artefact directory, so a restarted daemon can find evidence without a live tmux
session or a transcript. Plus the two launcher adapters the protocol invokes.

## The review findings this stage must honour

The plan's "Review dispositions" section is authoritative. For this stage: **F3** (the shell
artefact helper: exclusive temp create via `set -C` in a subshell, write, `sync` the file, `mv`,
`sync` the directory; any failure goes through gjd-remote's existing `failTo`, so Claude never
starts without a durable `start.json`; `exit.json` through the same helper with the status already
saved; inject write/sync/rename failures in tests), **F6** (instrument the whole wrapper
invocation, not `runChild` or one credential attempt; `run-codex`'s read-only fallback and its
write-capable no-fallback rule untouched; one final `exit.json` after the existing final
classification via a synchronous outer finaliser that `fail()`'s `process.exit` also reaches;
tests for spawn error, signal, overflow, post-child validation failure, read-only fallback,
write-capable no-fallback), **F13** (`SPIDERYARN_LAUNCH_DIR` through the existing `shq` at every
layer — validation is not escaping; both new options before the unchanged final `-p -`; the
adapter writes the verified material plus newline and closes stdin; test a path with a space, a
quote and `$()`, and refuse a newline), and **F5/F9** (the adapters take the verified material from
the protocol and have no prompt parameter; they are not exported for any caller but the protocol's
composition).

## Files

- `tools/overseer/launch-artefacts.ts` — add the **writers**: a bash snippet generator for
  `start.json` (first line of a job script: pid `$$`, start ticks, boot id, `$TMUX_PANE`, time,
  written temp-then-`mv`) and `exit.json` (a given status variable), and a TS writer for the
  wrappers. The reader from Stage 1 is the contract; the writers must round-trip through it (test it).
- `scripts/gjd-remote.ts` — **session-creation path only; small targeted edits, re-read the region
  immediately before each edit, never rewrite; other agents may be editing this file.**
  `new-claude` gains `--launch-id <correlationId>` and `--launch-dir <abs dir>`: validated before
  any ssh (the correlation id regex from `launch-protocol.ts`; absolute; no odd bytes), and on the
  box before the session is created (the directory exists and its `intent.json` names that id —
  fold it into the existing ssh step rather than adding a round trip if you can). Add
  `-e SPIDERYARN_LAUNCH_ID=… -e SPIDERYARN_LAUNCH_DIR=…` to the one `tmux new-session` that creates
  the claude session. The job script writes `start.json` as its **first** line (before `cdGuard`)
  and `exit.json` right after `_gjd_claude_status=$?`. Without the flags the job text and the
  tmux command are byte-for-byte unchanged. Extract the pieces you add as small exported pure
  functions so they can be unit-tested (`cmdNewClaude` itself has no unit test and needs a box).
- `scripts/run-claude.ts`, `scripts/run-codex.ts` — additive `--launch-dir <dir>` only. The
  wrapper reads the correlation id from that directory's `intent.json`; refuses (before spawning
  anything) a directory that is missing, not owned by this uid, not mode `0700`, or has no valid
  intent; writes `start.json` (its own pid, start ticks, boot id) before spawning the child; passes
  `SPIDERYARN_LAUNCH_ID` into the child's environment; writes `exit.json` on **every** exit path —
  success, non-zero, signal, timeout, empty answer, missing result event — with the answer path,
  bytes, sha256 and the existing `answerIsUsable` verdict. **Nothing about routing, auth, stdin,
  `sanitisedEnv`, the answer validation or the console output changes.** Share one helper between
  the two wrappers (in `launch-artefacts.ts` or a small `scripts/` leaf), not two copies.
- `tools/overseer/launchers.ts` (new) — the two `Launcher` adapters the protocol invokes: tmux (via
  `gjd-remote new-claude … --launch-id … --launch-dir …`, with an injectable child spawner like
  `dispatch.ts`'s `ChildSpawner`, and a variant that targets an explicit tmux socket for tests and
  the drill), and headless (via `run-claude.ts`/`run-codex.ts --launch-dir`). Plus the `tmux` evidence
  port for `reconcile()`: list sessions on a socket, read `SPIDERYARN_LAUNCH_ID` from each session's
  environment, answer `found`/`absent`/`cannot-tell`.
- Tests: extend `tests/run-claude.test.ts` and `tests/run-codex.test.ts` (they already fake the
  binary — see `fakeClaude`), a new `tests/gjd-remote-launch-id.test.ts` for the pure pieces, and
  `tests/overseer-launchers.test.ts` with a **real tmux on a disposable socket** half, skipped where
  tmux is absent, the way `tests/gjd-remote-overseer-claim.test.ts` does it.

**Not yours:** anything else — in particular `scripts/subagent-cli.ts` (if you truly need a hook in
`runChild`, stop and say so), `scheduler.ts`, `daemon.ts`, `tools/fleet/`, `infra/`.

## Red first

- gjd-remote: a bad `--launch-id` is refused before any ssh; the `tmux new-session` string carries
  both `-e` values beside `metaFlags`; the job text's first line writes `start.json` and it writes
  `exit.json` before `exec bash -l`; with no flags, both strings are identical to today's.
- Wrappers: with no `--launch-dir`, argv, env and output are unchanged; a missing / foreign /
  `0755` / intent-less directory is refused before spawn; `start.json` exists before the fake CLI
  runs (have the fake CLI check for it); `exit.json` is written on success, non-zero exit,
  timeout and empty answer; the child sees `SPIDERYARN_LAUNCH_ID`.
- Real tmux, disposable socket: the adapter creates a session whose first process sees the id; the
  probe finds it by id; a session whose command exits at once still leaves `start.json` and
  `exit.json`, and the Stage 1 reader parses both.

## How to work

As in Stage 1: write like the surrounding files; tests first; a temp dir per test; your own tmux
socket under the temp dir, never the default server, and kill only that socket's server. Run the
focused suites, `npm run typecheck` (read the exit code), `npx biome lint <your files>` (never
`--formatter-enabled=true`). Do not commit, do not run the full suite, do not touch the fleet
dashboard, the Overseer daemon or any session on the default tmux server.

## Report back

Files changed, tests added and the exact results with exit codes, every departure from the plan
and why, and anything about the scripts you found that the plan did not know.
