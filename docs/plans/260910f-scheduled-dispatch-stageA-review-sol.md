Stage A review complete. I fixed five P1 findings and one P3, all red-first:

- Success could be claimed without the projected usable answer or exactly zero denials.
- Revision siblings could show the older occurrence as “last”.
- The parser accepted classifier-impossible success rows.
- Unreadable occurrence authority returned misleading 404s instead of 503s.
- Duplicate IDs hidden in unreadable jobs escaped detection.
- “Empty” overstated what `usable: false` means.

Full evidence and dispositions: [stageA-review-sol-findings.md](260910f-scheduled-dispatch-stageA-review-sol-findings.md)

Files changed:

- `tools/overseer/occurrence-result.ts`
- `tools/overseer/occurrences-projection.ts`
- `tools/fleet/occurrences-parse.ts`
- `tools/fleet/routes-occurrences.ts`
- `tools/fleet/web/src/ScheduledOccurrences.tsx`
- Five corresponding test files
- The findings document

Gates:

- Requested Vitest command: exit 1 — 215 passed; only the pre-existing FIFO setup failed because the sandbox denied `mkfifo` with `EPERM`.
- Same command excluding only that setup-blocked case: exit 0 — 215 passed, 1 skipped.
- `npm run typecheck`: exit 1 before checking; the sandbox denied the `tsx` IPC socket.
- Equivalent `node --import tsx scripts/typecheck.ts`: exit 0 — all four projects and all 2,022 source files covered.
- Scoped Biome lint: exit 0.
- `git diff --check`: exit 0.

Verdict: ready with fixes, conditional on rerunning the exact Vitest and typecheck commands outside the reviewer sandbox. No wider finding remains open. Nothing was committed.