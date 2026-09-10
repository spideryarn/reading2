# Stage 1 code review, second run (narrow): 260910e work reports

You are the stage reviewer and fixer, in the worktree `/home/greg/code/spideryarn2/.claude/worktrees/work-reports`.
**30 minutes. Write your findings to the answer file FIRST, then fix.** The first run of this review was
killed at its limit with no answer; a narrow run that answers beats a thorough one that does not. At 20
minutes, stop starting new work and make sure the answer file holds your verdict.

## Background, briefly

Stage 1 of plan `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md`: agents run
`overseer report <kind>`, which drops a file in `~/.overseer/report-inbox/`; the daemon drains it every
30 s as the only writer of `reports.jsonl`, freezing enrichment in `report-processing/` before appending.
The plan's design section is the spec. What the first run found and fixed is in
`docs/plans/260910e-work-reports-stage1-review-sol.md` (recovered from its log). **Do not re-review what
that file says it covered.**

## Your scope — only these

**(a) The first run's fixes, which are unreviewed code by someone else** — commit `6b1761e7` (`git show
6b1761e7`): exact keys in `tools/fleet/artefact-ref.ts`; the bracketed `/proc` read in
`tools/overseer/report-identity.ts`; in `tools/overseer/reports.ts`, the hard-link refusal, the bounded
no-follow reads of `report-processing/` and `report-refused/`, **stopping the pass on any transient
failure**, the per-pass bounds now applied to the first item, the time check between probes, and the
validated `refusedAt`. Two questions above all:
   1. Can "stop the pass on any transient failure" let one permanently stuck item (say, a prepared file
      that always fails to replay, or a checker that always throws for one submission) starve every later
      submission for ever? If so, what is the smallest fix that keeps the torn-tail protection?
   2. Can the first-item bounds leave a legal submission (≤ 16 KiB, ≤ 20 artefacts) that can never be
      processed?

**(b) What the first run did not reach:**
   3. `tools/overseer/report-artefacts.ts`: are the git checks right — commit as a commit, on-dev via
      `merge-base --is-ancestor` against `refs/remotes/origin/dev`, path against the dev tree then realpath
      containment, "could not run git" as `unchecked` and never `not-found`? Your sandbox refuses
      `spawnSync("git")`, so read and reason; the orchestrator ran the real-git test outside the sandbox
      and it passed (6 files, 170 tests, exit 0).
   4. Claims stay claims: anything in `scripts/overseer.ts`'s `reports` output or in `foldReports` that
      turns a report into a state or a judgement (done, ready, contradicts), or reads a missing revision as
      a negative rather than "not stated"?
   5. The daemon's `reports` option and its condition in `tools/overseer/notes.ts`: can a throwing or slow
      drain stop or wedge the daemon, or leave the condition stuck open?

The first run also raised, and left, that the whole inbox directory is listed every pass. Say in one
paragraph whether that needs fixing before this lands (a runaway agent writing 100 000 files), and if so,
the smallest bound — but **do not build it**; report it.

## Rules

- Edit only Stage 1 files: `tools/overseer/reports.ts`, `report-artefacts.ts`, `report-identity.ts`,
  `daemon.ts`, `notes.ts`, `scripts/overseer.ts`, `tools/fleet/artefact-ref.ts`, and
  `tests/overseer-reports*.test.ts`, `tests/overseer-daemon-reports.test.ts`, `tests/fleet-artefact-ref.test.ts`.
- **Another agent is building Stage 3a in this worktree right now** (`tools/fleet/reports-view.ts`,
  `routes-reports.ts`, `server.ts`, `wire.ts`, `web/src/reports-client.ts`, `web/src/DecisionsPanel.tsx`,
  `docs/project/work-reports.md`, `docs/project/dev-and-deployment-overview.md` and their tests). Do not edit
  those; failures in them are not yours.
- Fixes narrow and red-first; anything bigger than a small change is reported, not built.
- Typecheck as `node --import tsx scripts/typecheck.ts` (the sandbox refuses `tsx`'s IPC socket).

## Format

Findings `WR-S1R2-1`… with severity (P0 wrong data or a wedged daemon; P1 must fix before landing; P2
should; P3 optional), file:line, what is wrong, and if fixed, the red test and the fix. Then the
directory-listing paragraph. Then a one-paragraph verdict on Stage 1 as a whole, taking the first run's
recovered findings into account. Then the summary lines of the Stage 1 test files after your fixes.
