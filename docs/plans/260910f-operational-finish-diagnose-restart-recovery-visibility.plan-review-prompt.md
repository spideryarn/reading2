# Review: plan 260910f — operational finish: `overseer diagnose`, revision stamps, a web summary, crash/restart tests on scratch instances, an off-box dead-man proposal

Repo: /home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose (a linked worktree), branch
`worktree-ops-diagnose`. TypeScript + ESM, run with `tsx`, vitest tests in `tests/`. Two host
services: the fleet dashboard (`tools/fleet/server.ts`, systemd, port 8787) and the Overseer daemon
(`tools/overseer/daemon.ts` `runOverseer`, store under `~/.overseer`). `tools/fleet/` must never
import `tools/overseer/` (the seam is a file).

## The candidate

Committed: the plan file `docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md`
at the commit that adds it (`git log -1 -- <that path>` names it). Plan review only; no code yet.

Start with: the plan, then the spec it implements —
`docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md` § "Stage: Operational finish" (line
~1738) and its "runtime record" (line ~398). Then the code it leans on: `tools/fleet/instance.ts`,
`tools/fleet/wire.ts` (`ProducerStamp`, `SchedulePreview`), `tools/overseer/status-cli.ts`
(`daemonStanding`), `tools/overseer/notes.ts` (`daemon-started`), `tools/overseer/daemon.ts` :634–750,
`tools/overseer/schedule-preview.ts` § `listRevision`, `scripts/overseer.ts` :1605–1620,
`scripts/overseer-watchdog.ts`, `tools/fleet/overseer-status.ts`, `tools/fleet/server.ts`,
`vite.fleet.config.ts`. This is where to begin, not the limit of scope.

## What it is meant to do

Make "which revision is each service running, which checkpoint schema, how old is each clock, does
the daemon hold the job list this checkout builds" answerable in one command and one web section,
**without ever claiming a revision the process did not record at start**; prove crash/restart
boundaries on scratch instances, never the live store, dashboard or daemon; and propose (not build)
an off-box dead-man monitor. Stage 5 of the plan is a placeholder while destination research runs;
judge its shape, not its contents.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). No network, not
even loopback.

## Attack it

Independently, before you read my questions below. The invariants to break: (1) a revision shown as
known or matching when the running code is not that revision; (2) a test that reaches the live
fleet, the live store, a paid model, or the live tmux server; (3) a stage that cannot be built
inside the named file set without touching another live session's files (the brief lists them in
the plan's File set); (4) acceptance — "a green test suite without an observed stopped-clock /
failed-source control is insufficient evidence" — not actually met by Stage 4 as written.

For each finding give:
  - an ID (F1, F2, …), a severity (P0/P1/P2/P3), and whether it is established or reasoned
  - (a) the concrete scenario the plan does not handle, or the authoritative contract it contradicts
  - (b) the smallest change that closes it — exact replacement wording for the plan
A finding with no (a) goes last.

Severity: P0 data loss, exploitable security, service broadly unusable; P1 user-visible wrong
behaviour or an authoritative contract violated; P2 design/maintainability risk; P3 prose.
Refuse only on an established P0 or P1, and name what established it.

**Write your findings FIRST to
`docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.plan-review-answer-findings.md`
before anything else you do at the end** — the `--output` file is overwritten with your closing
message at exit, and reviewers have died at their time wall having answered nothing. If you cannot
write it (read-only sandbox), put the full findings in your final message.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
- Stamping revision at process start with `git rev-parse HEAD` + dirty: `tsx` compiles lazily, so a
  module first imported an hour after start comes from the tree as it is then. Is "dirty/HEAD at
  start" still an honest name for the running code, and what wording keeps it honest?
- Whether putting `revision` on the `daemon-started` note (not the checkpoint heartbeat) is the right
  home, given the checkpoint is what every reader already opens.
- Whether spawning `server.ts` in a test is safe enough with the env redirections listed, or whether
  it writes somewhere not redirected.

Do not change any file.
