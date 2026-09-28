## Finding

- **F8 — P1, fixed:** two resets with different regeneration choices could queue together. Reset A’s successors would be created behind reset B, then run after B and recreate extras B asked to leave absent. The fix makes resets single-flight per article, returns 409 for a conflicting active reset, and timestamps newly inserted resets with the database clock after any article-lock wait. Changes are in [jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/jobs.ts:3028), [store/jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/jobs.ts:81), and [pg-jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/src/store/pg-jobs.ts:589). Regression coverage is in [reset-and-regenerate.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/tests/reset-and-regenerate.test.ts:613) and [reset-work-key.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/metadata-reset-regenerate/tests/reset-work-key.test.ts:1). The unit regression failed before the fix and passes afterward.

The focused checks otherwise hold:

- F1’s reset-scoped successor key prevents both queued and `boundToOlderBase` jobs from absorbing regeneration.
- F6’s `now() + i µs` ordering is sound for `sketch → illustrated`: claim compares the database’s full-resolution `(created_at, id)` tuples directly. Other transactions can interleave work, but cannot invert those two successors.
- Reset draft creation removes only revision extras and their run receipts. Reader-owned rows remain untouched, with the documented block-remint caveats.
- Retries mint from the current revision and drop extras again; reopened drafts do not copy them back.
- No billing slot is attached to the reset or successors.
- Non-reset work keys are unchanged; labels callers omit all new options; `fenceJob`’s `returning` preserves its exact-one-row fence semantics.
- The route is authenticated and owner-scoped. Neither its response nor `publicJob` exposes the nested profile snapshot.

Verification:

- Typecheck: passed, all four projects and all 2,232 source files.
- Unit tests: 343 passed.
- Build: passed.
- `git diff --check`: clean.
- Postgres tests could not run in the sandbox. Please run:

```bash
npx vitest run tests/reset-and-regenerate.test.ts tests/jobs.test.ts tests/reset-route.test.ts
```

No commit was made. Concurrent stage-2 UI changes in the shared worktree were left untouched.

**Verdict: accept after the new Postgres regressions pass; no remaining P0/P1 finding.**