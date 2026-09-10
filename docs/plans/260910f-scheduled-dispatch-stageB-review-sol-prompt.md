# Stage review: Scheduled dispatch, Stage B — the scheduler through the launch protocol

You are GPT Sol, the stage reviewer. **Fix what you find inside this stage**, red first, and report
anything wider for the author to decide (docs/reusable/codex-cli-as-subagent.md § The house
workflow). Worktree: the directory you are running in (branch `worktree-scheduled-dispatch`).

**Write your findings FIRST** to
`docs/plans/260910f-scheduled-dispatch-stageB-review-sol-findings.md`, before fixing anything, and
update it as you go. The wrapper overwrites `--output` at exit. If the sandbox refuses that path,
write it under `/tmp` and name that path in your closing message.

## The candidate (committed)

- Stage B commit(s): **{{STAGE_B_COMMITS}}**. Diff: `{{DIFF_COMMAND}}`.
- Changed paths: {{CHANGED_PATHS}}. Start there; this does not limit scope.
- **What this branch builds on, and is NOT under review.** The launch protocol (`tools/overseer/launch-*.ts`,
  `launchers.ts`) was merged in locally from `worktree-launch-protocol` at {{LAUNCH_PROTOCOL_SHA}}.
  It has its own reviews. Read it as the contract Stage B consumes. Report a defect you find in it,
  but do not fix it.
- The spec: `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`.
  Its "Review dispositions" section overrides D1–D8. It contains:
  - F1–F9, with the narrow check and Fable's arbitration of F1;
  - M2 and M5;
  - **M11** (the account is a runtime choice, pinned per occurrence);
  - **M12** (an abandoned occurrence releases its due instant; a lost account forces an abandon).

  The builder's brief: `docs/plans/260910f-scheduled-dispatch-stageB-task.md`, including 2b and 2c.
- Evidence: {{GATE_RESULTS}}.

## What to attack

**An independent pass first, against the roadmap's acceptance sentence:**

*A restart after real launch but before receipt cannot create a duplicate job; a missed day does not
produce a storm; failed/answerless jobs are visibly failed; no automatic `main` push or production
mutation is licensed by a schedule.*

- **At most one launch per job.** Find any sequence of ticks, restarts and protocol answers that
  passes two different occurrences of one job to `launchOccurrence` or `resumeOccurrence` while
  either could launch. Consider:
  - supersession;
  - rollback to an earlier hash;
  - a pinned account going `gone`;
  - a `waiting` answer;
  - a crash between `abandon` and `plan`;
  - the index merge of rules' `events.jsonl` occurrences with launch occurrences.
- **Never an old id.** Can the scheduler ever hand the protocol an id that is already in the fold,
  outside `resumeOccurrence`? Can an abandoned id come back?
- **No stranding.** Can a job wait for ever? Busy account, gone account, `outcome-unknown`, a
  history-lost journal, and a carried entry with a null origin.
- **The clock.**
  - Cadence from `endedAt`, and `replaced` due at once.
  - Spacing from the first attempt's `launchingAt`.
  - `resume` decided before `due()`.
  - One comparator for every "newest", with ties broken by index order.
- **The material** (D3). Is every document read once, re-hashed against this tick's authorised
  digest, and refused on a mismatch? Is the framing outside the pin, as the plan says?
- **Authority.**
  - Does anything let the unauthorised standing jobs (`get-ready-to-deploy`, `feedback-sweep`)
    launch?
  - Does the fixture's re-pin authorise anything beyond `{timeoutMinutes: 5, access: "read-only"}`
    and dry-run?
  - Activation with stale live pins (F6): a warning when disarmed, blocking on arm.
- **No second path.** Is `gjdRemoteDispatch` really gone, and does anything other than the
  protocol's composition call a launcher adapter? `tests/overseer-launch-protocol.test.ts` holds the
  allow-list.
- **The preview.**
  - Do the new verdicts (`resume`, `usage-held`) and the `launch` attempt arm reach `schedule.json`,
    the parser and the page without a kind being dropped or mapped to another?
  - `sessionTimeout` and `sessionNoOverlap` are no longer literals.

**Then the gates:**
- `npx vitest run` on every changed test file, plus `tests/fleet-attention.test.ts`,
  `tests/fixture-ids.test.ts` and `tests/overseer-launch-protocol.test.ts`;
- `npm run typecheck` (read the exit code; if the sandbox refuses the `tsx` IPC socket, use
  `node --import tsx scripts/typecheck.ts`).

## Rules

- **Severity by consequence:** P0 data loss / exploitable security / service broadly unusable; P1
  user-visible wrong behaviour or an authoritative contract violated; P2 design or maintainability
  risk; P3 prose.
- **IDs `T1`, `T2`, …** (S belongs to Stage A, F to the plan).
- For each finding: evidence (file:line), consequence, and what you changed or why you left it.
- Fix P0/P1/P2 inside the changed paths, with a red test first for each behavioural fix. Do not
  edit the launch protocol's files.
- **Do not commit.**
- End with the files you changed, the gate results with exit codes, and a verdict.

## The author's own doubts (worth less; spend most of the run elsewhere)

{{AUTHOR_DOUBTS}}
