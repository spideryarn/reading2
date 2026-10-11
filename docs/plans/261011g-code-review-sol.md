1. **P2 — Criteria’s starter latch reset after remounts, deletion, and failed/refused first runs.** The old latch lived inside `CriteriaView`, so changing sub-mode recreated it; a stored refusal draft could also reveal starters before the opening read settled. I moved the latch into the data hook, persisted it per reader/article/tab, and gated display on the completed opening read. Added deletion/remount, transport-failure, ceiling-refusal, loading, and accessibility tests. Evidence: [useCriteria.ts:144](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/web/useCriteria.ts:144), [criterion-refusal-drafts.ts:13](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/web/criterion-refusal-drafts.ts:13), [referee-criteria-starters.test.tsx:183](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/tests/referee-criteria-starters.test.tsx:183).

2. **P2 — The live footnote-digits snapshot query used the removed `claims` column.** It queried `referee_promises` but called `regexp_matches(claims::text, …)`, which would fail immediately. Changed it to `promises` and renamed the matching derived key. Evidence: [snapshot.sql:44](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/evals/footnote-digits/snapshot.sql:44).

3. **P3 — Compatibility-view grants and postconditions were under-specified.** The migration omitted PUBLIC grants and grant options, while its final check proved only row count and constraint names. It now preserves SELECT/INSERT/UPDATE/DELETE grants, including PUBLIC and grant options, and aborts unless the view has the exact old columns, is insertable/updatable, and retains the table’s DML grants. The PG test asserts the same properties. PostgreSQL explicitly supports `ON CONFLICT UPDATE` on simple automatically updatable views. [PostgreSQL documentation](https://www.postgresql.org/docs/current/sql-createview.html). Evidence: [20261011025758_referee_promises.sql:84](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/drizzle/20261011025758_referee_promises.sql:84), [referee-promises-expand-pg.test.ts:102](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/tests/referee-promises-expand-pg.test.ts:102).

4. **P3 — The rename was incomplete in active code/evals/docs, while several historical names were over-renamed.** I renamed current Promises variables, report headings, test harness identifiers, reader copy, and documentation; added compatibility for old eval cache files; and restored historical `src/referee-claims-store.ts` and `CLAIMS_UNUSABLE` names that actually existed. I left Sources’ Claims, raw model `claims`, stored inner `claim`/`claimWithheld`, old URLs, migrations, and frozen results untouched. Evidence: [referee-promises.ts:876](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/evals/referee-promises.ts:876), [pg-referee-promises.ts:1](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/store/pg-referee-promises.ts:1), [contracts.ts:1569](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/store/contracts.ts:1569).

5. **P3 — Starter copy and grouping did not precisely match the behavior or expose group labels programmatically.** The wait copy now says starters appear after pressing Run, the study/sample-size wording is plainer, and each group uses `fieldset`/`legend`. Help and the Referee design doc now describe the latch accurately. Evidence: [CriteriaPanel.tsx:253](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/web/CriteriaPanel.tsx:253), [CriteriaPanel.tsx:830](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/src/web/CriteriaPanel.tsx:830), [referee-mode.md:408](/var/tmp/spideryarn-worktrees/fbh5aypq-referee-promises-starters/docs/project/referee-mode.md:408).

No wire-shape mismatch found: SSE uses `promise`/`{ promise }`; outer storage/export fields use `promises`; inner `claim` keys remain intentionally unchanged; stale `claims` notices and the retired job alias normalize correctly. I did not add the deliberately rejected API route alias.

The PostgreSQL expansion test could not be run or temporarily made red: private-test setup failed before discovery with `EPERM 127.0.0.1:54362`, and Docker was unavailable. Structurally, the test would fail for a missing column because `oldBegin` names all eleven, and for a non-updatable view on its first insert/upsert; the new assertions make those properties explicit.

Checks:

- Equivalent typecheck, `node --import tsx scripts/typecheck.ts`: passed. The exact `npm run typecheck` wrapper hit the sandbox’s `tsx` IPC `EPERM`.
- Relevant unit suites: passed, including 8/8 starter tests and 142/142 Promises/stale-notice tests.
- `tests/doc-links.test.ts`: 18/18 passed.
- `npm run db:chain`: passed.
- Equivalent `db:generate --allow-empty`: no schema changes.
- `git diff --check`: passed.
- Full `npm test`: blocked by unavailable local PostgreSQL.
- One unit batch had 396 passing tests; `parse-json.test.ts` alone failed because its child `tsx` process hit the same IPC restriction.

Files changed:

- `docs/project/loading-spinner.md`, `docs/project/maths.md`, `docs/project/referee-mode.md`, `docs/project/search.md`
- `drizzle/20261011025758_referee_promises.sql`
- `evals/footnote-digits/measure.ts`, `evals/footnote-digits/snapshot.sql`, `evals/referee-promises.ts`
- `src/help-corpus.generated.json`, `src/messages.ts`, `src/referee-promises-run.ts`
- `src/store/article-rows.ts`, `src/store/contracts.ts`, `src/store/export-bundle.ts`, `src/store/export.ts`, `src/store/pg-referee-promises.ts`
- `src/web/CriteriaPanel.tsx`, `src/web/FeaturesPage.tsx`, `src/web/PromisesPanel.tsx`, `src/web/criterion-refusal-drafts.ts`, `src/web/referee-views.ts`, `src/web/styles/referee.css`, `src/web/useCriteria.ts`
- `src/web/help/pages/guides/for-reviewers.md`, `src/web/help/pages/modes/referee.md`
- `tests/block-link-migration.test.tsx`, `tests/overflow-message-reaches-its-caller.test.ts`, `tests/parse-json.test.ts`, `tests/passage-mode-cleanup.test.tsx`, `tests/read-error-matrix.test.tsx`
- `tests/referee-copy-is-about-the-model.test.ts`, `tests/referee-criteria-starters.test.tsx`, `tests/referee-promises-accounting.test.ts`, `tests/referee-promises-band.test.tsx`, `tests/referee-promises-expand-pg.test.ts`, `tests/referee-promises-no-room-log.test.ts`, `tests/referee-promises-panel.test.tsx`, `tests/referee-promises-resolve.test.tsx`, `tests/referee-promises-routes.test.ts`, `tests/referee-promises-run.test.ts`, `tests/referee-promises.test.ts`
- `tests/referee-routes-postgres.test.ts`, `tests/referee-stream-lifetime.test.ts`, `tests/referee-tooltips.test.tsx`
- `tests/store-artefact-manifest.test.ts`, `tests/store-migration-registry.ts`, `tests/store-parity-referee.test.ts`, `tests/store-pg-referee-promises.test.ts`
- `tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx`, `tests/type-roles.test.ts`

**LAND AFTER FIXES**