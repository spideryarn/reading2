No P1 findings.

- P2 — The unknown-state tooltip falsely promised the link would stop despite the documented lost-create race. Fixed with race-aware copy in [messages.ts](/var/tmp/spideryarn-worktrees/bug-private-link-lost-reply/src/messages.ts:4896) and [AddShareLink.tsx](/var/tmp/spideryarn-worktrees/bug-private-link-lost-reply/src/web/AddShareLink.tsx:164).
- P3 — Several tests could pass without sending DELETE. Fixed by asserting the saving state and DELETE call in [add-share-link.test.ts](/var/tmp/spideryarn-worktrees/bug-private-link-lost-reply/tests/add-share-link.test.ts:416), including the publication overlap at line 493.
- P3 — `because: "read"` was not covered for a refused DELETE, and a test comment said only reads leave `unknown`. Fixed in [add-share-link.test.ts](/var/tmp/spideryarn-worktrees/bug-private-link-lost-reply/tests/add-share-link.test.ts:13).

Controller review found no autonomous create, stale-key, late-answer, or reachable `refused { link: null, attempted: "off" }` path. Tooltip cloning adds no layout wrapper; the flex row wraps at phone width; the Warning markup remains valid.

Changed:

- `src/messages.ts`
- `src/web/AddShareLink.tsx`
- `tests/add-share-link.test.ts`
- `tests/add-page-sharing-section.test.tsx`

Checks:

- Focused Vitest: 137 passed.
- Typecheck: passed all projects via the equivalent direct runner; `npm run typecheck` itself hit sandbox-blocked `tsx` IPC.
- Full `npm test`: database lane could not start because database access is unavailable; no database was started or touched.
- Lint: no errors; two advisory complexity notices.

SHIP AFTER MY FIXES