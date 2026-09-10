# Scheduled dispatch Stage B — Sol review findings

Review complete. This file is the findings record required by the Stage B review brief; each
finding was recorded here before its corresponding fix was made.

## Findings

### T1 — P1: the breaking schedule-preview format change still claims schema 1

Evidence: `tools/fleet/schedule-parse.ts:52` still declares
`SCHEDULE_PREVIEW_SCHEMA = 1`, and `tools/fleet/wire.ts:4294` still fixes the writer type at
`schema: 1`, while Stage B makes the top-level `sessionHistory` required and replaces the
`sessionTimeout` and `sessionNoOverlap` shapes. A schedule file written by the preceding daemon is
therefore accepted as the current schema and then reported as damaged (`unreadable`) rather than as
an older, unsupported schema.

Consequence: during the normal old-daemon/new-dashboard overlap, the Schedule section gives the
wrong diagnosis and disappears as an unreadable file until the daemon restarts. This violates the
parser's own contract that a different build is distinct from damaged data.

Change: fixed. `tests/fleet-schedule-parse.test.ts` first failed because the former shape was
classified as unreadable. The writer and parser now use schema 2, schema 1 is reported as
unsupported, and the route/UI fixtures carry the new schema.

### T2 — P1: launch-journal loss points to the rules ledger's recovery command

Evidence: `tools/overseer/schedule-preview.ts:290-295` maps every `history-lost` plan to “the
occurrence ledger” and says it remains blocked until `overseer reconcile-jobs` runs. Session jobs'
history is the launch journal under F2; `reconcile-jobs` repairs only `events.jsonl`. The launch
protocol has a distinct attributed `resolve-history` operation.

Consequence: the preview tells an operator to repair the wrong ledger. The command can succeed
while the scheduled session remains held, a silent-success path in the recovery guidance. Worse,
that successful no-op leaves a rules-ledger reconciliation token which a later, unrelated
`events.jsonl` history loss can consume, weakening that ledger's fail-closed duplicate-run guard.

Change: fixed. `tests/overseer-schedule-preview.test.ts` first failed because a lost launch journal
still pointed to `reconcile-jobs`. The preview now distinguishes the job kind: rules retain that
command, while sessions require launch-journal history resolution without claiming the
not-yet-landed Stage C CLI spelling.

### T3 — P2: the occurrences projection has a second definition of “newest”

Evidence: `tools/overseer/occurrences-projection.ts:94-126` orders the newest ten first by
`scheduledAt`, then `plannedAt`, then fold order. The binding Fable P3 disposition makes
`plannedAt`/`reservedAt`, then index order, the one comparator for newest occurrences; that is what
the planner's `lastRunOf`, last-attempt display, and resume candidate use.

Consequence: a journal whose due instants are not in planning order (for example across schedule
or clock changes, or inherited records) can show a different “last” occurrence and answer link in
the occurrences panel from the occurrence the scheduler treats as newest. It is also a second
ordering rule for future changes to keep aligned.

Change: fixed. A new projection test first failed by showing the older-planned launch first. The
projection now orders solely by `plannedAt`, with reverse fold index for an exact tie.

### T4 — P1: a schedule-origin record with no pinned account is automatically resumed

Evidence: `tools/overseer/launch-occurrences.ts:105-121` maps a protocol record with `run === null`
(the interactive `tmux` launcher) to a null account. `tools/overseer/schedule-plan.ts:665-692`
then treats that record as resumable, merely waits for any new account choice to be clear, and
calls `resumeOccurrence` on the stored request. The chosen account is not applied to that request;
the protocol resumes its stored interactive launcher and null run spec.

Consequence: a resumable schedule-origin record not created by this scheduler can bypass M11's
pool-account pin and D4's authorised timeout/access profile. It can also bypass the scheduler's
required `tmux-headless` launcher. Treating a newly chosen account as a gate is misleading because
that account is not the one the resumed request will use.

Change: fixed. The strengthened scheduled-dispatch test first failed because the old record was not
superseded. A null-account resumable record is now abandoned and replaced; the replacement is due
at once and is planned on the chosen account through the normal scheduler request.

### T5 — P1: the preview reports an absent launch protocol as lost launch history

Evidence: `tools/overseer/schedule-preview.ts:183` derives `sessionHistory` from the synthetic
`history-lost` value returned when `journal` is undefined, and the CLI and web renderers at
`tools/overseer/schedule-preview.ts:622` and `tools/fleet/web/src/SchedulePreview.tsx:453-455`
render that state as `LOST`. In Stage B, `schedulerWiring` deliberately supplies no launch protocol;
the history is unavailable to this process, not known to be damaged.

Consequence: every normal Stage-B daemon raises a red operational alarm claiming that launch
history was lost. The per-job remediation added for T2 then tells the operator to resolve journal
history even though there is no damaged journal to resolve. This obscures a real lost-history
incident and gives the wrong explanation for why session jobs are held.

Change: fixed. The new preview test first failed with `sessionHistory.kind === "lost"`. Schema 2 now
carries a separate `unavailable` arm, the parser accepts it, the CLI and web page render it without
alarm styling, and affected rows are ordinarily `held`. A reader that actually reports a torn
journal still produces `lost` and `history-lost`.

## Gate results

- Requested 22-file Vitest command: exit 1 — 21 files passed; 762 tests passed. The only failure
  was `tests/fleet-occurrences-route.test.ts` before application code, because this sandbox rejects
  `spawnSync mkfifo` with `EPERM`.
- The same route suite excluding only its FIFO construction test: exit 0 — 29 passed, 1 skipped.
- Focused red/green checks: all five defects were observed failing before their fixes. The final
  preview/parser/UI subset passed 95 tests; the projection subset passed 38; the null-account
  scheduled-dispatch case passed.
- `npm run typecheck`: exit 1 before typechecking because `tsx` could not create its IPC socket
  (`listen EPERM /tmp/tsx-1000/14.pipe`). The prescribed fallback
  `node --import tsx scripts/typecheck.ts`: exit 0 — all four projects passed and all 2090 source
  files were covered.
- `npx biome lint` on every changed code/test file: exit 0 — no errors or fixes, 74 informational
  `useLiteralKeys` diagnostics from the existing parser style.
- `git diff --check`: exit 0. `tests/doc-links.test.ts`: exit 0 — 14 tests passed.
- `npm test`: exit 1 before collecting tests because sandbox networking prevented reaching the
  private Postgres lane and Docker discovery (`connect EPERM 127.0.0.1:54362`).

## Review conclusion

No further P0–P2 finding remains in Stage B. I found no sequence that launches two occurrences of
one job concurrently: resumable work is considered before due work, an open launch holds the job,
supersession is terminal before a replacement is planned, and the protocol fold prevents a
previous id entering the new-launch path. Cadence, first-attempt spacing, material re-reading and
digest checks, standing-job authority, fixture restrictions, and the single launcher-adapter path
matched the binding dispositions. I found no defect in the launch-protocol files that Stage B
consumes.

Verdict: **pass after T1–T5 fixes**, with the environment-only gate limitations above.
