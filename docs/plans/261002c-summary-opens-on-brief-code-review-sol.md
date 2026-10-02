No P0 findings.

- **P1 — fixed:** Two tests still encoded Simple as the default, causing two full-suite failures:
  - [public-network-trace.test.tsx:1137](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/public-network-trace.test.tsx:1137)
  - [every-mode-draws-its-surface.test.tsx:1459](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/tests/every-mode-draws-its-surface.test.tsx:1459)  
  Both now expect Brief.

- **P2 — fixed:** The new documentation said every chosen level is written into the URL and only the first opening uses Brief. Brief is actually represented by an absent parameter, and explicit links override remembered state. Corrected in [summaries.md:195](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/docs/project/summaries.md:195), [params.ts:1133](/home/greg/code/spideryarn2/.claude/worktrees/fb8n-summary-opens-on-brief/src/web/params.ts:1133), the feedback note, and the test comment.

The nuqs test is sound: it mounts the real `VisitorSummaryBand` under `NuqsAdapter`, begins at explicit Simple, clicks the real Brief-end control, and verifies both rendering and URL removal. Its root reassignment makes the manual unmount/remount compatible with `afterEach`.

Checks:

- Requested 3 files: 73 tests passed.
- Repaired integration files: 141 tests passed.
- Typecheck passed via `node --import tsx scripts/typecheck.ts`; the requested wrapper itself hit a sandbox-only `tsx` IPC `EPERM`.
- `npm test` could not start because local Postgres was unavailable.
- Scoped lint passed with one pre-existing complexity advisory.

**Verdict: Ready after fixes; no remaining live Simple-as-default assumptions found.**