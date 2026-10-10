LAND AFTER FIXES

- **C1 — P2 — Fixed:** The active plain-words eval still used generator `citations` and fingerprinted removed `src/citations.ts`, so every generation failed before making a model call. Renamed it to Bibliography and added compatibility for historical `citations.json` results in [artefacts.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/plain-words/artefacts.ts:123), [stored-result.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/stored-result.ts:14), and red-first tests in [stored-eval-results.test.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/tests/stored-eval-results.test.ts:34).

- **C2 — P2 — Fixed:** The executable footnote census still depended on compatibility-only `citations` database names and would break after the contract migration. Updated its column, step, result section, and consumer alias in [snapshot.sql](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/evals/footnote-digits/snapshot.sql:6) and `census.mjs`.

- **C3 — P2 — Fixed:** Whole `Bibliography` artifacts still appeared as `citations` in active APIs and variables. Most notably, `attachCitationRegistry` returned `{ citations: Bibliography }`, producing `run.bibliography = registered.citations`. It now returns `{ bibliography }` in [citation-registry.ts](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/src/citation-registry.ts:214), with its pipeline caller and production/test/eval variables updated. Intentionally preserved `Bibliography.citations`, web/comment citations, marginalia’s `CitedWork[]`, help aliases, prompt tags, and persisted `article_citations`.

- **C4 — P3 — Fixed:** Authoritative docs still described the removed `RENAMED` table and many current comments/docs called Bibliography “Citations.” The ledger rule now consistently points to `currentLedgerName` in [mode.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/mode.md:647), [cost-tracking.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/cost-tracking.md:123), and [admin-costs.md](/var/tmp/spideryarn-worktrees/fbc2qmbg-sources-rename/docs/project/admin-costs.md:71). Current Bibliography, export, origin, mode-checklist, and source comments were corrected while historical wording and Greg’s quotes were preserved.

The migration attack found no defect:

- Old/new column writes, inserts, `COPY`, and `INSERT … SELECT` fire the mirror trigger correctly; new draft carry-forward copies `bibliography`, and the insert trigger fills legacy `citations`.
- Step-run replacement is atomic, violates no referencing FK, and preserves all row fields and checks.
- A simultaneous old/new cross-spelling lease can deadlock, but one complete transaction aborts; SQLSTATE class 40 is explicitly retryable. The normal live-job lock prevents that race in ordinary execution.
- The postcondition can fail meaningfully: before new code exists, old-name rows are the only possible starting population; it checks each has a new twin and checks every revision column pair for inequality.
- Old route envelopes, none-yet headers, job names, origins, and public payload keys remain compatible for the deploy window.

Verification:

- Latest affected test subset: **106 passed**.
- Earlier broader affected subset: **364 passed**.
- Supplied PostgreSQL evidence: **6 files, 175 tests passed**.
- Typecheck: all four projects passed; all **3,621** source files covered.
- `git diff --check`: passed.
- Full `npm test` cannot start here without Postgres; the complete unit project also hits sandbox IPC restrictions in its CLI-wrapper suites. Scoped tests and the supplied database transcript cover this stage.
- No commit made.