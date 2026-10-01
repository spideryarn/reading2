# Report W3: testing and tooling traps

(Returned as text — the harness refused the subagent's own write — and saved here by the orchestrator.)

## What changed

- `testing.md`: removed the dead `tests/api.test.ts` row (deleted in `86a4ef7c`); repointed the
  `tests/claim-session-files.test.ts` citation (deleted in `1481e196`) to
  `tests/claim-session-postgres.test.ts`; § Run the suite in tmux — `--name` is `tmux-job.ts`'s only
  flag, and a log with no `Test Files` line is void (`EXIT=143` under green ticks); new § A scoped run
  answers a smaller question than it looks like; Greg's 2026-08-31 quote in § An eval run in a worktree;
  a process timeout does not bound the wait (260910a, 260906e); the eleven harness shapes since
  2026-08-27 in § Mocks and fixtures, one line each with its postmortem; new § Test the join: mutate the
  composition root (260908b, 260831e).
- `typechecking.md` § Four ways to report it clean while it is red: ✗ lines go to stderr, the last
  lines are ✓, and a pipe replaces the exit code.
- `worktrees.md`: three more edges of the isolation check in § Two things about `EnterWorktree`; Greg's
  2026-09-01 "push directly to dev" quote.
- `hetzner-remote-server-box.md`: tmux-job gets the tmux server's environment; a dispatched session can
  sit at `needs you`; a `--wait` brief lives in `~/gjd-remote/prompts/`; closing a tab never ends
  `claude` (`~/gjd-remote/sessions.mjs`); `tmux -t` matches by prefix, and `tmux ls | head` hides
  sessions.
- `browser-testing.md`: `npx tsx … &` + `kill $!` leaves the node child on the port; new § A long check
  measures a moving tree.
- `browser-testing-playwright.md`: a 200 from the port doesn't make the server yours; a same-URL `goto`
  can serve the old bundle; MCP screenshots land in the checkout; no microphone, so feed
  `MediaRecorder` from Web Audio; a parked mouse overwrites tap-driven hover.
- `fleet-dashboard-modes.md` § The test: a row's `textContent` includes its `tw:sr-only` tooltip spans.
- `overseer-queue.md`: `export` is ~280 KB; the report id is `metadata.source`; `edit` prints its
  LAPSES warning whatever the authority.

## Memory files, for the Overseer's prune

**Moved — can be cut to a pointer or deleted:**

| memory | now in |
|---|---|
| `a-triage-agent-kills-your-vitest` | `testing.md` § Run the suite in tmux |
| `tmux-job-takes-no-dash-dash` | `testing.md` § Run the suite in tmux |
| `vitest-ignores-a-missing-test-path` | `testing.md` § A scoped run |
| `scoped-test-gate-misses-a-routes-other-callers` | `testing.md` § A scoped run |
| `mutate-the-composition-root` | `testing.md` § Test the join |
| `sr-only-spans-satisfy-row-text-assertions` | `fleet-dashboard-modes.md` § The test |
| `piping-a-check-hides-its-exit-code` | `typechecking.md` § Four ways |
| `typecheck-tail-hides-its-own-errors` | `typechecking.md` § Four ways |
| `worktree-isolation-refuses-complex-bash` | `worktrees.md` § Two things about `EnterWorktree` |
| `worktree-isolation-refuses-git-in-heredocs` | `worktrees.md` § Two things about `EnterWorktree` |
| `tmux-t-resolves-by-prefix` | `hetzner-remote-server-box.md` § Traps |
| `tmux-ls-piped-through-head-lies` | `hetzner-remote-server-box.md` § Traps |
| `tmux-job-loses-your-exported-env` | `hetzner-remote-server-box.md` § Where things are |
| `a-waiting-sessions-brief-is-in-a-separate-file` | `hetzner-remote-server-box.md` § `--wait` |
| `gjd-remote-sessions-may-not-start-in-auto-mode` | `hetzner-remote-server-box.md` (the fact; the habit is P4) |
| `npx-tsx-survives-killing-its-shell-job` | `browser-testing.md` § And check the port |
| `curling-a-port-cannot-tell-two-servers-apart` | `browser-testing-playwright.md` § In a worktree |
| `a-rebuild-does-not-reach-a-same-url-navigate` | `browser-testing-playwright.md` § The traps that stay |
| `playwright-screenshots-land-in-repo-root` | `browser-testing-playwright.md` § The traps that stay |
| `no-audio-input-device-on-this-box` | `browser-testing-playwright.md` § The traps that stay |
| `playwright-mixing-click-and-tap-fakes-hover` | `browser-testing-playwright.md`, after the `isMobile` list |
| `overseer-queue-export-is-too-big-to-read` | `overseer-queue.md` |
| `queue-edit-warns-about-a-lapse-that-cannot-happen` | `overseer-queue.md` |

**Partly moved — keep:** `tmux-outlives-closed-tabs` (the session-kill judgement belongs in the
pinned `overseer.md`); `browser-agents-measure-a-moving-tree` (the record-the-sha half is P5).

**Not moved:** `pull-latest-on-waking-up` (P1), `announce-before-taking-a-queued-slice` (P2),
`vitest-process-count-is-five-per-suite` (P3).

## Proposals

- **P1** `worktrees.md` § The workflow — new: Greg's 2026-09-06 quote *"when you wake up, pull the
  latest changes to avoid a big merge conflict at the end"*, then: after a cron one-shot, a long wait,
  a compaction or a `--resume`, run `npx tsx scripts/worktree-freshen.ts` first. Reason: Greg's
  instruction, only in auto-memory.
- **P2** `plans.md` (queued slices) or `overseer-queue.md` — new: before starting a slice a plan has
  queued publicly, `SendMessage` the live peers and write *Claimed, <date>, by <session>* into the
  plan; on 2026-09-07 two sessions built the same slice eleven minutes apart. Reason: a new
  instruction.
- **P3** `docs/reusable/diagnose-box-resources.md` — new: `pgrep -fa vitest | wc -l` counts about five
  processes per running suite; count suites, or read load and MemAvailable. Reason: reusable doc.
- **P4** `feedback-reports.md` § dispatch (pinned; needs a re-pin) — new: a few minutes after
  dispatching, check `gjd-remote ls` for `? needs you`, and hand Greg the resume command. Reason: the
  habit half of a memory.
- **P5** `testing.md` § A green run here proves less than it looks like — new: record the sha a long
  gate started from, and before acting on its failure check it is still `HEAD`. Reason: on 2026-09-08
  three sessions reported a red after its fix had merged.

Judgement call: some Mocks-list and Test-the-join lines read close to advice; each is written as its
postmortem's finding with the link. If any reads as rule wording, revert those.

## Found, left for others

- `live-conversation.md` / `dictation.md` could point at the no-microphone bullet.
- `never-apply-migration-ddl-directly` belongs in `database.md` and `supabase-local.md` (W4's).
- `testing.md` is ~1,480 lines; the natural split is § A green run here proves less than it looks like
  and § One database, many suites.
