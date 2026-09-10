Stage B passes after five fixes. Full findings are in [the review record](260910f-scheduled-dispatch-stageB-review-sol-findings.md).

Findings fixed:

- T1 P1 — bumped the breaking schedule-preview format to schema 2.
- T2 P1 — launch-journal loss no longer recommends the rules-ledger recovery command.
- T3 P2 — the occurrences projection now uses the scheduler’s canonical newest comparator.
- T4 P1 — null-account scheduled records are abandoned and safely replaced, never resumed through interactive `tmux`.
- T5 P1 — an unavailable launch protocol is distinguished from genuinely lost journal history.

All behavioral fixes were red first. I found no remaining duplicate-launch sequence, stranding path, authority escape, material-pin defect, second launcher path, or launch-protocol defect.

Changed files:

- Fleet: `schedule-parse.ts`, `wire.ts`, `SchedulePreview.tsx`
- Overseer: `launch-occurrences.ts`, `occurrences-projection.ts`, `schedule-plan.ts`, `schedule-preview.ts`
- Six associated test files
- The findings document above

Gates:

- Requested 22-file suite: exit 1 solely because sandboxed `mkfifo` returned `EPERM`; 21 files and 762 tests passed.
- Affected route suite excluding that FIFO construction test: exit 0, 29 passed.
- Typecheck fallback: exit 0, all 2,090 source files covered. Ordinary command was blocked by `tsx` IPC `EPERM`.
- Lint: exit 0, informational diagnostics only.
- Doc links: exit 0, 14 passed.
- `git diff --check`: exit 0.
- Full `npm test`: could not collect because sandbox networking could not reach Postgres/Docker.

No commit was made. The concurrently modified main plan document was left untouched.