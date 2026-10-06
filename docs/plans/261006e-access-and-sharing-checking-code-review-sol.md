**P3 — recovery test did not prove the switch returned.** [metadata-sharing-card.test.tsx:558](/var/tmp/spideryarn-worktrees/qi-kynm6gzc-access-sharing-after-import/tests/metadata-sharing-card.test.tsx:558) omitted `available` and asserted only the private-state sentence. Adding a real-button assertion failed (`expected false to be true`); fixed with `ALL_BUILT` and that assertion. Also strengthened checking, slug-change, late-failure, and `acted` coverage.

No P1/P2 findings. The app’s slug key prevents stale-error renders; `current()` rejects late failures. Retries stop after success or five failed reads. A failed refresh with null provenance uses the remaining budget; existing provenance suppresses retries. Delete/Archive and pipeline rows recover on success; purpose seeds once.

All four original tests failed under relevant mutations. Removing cleanup made the unmount test count **2 reads instead of 1**. All mutations were restored; production code is unchanged.

Left as planned: malformed `sharing` on a 200 and the private link’s separate read.

Validation:

- Requested Vitest command: **2 files passed, 77 tests passed**.
- `npm run typecheck`: blocked by sandbox IPC `listen EPERM`. The same checker via `node --import tsx scripts/typecheck.ts` **passed**, covering all 3,287 source files.
- Scoped lint passed.

**Verdict: approve with the test correction applied.** No commit made.