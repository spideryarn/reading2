# Review: plan 260910f stage 2 — `overseer diagnose`: revision, schema and clocks of each service in one command

Repo: /home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose (linked worktree), branch
`worktree-ops-diagnose`. TypeScript + ESM, `tsx`, vitest. `tools/fleet/` must never import
`tools/overseer/`.

## The candidate

Committed: the commit titled "260910f stage 2: `overseer diagnose` — each service's revision,
schema and clock in one command" (`git log --oneline -5` shows it). `git show --stat <sha>` is the
complete manifest. Other agents' uncommitted work may be in the tree; it is NOT the candidate.

Start with: `tools/overseer/diagnose.ts`, `tools/fleet/store-probe.ts`, the `standingFromReads`
extraction in `tools/overseer/status-cli.ts`, the `diagnose` arm in `scripts/overseer.ts`, and the two
new tests. Plan: `docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.md`
(D1–D5, Stage 2). Stage 1 (`cb4c3ba7`, `tools/fleet/revision.ts`) is under its own review; read it
only as the input this stage consumes.

## What it is meant to do

One read-only command that names each service's start revision and its verdict against this
checkout, the checkpoint schema and clocks, boot ids, every store file's schema and age, and the
job-list comparison — **and never renders a match, a healthy clock or a known schema out of an
absence or an unreadable read.** The statement to check for accuracy: *"every line `diagnose`
prints is either read from a file or process at this moment, or says it could not be; no line says
'same', 'running' or 'schema N' unless the thing was actually read."* Say precisely where that is
false. Also: does it only read? (Anything that writes, locks, or truncates a store file — including
the notes log's open-time repair of a torn tail — is an established P1 for a diagnostic.)

## What you can and cannot run, and what you may change

Findings only: the tree is read-only. /tmp and node_modules caches are writable. You can run one
test file (`npx vitest run tests/<one>.test.ts`) and `node --import tsx <script>`. No network.

## Attack it

Independently first. For each finding: an ID continuing from the plan review's highest (start at
F40 if unsure), P0/P1/P2/P3 (P0 data loss/security/service unusable; P1 user-visible wrong behaviour
or contract violated; P2 design risk; P3 prose), established or reasoned; (a) the input or mutation
I can run that shows it fails its claim; (b) the smallest change that closes it. Refuse only on an
established P0/P1.

**Write your findings FIRST to
`docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.stage2-review-answer-findings.md`**
if you can write at all; otherwise put the full findings in your final message. The `--output` file
is overwritten with your closing message at exit.

## My own suspicions — read last

- `diagnose.ts` imports `daemon.ts` (for `BASELINE_FILE`, `readHostBootId`) — does importing it
  have side effects, and does `readNotes` or the store reader repair or lock anything on open?
- The bounded 64 KB JSONL tail: can a single long last line make `schema`/`lastLineAt` wrong rather
  than unknown?
- The job-list comparison reuses `schedulePreviewLines`; is the checkout's list built exactly as the
  daemon's `schedulerWiring` builds it?

Do not change any file.
