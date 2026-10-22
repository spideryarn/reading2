# GPT Sol plan review, round 2: admin "view as", plan 261019n § Part 3

Read-only. Your round-1 review is docs/plans/261019n-view-as-plan-review-sol-2.md. The plan
(docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md, uncommitted edit) now
ends with "### What GPT Sol's plan review changed (round 1, 2026-10-20)", which amends the design.

1. For each of F1–F8: is the stated fix adequate? Say "closed" or what remains, concretely.
2. The F7 replacement in particular: per-query `BEGIN TRANSACTION READ ONLY … COMMIT` on a
   checked-out client while the view-as marker is set, and `begin` rewritten to
   `begin transaction read only` for a store's own Drizzle transaction. Check against
   drizzle-orm's node-postgres session code in node_modules (how it issues `begin`, whether it
   uses `pool.query` or a checked-out client) and against Supabase's transaction pooler. Can a
   write escape? Is anything broken (SSE handlers holding a client, nested transactions,
   savepoints)?
3. F1's replacement of `window.localStorage`/`window.sessionStorage` with in-memory stores via
   `Object.defineProperty(window, ...)` in boot.tsx before main.js is imported: does it hold in
   Chromium/Firefox/Safari, and does any module capture a storage reference earlier (boot.tsx
   imports monitoring.js statically)?
4. Anything new the amendments introduce.

Severity: P0 = write/spend/leak reachable as designed; P1 = likely bug or missing check; P2 = worth
fixing; P3 = nit. ID every finding (R2-1, R2-2, …) with file:line or plan paragraph and a fix.
Discovery closes after this round, so put the important things first.
