# Stage 2 code review — GPT Sol

Reviewed the live candidate based at `87002cb7a292f4c75394f54168a58d530a4edbbf`. The documented
wrapper failed before model startup under both review and workspace-write profiles, so the same
GPT Sol model was dispatched directly as a findings-only subagent. It changed no files.

## Findings

- **F1 — P1, established.** Timed-out probe diagnostics always said the child was alive when the
  caller stopped waiting, contradicting `exitObserved: true` and making an unsupported claim when
  `pid` was null. Use neutral elapsed-time and pid facts; test both arms.
- **F2 — P1, established.** The equivalence fake selected async fixtures by command name only, so
  changing async `free` from `-b` to no arguments still passed. Record and assert every async key,
  command and argv tuple beside the sync tuples.
- **F3 — P2, established.** The server source guard proved the persistent owner and collector were
  declared but not that `refreshOnce` received that `refreshHealth`. Pin the dependency object too.
- **F4 — P3, established.** A comment said the vmstat deadline was three seconds while the constant
  was ten. Corrected while the review was in flight.

The reviewer ran `npx vitest run tests/fleet-health.test.ts`: 38/38 passed. No files were modified.

## Disposition

All four findings were fixed. F1, F2 and F3 were each mutation-verified red before the restored
implementation passed; F4 was a direct comment correction. After the fixes, the requested gate
passed 98/98 and `node --import tsx scripts/typecheck.ts` passed all four TypeScript projects.

The narrow second pass checked the final F1 and F2 code as unreviewed work and marked both closed.
It reran `tests/fleet-health.test.ts` at 40/40 and changed no files.
