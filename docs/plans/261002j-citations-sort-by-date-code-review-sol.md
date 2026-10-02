1. **No P0–P3 findings.** The sorting, fallback, owner/visitor behavior, URL parsing, and documentation are consistent with the plan. The new tests contain non-circular assertions and could fail under relevant regressions. No files changed.

Checks:

- `npx vitest run tests/citations-panel.test.tsx` — **passed, 80/80**
- `npm run typecheck` — wrapper could not open its IPC socket in the sandbox (`EPERM`)
- Equivalent `node --import tsx scripts/typecheck.ts` — **passed all four projects; all 2,754 source files covered**
- Wider issues requiring a decision: **none**

Yes: the change does what the report asked. Citations mode now has a `date` publication-date sort, oldest first, with undated works last.