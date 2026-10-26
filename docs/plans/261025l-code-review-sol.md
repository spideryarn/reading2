Found six issues and fixed all of them in the worktree. No commit was made.

### Findings

- **P1 — Private progress reached non-owner server paths.**  
  [routes.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/routes.ts:11524), [pg.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/store/pg.ts:3161)  
  An administrator using view-as received the subject’s `readBand`. MCP and the unauthenticated health check also queried the private progress tables, although MCP subsequently discarded the field. Fixed by adding `ListOptions.readBands`, disabling it for view-as, MCP, and health, and making `shelfReadBands` fail closed during view-as. Added query-level and behavioral tests.

- **P1 — A kept browser shelf could replay private, stale bands.**  
  [cached-shelf.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/lib/cached-shelf.ts:169), [api.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/lib/api.ts:906)  
  New cache writes removed `readBand`, but previously saved bodies retained it on stale-first and offline reads. That could display old progress indefinitely. Fixed by stripping bands at both read boundaries. Both regression tests were observed failing before the fix.

- **P2 — The recipe-version test could remain green after equivalence-breaking changes.**  
  [read-so-far-basis.test.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/tests/read-so-far-basis.test.ts:23)  
  It monitored only two modules, omitting `matter-view`, `read-filter`, block policy, matter-version handling, and author normalization. A change to folding or counted words could therefore serve stale cached denominators as fresh. Fixed by pinning every focused rule module named by the basis contract. The expanded test was observed failing before its expected hashes were recorded.

- **P2 — Some cards rendered two pies.**  
  [ShelfEntry.tsx](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/web/ShelfEntry.tsx:294)  
  The pie was placed by comparing fact text to the minutes string. A byline or site name equal to `"~11 min"` produced an extra pie. Fixed by using the minutes fact’s structural position. Regression test: [shelf-read-so-far.test.tsx](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/tests/shelf-read-so-far.test.tsx:115).

- **P2 — The reading-time failure guarantee lacked a route-level test.**  
  [reading-time-route.test.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/tests/reading-time-route.test.ts:140)  
  The implementation already caught refresh failures correctly, but a future removal or relocation of that catch could lose the 204 guarantee without focused evidence. Added a test that forces `refreshShelfWords` to reject and verifies the seconds remain saved.

- **P3 — Schema documentation pointed to a nonexistent file.**  
  [schema.ts](/var/tmp/spideryarn-worktrees/fbe5477u-shelf-pie/src/db/schema.ts:6032)  
  Corrected the basis reference to `src/store/read-so-far-basis.ts` and updated the affected privacy/library/reading-time documentation.

### Reviewed without further findings

- Shelf and masthead now share the counting, thresholds, bands, and mark. The basis covers every stored input read by `foldedOnArrival`; code-rule changes are guarded by the expanded recipe test.
- `refreshShelfWords` is owner-scoped and its `INSERT … SELECT` guards both insert and conflict-update paths against ownership or basis changes. The POST handler saves seconds first and treats refresh failure as non-fatal.
- The normal shelf performs one batched progress statement regardless of card count; reduced and non-owner paths perform none.
- Public shelf DTO/query, exports, admin article listings, and MCP results do not expose the band or reading seconds.
- `read_so_far_words` is correctly classified as article-derived transfer data, while reading-time rows remain reader state. Both export projections exclude it.
- Migration shape and registry are consistent; `npx drizzle-kit check` passed.
- The approved A→B→A race remains as documented; I found no new wider decision for you.

### Verification

- Requested non-database suites: **64 tests passed**.
- Additional cache, MCP, docs, and privacy suites: **280 tests passed**.
- `npm run typecheck` could not create its `tsx` IPC socket under the sandbox. The identical script run as `node --import tsx scripts/typecheck.ts` passed all projects and confirmed all 4,030 source files are covered.
- `read-so-far-shelf.test.ts`, `store-shelf-reads.test.ts`, and the new route test could not run because the sandbox cannot reach local Postgres or Docker (`EPERM 127.0.0.1:54362`). No production service was contacted.
- `git diff --check` passed.

The two pre-existing untracked review files were left untouched.