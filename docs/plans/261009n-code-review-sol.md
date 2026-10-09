1. **MEDIUM — [src/store/artifacts-pg.ts:1451](/var/tmp/spideryarn-worktrees/bug-pdf-quality-not-stored/src/store/artifacts-pg.ts:1451)** — A standalone administrator `metadata` run still writes through `metaColumns`, clearing extraction-owned PDF provenance including `quality`. This wider pre-existing design issue is documented in the plan. **Not fixed; requires the broader step-aware writer decision.**

2. **LOW — [tests/meta-from-columns.test.ts:55](/var/tmp/spideryarn-worktrees/bug-pdf-quality-not-stored/tests/meta-from-columns.test.ts:55)** — `"surfaced" | string` collapsed to `string`; misspelling `"surfaced"` would silently exclude a field from the assertion. **Fixed** with a distinct `{ elsewhere: string }` alternative.

3. **LOW — [src/store/public-reader.ts:316](/var/tmp/spideryarn-worktrees/bug-pdf-quality-not-stored/src/store/public-reader.ts:316)** — The projection comment still said six PDF provenance columns after adding the seventh. **Fixed.**

No other missing mapping found. The migration is additive and safe for existing rows; its CHECK correctly permits `NULL` while rejecting empty arrays and null elements. Snapshot comparison showed only the new column and constraint. The class checks bind: temporary probes confirmed a new `Meta` field breaks both fixtures, and a new `META_COLUMNS` entry breaks `MetaRow`.

Files changed:

- `src/store/public-reader.ts`
- `tests/meta-from-columns.test.ts`

Commands and results:

- `npx vitest run ...` for all eight focused suites — database suites could not start because local Supabase/Docker access was blocked with `EPERM`; no tests executed in that attempt.
- Database-free focused Vitest run — **5 files, 190 tests passed**.
- `npm run typecheck` — npm’s `tsx` wrapper was blocked creating its IPC socket.
- `node --import tsx scripts/typecheck.ts` — **passed all four projects; all 3,587 source files covered**.
- Adversarial targeted TypeScript probes — failed at the expected exhaustive fixtures; probes removed.
- Biome lint on both changed files — **passed**.
- `git diff --check` — **passed**.

**APPROVE WITH CHANGES**