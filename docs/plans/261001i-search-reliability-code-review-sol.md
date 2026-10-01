Verdict: approve with fixes. No unresolved correctness finding remains in the scoped diff, though the Postgres test still needs running in a database-capable environment.

Findings

- **P1 — Fixed:** an old article’s stream survived a slug change and could write its renamed row into the new article’s state/URL. The registry snapshot also remained stale even though its underlying ref was cleared. Reproduced red, then added an article-generation token and registry invalidation at [useSearch.ts:245](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/src/web/useSearch.ts:245) and [useSearch.ts:453](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/src/web/useSearch.ts:453).

- **P2 — Fixed:** `searching.delete` was not actually in an outer `finally`. An exception from `sse(res)` after registration could permanently pin the key. The lifetime now covers everything after `searching.add`, while remaining protected through `finish`, at [routes.ts:4189](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/src/routes.ts:4189).

- **P2 — Fixed:** clearing `inFlight.current` on a slug change did not refresh the memoized `running` set. The hook could simultaneously report `running.size === 1` and `isRunning() === false`. Cleanup now bumps the snapshot version at [useSearch.ts:251](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/src/web/useSearch.ts:251).

- **P3 — Fixed:** `recolourLater.current` was assigned during render. During an article transition, an old stream could observe the new slug’s recolour closure. `recolour` is now declared before `send` and captured directly at [useSearch.ts:382](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/src/web/useSearch.ts:382).

- **P3 — Fixed:** the duplicate and URL assertions were still fail-fast in one test, contrary to the plan-review response. The duplicate assertion is now soft, and explicit tests cover delayed unticking, silent renamed-delete completion, and late frames after a slug change.

Review conclusions

- The `owner` fencing is sound: a late `finally` only removes the entry it owns.
- The tombstone-first return is correct. Both `done` and silent-end paths now have explicit coverage.
- StrictMode’s setup/cleanup/setup does not start requests or duplicate entries; cleanup is idempotent.
- The SQL trim is safe under `READ COMMITTED`. A row seen pending is omitted from `past`; if it finishes afterward, it survives until the next begin. The repeated `status <> 'pending'` predicate protects a selected row that is concurrently reset to pending.
- The plan’s soft-bound description and [search.md](/home/greg/code/spideryarn2/.claude/worktrees/fu-search-reliability/docs/project/search.md:491) are accurate.
- The remaining wider item is the explicitly deferred `useCriteria.ts` duplicate-guard equivalent. Other streaming hooks may also deserve a separate audit for late frames after slug changes.

Verification

- Unit-focused suites: **37 passed**.
- All four TypeScript projects: direct `tsc --noEmit` passed.
- Lint: passed with existing complexity advisories.
- `git diff --check`: passed.
- The requested four-suite command could not initialize the Postgres project: sandbox access to `127.0.0.1:54362` failed with `EPERM`.
- `npm run typecheck` itself was blocked by the sandbox denying `tsx`’s IPC pipe; the underlying four compiler runs passed.
- No commit was made. Existing feedback-doc changes and the untracked review prompt/diff were left untouched.