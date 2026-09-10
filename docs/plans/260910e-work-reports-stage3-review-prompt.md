# Stage 3 code review: 260910e work reports — the dashboard's claims, the inbox bound, decision reports

You are the stage reviewer and fixer, in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/work-reports`.
**30 minutes. Write each finding, as you find it, to
`docs/plans/260910e-work-reports-stage3-review-sol-findings.md`** — not to the answer file, which
`run-codex` overwrites with your closing message. Findings first, then fixes, so a timeout still leaves a
verdict. At 20 minutes, stop starting new work, put the verdict in the findings file, and repeat the
findings and verdict in your closing message.
Fix inside the stage, narrowly and red-first; report anything wider.

## What to review

Plan `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md` (the design section is
the spec; the Stage 3 status paragraph says what the builders decided) and the brief
`docs/plans/260910e-work-reports-stage3-task.md`. Two commits:

- **3a** — `c5242a04`: `tools/fleet/reports-view.ts`, `routes-reports.ts`, `web/src/reports-client.ts`,
  the Claims section in `web/src/DecisionsPanel.tsx`, two lines in `server.ts`, one block appended to
  `wire.ts`, `docs/project/work-reports.md`, and the `tests/fleet-reports-*` tests.
- **3b** — `b1c6d669`: in `tools/overseer/reports.ts`, the bounded inbox enumeration (the Stage 1
  review's condition for landing — `docs/plans/260910e-work-reports-stage1-review-r2-sol.md` § Directory
  listing bound) and step [2], a session's decision into `decisions.jsonl`; `scripts/overseer.ts report
  decision`; the reports tests.

Earlier stages are reviewed; do not re-review them except where 3b changes them.

## Questions, in order

1. **The inbox bound** (3b): does one pass now read at most a fixed number of directory entries, however
   many are in the inbox? Can a hostile prefix of invalid entries still starve a valid submission? Does
   the quarantine move a symlink rather than its target, and stay bounded?
2. **Decision reports** (3b), gate 1: can a session's decision appear as the Overseer's or Greg's, or as
   reviewed? Is it frozen in `report-processing/` before either append, and does a crash between the
   decisions append and the reports append re-drain to exactly one of each even if the register and
   checker answer differently on the retry? Is decisions-lock contention left pending, not refused?
   Does it honour `OVERSEER_DECISIONS_DIR`?
3. **Claims stay claims** (3a): anything in the projection, the route or the panel that turns a report
   into a state (done, ready, landed, contradicts), hides an unreported session, makes "the register
   could not be read" look like "nobody reported", or builds a link from anything but `artefactHref`?
4. **The route** (3a): read-only (405), both ceilings, and HEAD; a failure never looks like an empty log.

The finding I would least like to be wrong about: that nothing a session submits can make its decision
look like someone else's, or look reviewed.

Edit only the Stage 3 files listed above. Typecheck as `node --import tsx scripts/typecheck.ts`. Your
sandbox refuses `spawnSync("git")`, so a real-git test that fails there only with EPERM is environment;
the orchestrator runs it outside.

## Format (in your closing message)

Findings `WR-S3-1`… with severity (P0 wrong data, gate 1 broken, or a wedged daemon; P1 must fix before
landing; P2 should; P3 optional), file:line, what is wrong, and if fixed, the red test and the fix. Then
wider things you did not fix. Then a one-paragraph verdict. Then the summary lines of the Stage 3 test
files after your fixes.
