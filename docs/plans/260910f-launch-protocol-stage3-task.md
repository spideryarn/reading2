# Stage 3 task: the daemon, Greg's controls, the projection, the drill

You are implementing Stage 3 of `docs/plans/260910f-launch-protocol-one-crash-protocol-for-scheduling-and-recovery.md`
in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/launch-protocol`. Read the whole plan,
its "Review dispositions" section (which overrides D1–D11), the status paragraphs under Stages 1–2,
and the code Stages 1–2 built: `tools/overseer/launch-protocol.ts`, `launch-store.ts`,
`launch-admission.ts`, `launch-artefacts.ts`, `launchers.ts`.

## What this stage is for

Make the foundation live in the one process that owns it, give Greg the controls, publish what a
later page will read, and produce the acceptance evidence — without launching any job for real.

## Files

- `tools/overseer/daemon.ts` — **small targeted edits; another session is editing this file's
  usage pass right now, so do not touch that region, re-read immediately before each edit, never
  rewrite.** At startup: open the launch store and the admission owner under the store root; a
  refusal (lock held, unreadable) is written to the daemon log and leaves launching unavailable
  rather than stopping the daemon. At startup and on every checkpoint tick: `reconcile()`, drain
  the launch inbox (bounded), write `launches.json`. Nothing here calls `launchOccurrence` — there
  is still no production caller (the Stage 1 test asserts it).
- `tools/overseer/launch-inbox.ts` (new) — the drop-directory for Greg's requests, the same shape as
  `recovery-inbox.ts` (on dev since 3dc65697; the orchestrator merges origin/dev into this worktree
  before this stage starts) and `reports.ts`'s `report-inbox/`. As of 2026-09-11 there is no shared
  helper, so this is a third small one; say in its header that it and those two want one helper,
  and do not extract it here (both are other sessions' files). Requests: `dispose
  <occurrenceId> --as not-running|ended --why` and `resolve-history --why --accept-hidden-launch-risk`.
  The daemon validates each against the fold, appends, releases, deletes the file; a replayed
  request id is refused as already applied (F7: a crash after `disposed` still releases on the next
  reconcile).
- `scripts/overseer-launches.ts` (new) — `list`, `show <id>` (reads `launches.json` and the
  occurrence's artefact directory, read-only), `dispose …`, `resolve-history …` (each writes one
  request file and says the daemon will apply it within a tick). **The dispose form is pinned —
  `scheduled-dispatch`'s page prints it verbatim:**
  `npx tsx scripts/overseer-launches.ts dispose <lo-id> --as not-running|ended --why "<reason>"`.
  The script fills the request id (a fresh uuid) and the actor itself; neither is a flag. Test that
  exact argv parses.
- `tools/overseer/launch-projection.ts` (new) — `launches.json`, bounded per F10 (200 non-terminal,
  most actionable first; the newest 50 terminal; `totalNonTerminal`, `omittedNonTerminal`; the
  journal's replay status and the owner's), written atomically each checkpoint.
- `tools/fleet/wire.ts` — **one block appended at the end of the file**, types only, no imports:
  the projection's shape, for Scheduled dispatch's page. Other sessions append blocks here too:
  append, never reorder or edit theirs.
- `scripts/launch-protocol-drill.ts` (new) — D11 as amended by F12: scratch store, scratch owner,
  disposable tmux socket, the fixture job's real `OccurrenceKey` from `standing-jobs.ts`, the tmux
  launcher variant that runs `true` on the scratch socket using the same artefact helpers
  gjd-remote uses. Kill and reopen at every boundary of D4's table; per boundary assert **exact**
  counts (external effects counted independently of the protocol's own counter — the marker files
  and tmux sessions on the scratch socket), print one line each, and exit non-zero on any mismatch.
  A `--negative-control` flag swaps in a no-op launcher and must make the first post-invocation
  row fail.
- Tests: `tests/overseer-launch-inbox.test.ts`, `tests/overseer-launch-projection.test.ts`,
  `tests/overseer-launch-daemon.test.ts` (the daemon wiring against a temp store root, with fakes
  for everything that is not the launch store), and a test that runs the drill (and its negative
  control) where tmux is present.

**Not yours:** `scheduler.ts`, `store.ts`, `diff.ts`, the recovery files, anything in
`tools/fleet/` other than the appended `wire.ts` block, `infra/`.

## Red first

A dispose of an unknown or completed occurrence is refused; a replayed request is applied once; a
crash after `disposed` still releases on the next reconcile; `resolve-history` preserves the old
journal byte-for-byte and starts a fresh one whose first record is `history-reset`; the projection
at 201 non-terminal records holds 200 and says 1 omitted; the daemon with an unopenable launch
store keeps running and says why; the drill passes and its negative control fails.

## How to work

As in Stages 1–2. The daemon test must use a temp store root and must never open `~/.overseer`.
Do not start, stop or signal the real Overseer daemon or the fleet dashboard, and no session on
the default tmux server. Focused suites, `npm run typecheck` (exit code), `npx biome lint` on your
files. Do not commit; do not run the full suite.

## Report back

Files changed, tests and exact results with exit codes, the drill's full output (both runs), every
departure from the plan and why.
