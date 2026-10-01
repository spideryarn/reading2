I found and fixed three issues; no P0s.

1. **P1 — “Read this” could reserve without a live minimal charge.**  
   [pg-billing.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/store/pg-billing.ts:1164) now requires exactly one charged, unsuperseded minimal row belonging to that owner and article. No row returns `not-found`; multiple rows fail closed. The credit remains 2 only when that row is in-window. Tests cover absent and already-consumed credit at [billing-minimal.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/billing-minimal.test.ts:418).

2. **P1 — a retried minimal job lost the atomic `inLock` claim seam.**  
   [admission.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/src/billing/admission.ts:420) now accepts `minimalInLock` and forwards it into the fresh minimal reservation transaction. The regression test verifies the callback can see that reservation within the transaction at [billing-minimal.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/billing-minimal.test.ts:540).

3. **P2 — deleted papers could satisfy the same-article trigger through `NULL = NULL`.**  
   Two unrelated deleted papers both lose `article_id`; the trigger previously accepted them as matching. The migration now refuses any new supersession after unlink while preserving an existing valid stamp through deletion: [migration SQL](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/drizzle/20261001182129_ingest_events_minimal.sql:33). Added a cross-deleted-paper regression at [db-schema.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/tests/db-schema.test.ts:535) and corrected [billing.md](/home/greg/code/spideryarn2/.claude/worktrees/bulk-import-minimal/docs/project/billing.md:879).

The remaining audit was clean: point predicates and wall consumers agree, `usageSql` applies period bounds correctly, unsettled reservations are fully counted, lock ordering serializes admissions/share changes, and the migration chain and snapshots are consistent.

Tests:

- 99 database-free billing/admin/message tests passed.
- Four arithmetic mutations were killed: old ingest predicate, missing upgrade credit, strict minimal boundary, and incorrect public-price budget conversion.
- `npx drizzle-kit check`: passed.
- Scoped Biome lint and `git diff --check`: passed.
- The requested Postgres suite could not start because the sandbox denied loopback/Docker access (`EPERM 127.0.0.1:54362`); no database-backed tests ran.
- `npm run typecheck` hit the documented tsx IPC restriction. The fallback ran fully but the tree remains red on unrelated concurrent changes: missing `abstract`/`doi` policies in `pg-revisions.ts:149` and `pg.ts:548`, plus the existing overload error in `chat-empty-reads-from-the-top.test.tsx:126`. No scoped-file diagnostics were reported.

Wider work left intentionally unfixed: Stage 3 must charge the upgrade and require exactly one `supersedeMinimal` result in the same publication transaction. Omitting that produces the fail-safe 1.01 charge. Stage 1 files were untouched; no commit or index-changing command was run.

**Verdict: Stage 2 is review-ready after these fixes, conditional on rerunning the private-Postgres suite outside this sandbox.**