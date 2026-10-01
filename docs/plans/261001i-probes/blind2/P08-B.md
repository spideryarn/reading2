# P08 after2 — preferred summary depth setting

## 1. Docs opened, in order
- `AGENTS.md` / CLAUDE.md (context) — pointed to reading-view-overview and database docs; working agreements (worktree, test first, Sol review).
- `docs/project/reader-profile.md` — helped a lot; "Where the pieces are" table lists every layer of the per-reader row and points to the experimental switch.
- `docs/project/experimental-features.md` — helped; "Where it lives" traces the exact layers of a per-reader setting (column, ReaderStore pair, GET/PATCH /api/reader, client store).
- Skimmed `docs/project/high-powered-ai.md` (per-article, not relevant) and `docs/project/database.md` (migration rules).

## 2. Code files you would edit
- `src/db/schema.ts` (new nullable column on `readerProfiles`; its comment says revisit a settings table at 3-4 settings)
- `drizzle/<new>.sql` (+ `drizzle/meta`, via drizzle-kit generate)
- `src/store/contracts.ts` (`ReaderStore`: read/write pair)
- `src/store/pg-reader.ts` (implement; each write names one column)
- `src/routes.ts` (`GET`/`PATCH /api/reader`: one field, validated)
- `src/web/SettingsSection.tsx` (control on /profile), plus the client store for /api/reader (`src/web/useProfile.ts` or the experimental store; confirm by grep)
- `docs/project/reader-profile.md` / `experimental-features.md` (record it)
- tests: new test beside `tests/profile.test.ts`, route test for PATCH.

## 3. Existing helpers/components/functions to reuse
- `src/store/pg-reader.ts` § `readExperimental` / `writeExperimental` (copy upsert shape)
- `src/db/schema.ts` § `readerProfiles`
- `src/web/SettingsSection.tsx` (the Settings card)
- `src/routes.ts` § `parseHighPowerRequest` as a model for body validation
- Would define a new enum/union type for depth values; found no existing "summary depth" type yet (granularity-zoom levels may supply one, unchecked).

## 4. Rules/policies
- Work in a worktree; push to `dev` (CLAUDE.md).
- Failing test first, then fix; run `npm test` and `npm run typecheck` (CLAUDE.md).
- Additive migration is fine to apply; read the `Target:` line (CLAUDE.md, database.md).
- Nullable column, null = unset, no backfill (schema.ts comment, sql.md "columns over JSON").
- Let the types catch it: union type, exhaustive switch (CLAUDE.md).
- Never log the value needlessly; reader-state logging rules (logging.md).
- Cross-family GPT Sol review before commit; plan doc under `docs/plans/` (CLAUDE.md).
- Doc updates: new content under existing owner docs, no new rule edits to entry points.

## 5. Where you got lost
- Unclear what "summary depth" means in the product: summaries.md and granularity-zoom.md not opened; I did not verify whether the setting should feed generation or only the view. Would ask Greg.
- Did not find the client store file for /api/reader quickly; reader-profile.md table lists SettingsSection but not the store.
- Count of tool calls was kept small, so route code was not read.

## 6. Confidence
6/10.
