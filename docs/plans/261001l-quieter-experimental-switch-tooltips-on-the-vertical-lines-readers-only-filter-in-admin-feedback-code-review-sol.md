1. **P2 — Superseded feedback requests survived keyed remounts.** The remount prevented stale rendering, but the old request continued consuming its connection/body. Added abort-aware request ownership and StrictMode-safe cleanup in [useAdminFeedback.ts:63](/home/greg/code/spideryarn2/.claude/worktrees/fb80-84-87-quiet-switch-line-tooltips-admin-filter/src/web/useAdminFeedback.ts:63). Added tests proving remount abortion, stale-response rejection, and StrictMode replacement-request behavior in [admin-feedback-from.test.tsx:143](/home/greg/code/spideryarn2/.claude/worktrees/fb80-84-87-quiet-switch-line-tooltips-admin-filter/tests/admin-feedback-from.test.tsx:143).

2. **P2 — The route test could pass if `from=readers` silently became “everyone.”** It previously checked only status and response shape. It now spies on the store boundary and proves the exact filter reaches the store, malformed values never perform a read, and non-admins remain blocked in [routes.test.ts:2360](/home/greg/code/spideryarn2/.claude/worktrees/fb80-84-87-quiet-switch-line-tooltips-admin-filter/tests/routes.test.ts:2360).

3. **P2 — Stale documentation claimed the feedback inbox had no pagination.** Updated the limit comment to describe the current keyset paging contract in [types.ts:6053](/home/greg/code/spideryarn2/.claude/worktrees/fb80-84-87-quiet-switch-line-tooltips-admin-filter/src/types.ts:6053).

No further findings: the admin namespace gate is unchanged; `NOT IN` is correctly combined with the complete keyset predicate; the reading-time change only moves the pseudo-element inside its existing strip; the application is deliberately dark-only and the switch inherits suitable normal/hover/disabled colours; URL-state rules cover article/shelf views, not this admin preference; and the eager-client graph tests remain green.

Checks:

- Focused unit/static tests: **81 passed**
- Equivalent direct typecheck: **4 projects and all 2,547 source files passed**
- Biome lint on edited files: passed
- `git diff --check`: passed
- `npm run typecheck` wrapper could not open its sandbox-blocked `tsx` IPC socket; running the same script via `node --import tsx` passed
- `admin-feedback-store.test.ts` and `routes.test.ts` could not start because the sandbox refused localhost PostgreSQL with `EPERM`

Files edited:

- `src/types.ts`
- `src/web/useAdminFeedback.ts`
- `tests/admin-feedback-from.test.tsx`
- `tests/routes.test.ts`

Verdict: **Conditional pass — no unresolved code findings, with the two PostgreSQL-backed tests still needing a run outside this localhost-restricted sandbox.**