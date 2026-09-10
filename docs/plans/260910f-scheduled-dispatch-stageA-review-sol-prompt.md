# Stage review: Scheduled dispatch, Stage A — observed result, occurrences projection, route, page

You are GPT Sol, the stage reviewer. **You fix what you find inside this stage**, red first, and
report anything wider for the author to decide (docs/reusable/codex-cli-as-subagent.md § The house
workflow). Worktree: the directory you are running in (branch `worktree-scheduled-dispatch`).

**Write your findings FIRST** to
`docs/plans/260910f-scheduled-dispatch-stageA-review-sol-findings.md`, before fixing anything, and
update it as you go. The wrapper overwrites `--output` at exit, and a reviewer that dies at its
time wall must still leave its findings behind.

## The candidate (committed)

- Commits **ee213ec7** (Stage A) and **7c30355f** (Sol's plan-F7 fix to the answer route). Diff:
  `git diff 6ef7fe56^ 7c30355f -- tools tests`. Ignore any docs/plans files in that range.
- Changed paths: `tools/overseer/occurrence-result.ts`, `tools/overseer/occurrences-projection.ts`,
  `tools/fleet/occurrences-parse.ts`, `tools/fleet/routes-occurrences.ts`,
  `tools/fleet/occurrences-wiring.ts`, `tools/fleet/server.ts` (three lines),
  `tools/fleet/wire.ts` (the appended "Scheduled occurrences" block),
  `tools/fleet/schedule-parse.ts` (one export), `tools/fleet/web/src/SchedulePreview.tsx` (three
  exports), `tools/fleet/web/src/OverseerPanel.tsx` (the mount),
  `tools/fleet/web/src/occurrences-client.ts`, `tools/fleet/web/src/ScheduledOccurrences.tsx`, and
  tests `tests/overseer-occurrence-result.test.ts`, `overseer-occurrences-projection.test.ts`,
  `overseer-occurrences-roundtrip.test.ts`, `fleet-occurrences-parse.test.ts`,
  `fleet-occurrences-route.test.ts`, `fleet-scheduled-occurrences-section.test.tsx`. Start with
  those; this does not limit scope.
- The spec: `docs/plans/260910f-scheduled-dispatch-one-durable-occurrence-one-reconciled-launch.md`
  § D6, D7, and the "Review dispositions" section (F5, F7, and "Stage A departures").
- Evidence: 186 focused tests and `npm run typecheck` were green at 7c30355f. Nothing writes
  `occurrences.json` yet (that is Stage B/C), so the page shows its "no file" arm live.

## What to attack

Independent pass first:

- **The result ladder** (`classifyOccurrence`). Can any input read as `succeeded` without an exit of
  0, verdict `ok`, a usable answer, and positively zero denials and no usage limit? Can a failed or
  answerless job fail to be visibly failed, anywhere between the classifier and the pill on the
  page?
- **The parser's state/result pairing table.** It was written by reading the classifier's header,
  not by importing it. Can it refuse a pair the classifier actually produces, or accept one it
  cannot?
- **The answer route as an attack surface** (`docs/project/security-map.md`: every URL segment is
  attacker-controlled): traversal, symlink, FIFO, TOCTOU between the lstat walk and the open, a
  duplicated id, an oversized `occurrences.json`, request-path encoding.
- **The fleet/overseer boundary**: no `tools/fleet` import of `tools/overseer`
  (`tests/fleet-attention.test.ts`), and the browser bundle importing only node-free leaves.
- **Instants and durations** that could throw during render (`RangeError` from
  `toISOString`/`Date`), per docs/project/fleet-dashboard-modes.md § Absence is stated.

Then the gates: `npx vitest run` on the six test files plus `tests/fleet-attention.test.ts`,
`tests/fleet-schedule-preview-section.test.tsx` and `tests/fixture-ids.test.ts`; then
`npm run typecheck` (read the exit code).

## Rules

Severity by consequence: **P0** data loss / exploitable security / service broadly unusable; **P1**
user-visible wrong behaviour or an authoritative contract violated; **P2** design or maintainability
risk; **P3** prose. Findings get IDs **S1, S2, …** (not F-numbers: those belong to the plan review).
For each: evidence (file:line), consequence, and what you changed, or why you left it. Fix P0/P1/P2
inside these files, a test red first for each behavioural fix; do not edit files outside the
changed-paths list except tests. **Do not commit.** End with the list of files you changed, the
gate results with exit codes, and a verdict.

## My own doubts (worth less; spend most of the run elsewhere)

- The page draws "(empty)" for `answer.usable: false`. Is "empty" the only way an answer is
  unusable (`answerIsUsable` in `scripts/subagent-cli.ts`)?
- `occurrencesProjection` throws on a launch filed under the wrong job. The daemon catches the
  preview's throw the same way — but nothing calls this one yet. Is a throw the right contract?
