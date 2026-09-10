# Stage 1 code review: 260910e work reports — the reports log, inbox, drain and CLI

You are the stage reviewer **and fixer**, in the worktree
`/home/greg/code/spideryarn2/.claude/worktrees/work-reports`. Greg, 2026-09-09: the reviewer fixes what
it finds inside the stage, narrowly and red-first, and reports — does not fix — anything wider.

## What to review

The Stage 1 commit is `HEAD` of branch `worktree-work-reports` (its parent chain includes `41a87872`).
Scope it with `git show --stat HEAD` and `git show HEAD`. Its files:

- `tools/overseer/reports.ts`, `tools/overseer/report-artefacts.ts`, `tools/overseer/report-identity.ts`
- `tools/overseer/daemon.ts` (one additive option and interval), `tools/overseer/notes.ts` (one condition)
- `scripts/overseer.ts` (`report`, `reports`, and the drain composed into `run`)
- `tests/overseer-reports.test.ts`, `tests/overseer-reports-cli.test.ts`, `tests/overseer-daemon-reports.test.ts`
- and, committed earlier, `tools/fleet/artefact-ref.ts` + `tests/fleet-artefact-ref.test.ts` (written by hand
  with its test; **never seen red** — a mutation of it that the tests miss is a finding).

The spec is the plan `docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md` (design
section, and the Stage 1 status paragraph listing what the builder decided) and the brief
`docs/plans/260910e-work-reports-stage1-task.md`. Your own earlier plan review is
`docs/plans/260910e-work-reports-plan-review-sol.md`: check that WR-P3, P4, P5, P6 and P9 are really met
in code, not just named.

**Another agent is editing the decisions files in this worktree right now** (`tools/overseer/decisions.ts`,
`scripts/overseer-decisions.ts`, `tools/fleet/decisions-view.ts`, `routes-decisions.ts`, `wire.ts`, the
decisions web client and panel, the decisions tests, `tests/fixtures/decisions-v1-frozen/`). They are
uncommitted and not yours: do not edit them, and a typecheck error in them is not a finding. Edit only the
Stage 1 files above.

## Evidence

The orchestrator ran: `npx vitest run tests/overseer-reports.test.ts tests/overseer-reports-cli.test.ts
tests/overseer-daemon-reports.test.ts tests/fleet-artefact-ref.test.ts tests/overseer-daemon.test.ts
tests/overseer-daemon-usage-pass.test.ts tests/overseer-cli-parse.test.ts` ⇒ 7 files, 167 tests passed,
exit 0. Run any of these yourself; they need nothing outside the tree. A finding you reproduced outranks
one you reasoned to.

## Questions, in order

1. **Replay exactness.** At every crash boundary of the drain (before/after `report-processing/` is
   written, after the `reports.jsonl` append, after unlinking processing, before unlinking the inbox
   file), does a re-drain produce exactly one row with the frozen `receivedAt`, execution comparison and
   checks? Is the duplicate test (rebuilding the submission from the recorded event) sound, or can two
   different submissions rebuild to the same thing, or one submission rebuild differently?
2. **The inbox as an attack surface for a runaway agent running as the same user**: symlinks, hard
   links, FIFOs, name ≠ event id, oversize, a flood, a `.tmp-` file that never completes, a refused
   directory that grows. Do the bounds actually bound?
3. **Untrusted text**: every field of a submission and of a recorded event — anything that reaches a
   terminal, a git argv, a path join, or a later URL without passing `untrustedTextProblem` /
   `pathProblem` / a fixed pattern?
4. **Execution**: `observeOwnExecution` and the daemon's comparison. Can a report be called
   `same-verified-run` when it is not? Is anything called current because a token is absent?
5. **The daemon edit**: can the drain stall or stop the daemon (a synchronous pass with git timeouts on
   the event loop, a throw, shutdown during a pass)?
6. **Claims stay claims**: anything in the CLI output or the fold that turns a report into a state or a
   judgement ("done", "contradicts") that the plan says must not be inferred?

**The finding I would least like to be wrong about**: that a crash between the `reports.jsonl` append and
the unlink of the inbox file can never produce a second row or a refusal of an honest report.

## Format

Findings with an ID (`WR-S1-1`…), severity (P0 wrong data or a broken daemon; P1 must fix before
landing; P2 should fix; P3 optional), file:line, what is wrong, and — if you fixed it — the red test you
added first and the fix. Then a list of wider things you noticed and did not fix. Then a one-paragraph
verdict. Run the Stage 1 test files after your fixes and paste the summary lines.
