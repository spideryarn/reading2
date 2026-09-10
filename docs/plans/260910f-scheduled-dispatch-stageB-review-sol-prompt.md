# Stage review: Scheduled dispatch, Stage B — the scheduler through the launch protocol

You are GPT Sol, the stage reviewer. **Fix what you find inside this stage**, red first, and report
anything wider for the author to decide (docs/reusable/codex-cli-as-subagent.md § The house
workflow). Worktree: the directory you are running in (branch `worktree-scheduled-dispatch`).

**Write your findings FIRST** to
`docs/plans/260910f-scheduled-dispatch-stageB-review-sol-findings.md`, before fixing anything, and
update it as you go. The wrapper overwrites `--output` at exit. If the sandbox refuses that path,
write it under `/tmp` and name that path in your closing message.

## The candidate (committed)

- **Stage B is three commits:**
  - **2dac033f** (B1: the scheduler through the protocol);
  - **ae3e18cd** (B2: the classifier on the final exit.json, and `observedOf`);
  - **46f5da98** (B3: collapsed onto the protocol's real 2b types, plus the `superseded` result
    kind).

  Read them with `git show 2dac033f ae3e18cd 46f5da98`. The two merges between them (11ee6139 and
  a866b2e4) bring in launch-protocol's work and dev's, which are not under review. So a
  `git diff` across the whole range would show you other people's code in `wire.ts`, `daemon.ts`,
  `schedule-preview.ts` and `status-cli.ts`. **Take this stage's changes from the three commits**,
  and use the tree at 46f5da98 for everything around them.
- **Changed paths:**
  - `tools/overseer/`: `jobs.ts`, `schedule-plan.ts`, `scheduler.ts`, `launch-occurrences.ts` (new),
    `dispatch.ts`, `standing-jobs.ts`, `schedule-preview.ts`, `daemon.ts` (B1's minimal lines only),
    `occurrence-result.ts`, `observed-launch.ts` (new), `occurrences-projection.ts`;
  - `scripts/`: `overseer.ts`, `overseer-activate.ts`;
  - `tools/fleet/`: `wire.ts` (the SchedulePreview types and the Scheduled occurrences block),
    `schedule-parse.ts`, `occurrences-parse.ts`, `web/src/SchedulePreview.tsx`,
    `web/src/ScheduledOccurrences.tsx`;
  - `tests/`: `overseer-scheduled-dispatch.test.ts` (new), `overseer-observed-launch.test.ts` (new),
    and the ported suites named in the commit messages.

  Start there; this does not limit scope.
- **What this branch builds on, and is NOT under review.** The launch protocol (`tools/overseer/launch-*.ts`,
  `launchers.ts`) was merged in locally from `worktree-launch-protocol` at e3bcace3 (its Stages 1, 1b, 2 and 2b; merged here at a866b2e4, together with the dev commits that branch had merged).
  It has its own reviews. Read it as the contract Stage B consumes. Report a defect you find in it,
  but do not fix it.
- The spec: `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`.
  Its "Review dispositions" section overrides D1–D8. It contains:
  - F1–F9, with the narrow check and Fable's arbitration of F1;
  - M2 and M5;
  - **M11** (the account is a runtime choice, pinned per occurrence);
  - **M12** (an abandoned occurrence releases its due instant; a lost account forces an abandon).

  The builder's brief: `docs/plans/260910f-scheduled-dispatch-stageB-task.md`, including 2b and 2c.
- Evidence, rerun by the author at 46f5da98 and not taken from the builders' reports:
  - `npm run typecheck`: exit 0.
  - The 25 focused test files: exit 0, 880 tests. The list is the `npx vitest run` line in
    `docs/plans/260910f-scheduled-dispatch-stageB-task.md`'s gates, plus the protocol's own suites
    and `doc-links`.
  - The builders watched 21 scheduled-dispatch tests go red. They checked the account and
    `replaced` rows with three planner mutants, and saw 5 M13 tests go red.

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

- **A launch occurrence is its own type, not a new arm of `Occurrence`**
  (`ScheduledOccurrence = Occurrence | LaunchOccurrence`, read through a `ScheduleIndex`), and it is
  never stored.
  - Is there anywhere, such as `sweep()`, `lastSessionLaunchOf`, the checkpoint's `jobs` field,
    `overseer status` or `reconcile-jobs`, that still reads the store's plain `OccurrenceIndex` for
    a session job, and so sees nothing?
- **A session job in a process with no launch protocol reads `history-lost`**, not "refused".
  - Is that the right word on the preview for a disarmed daemon, or does it alarm where nothing is
    wrong?
  - Relatedly, `schedulerWiring` now hands over no session capability under any arming until Stage
    C wires the protocol, so under `all` the session jobs read ineligible.
- **The `replaced` rule (M12) is pinned only by a `due()` unit test.** The builder's mutant showed
  the rollback test through the real protocol does not catch a wrong `dueAt`. Is one unit test
  enough for the rule that stops a lost account, a supersession or a rollback from costing an
  interval?
- **The preview schema stays at 1**, while `sessionHistory` is added and `sessionTimeout` became an
  object. An older daemon's `schedule.json` then reads as unreadable until that daemon restarts.
  Should the schema have moved?
- **Account choice.**
  - The account is chosen once per tick, and a resume keeps its stored account: busy means hold,
    gone means abandon and replan (M11, M12).
  - Is there a sequence in which an account flips between clear and gone across ticks and
    produces more than one launch for a job? Or one where a replacement is planned on an account
    that the tick has just judged gone?
