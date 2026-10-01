# Probe P08 — before — "preferred summary depth" setting, stored in DB, editable on /profile

## 1. Docs opened, in order
1. `AGENTS.md` (as CLAUDE.md) — signpost; pointed to reader-profile.md via reading-view-overview, but I went straight by guess.
2. `docs/project/reader-profile.md` — helped: says /profile hosts the profile box and the Settings card, and its "Where the pieces are" table names `pg-reader.ts`, `routes.ts`, `SettingsSection.tsx`. Mostly irrelevant (long microphone saga).
3. `docs/project/experimental-features.md` — best doc: "Where it lives" table is a complete recipe for a per-reader column (schema, contract, wire, client store, copy).
4. `docs/project/summaries.md` (grep/sed only) — to learn what "depth" means (the `deep` cut-off); helped a little.
5. `docs/project/database.md`, `docs/project/sql.md` (grep only) — migration commands (`npm run db:generate`, `db:migrate`, never `drizzle-kit push`).

## 2. Code files you would edit
- `src/db/schema.ts` (`readerProfiles`: add nullable column, e.g. `summary_depth smallint`) + new migration under `drizzle/` via `npm run db:generate`
- `src/store/contracts.ts` (`ReaderStore`: `readSummaryDepth` / `writeSummaryDepth`)
- `src/store/pg-reader.ts` (upsert naming only that column)
- `src/routes.ts` (`ReaderState`, `patchReader`, GET `/api/reader` ~line 7554)
- `src/web/SettingsSection.tsx` (or `ProfilePage.tsx`) for the control
- new client store/hook modelled on `src/web/experimental-store.ts` + `src/web/useExperimental.ts`
- `src/web/SummaryPanel.tsx` / wherever `deep` is initialised, if it should seed the default
- tests: `tests/profile-settings.test.tsx`, `tests/store-reader-parity.test.ts`, `tests/routes.test.ts` (extend)

## 3. Existing helpers to reuse
- `src/store/pg-reader.ts` § `writeExperimental` (upsert shape, one column per write)
- `src/routes.ts` § `patchReader`, `objectBody`, `httpError`
- `src/web/experimental-store.ts` § whole store; `src/web/useExperimental.ts`
- `src/web/experimental-copy.ts` pattern for shared copy (new file for depth copy)
- `src/web/Tooltip.tsx` § `ControlTip`, `Tooltip`
- `src/web/ProfilePage.tsx` mounts the Settings card (not opened in detail)
- Would write a new store/hook (a generalised one was not found; docs explicitly say none was built).

## 4. Rules/policies to follow
- Failing test first, then fix (CLAUDE.md).
- Work in a worktree, commit own files by name, push to `dev` (CLAUDE.md).
- `npm test`, `npm run typecheck`, lint on touched files (CLAUDE.md).
- Additive migration is fine to apply locally; read the `Target:` line (CLAUDE.md, database.md).
- Nullable column, nothing to backfill; consider nullable over boolean/default (sql.md).
- `PATCH /api/reader` is one field per request; reply carries all fields (routes.ts header).
- Client says on/off state, three-state loaded/saving handling; no dead ends (experimental-features.md).
- Cross-family GPT Sol review before commit; plan doc in `docs/plans/` (CLAUDE.md).
- Failure copy goes in `src/messages.ts`, setting copy elsewhere (experimental-features.md).
- Doc: add a line to owning entry point (reader-profile.md table) (CLAUDE.md).

## 5. Where you got lost
- Never found a doc that says what "summary depth" means as a user-facing preference; summaries.md describes a `deep` cut-off in the panel, but I could not confirm whether it persists anywhere (url param?) or what values it takes. `src/web/url-state.ts` does not exist where I guessed; url-state.md was not opened.
- Did not find a generic "add a per-reader setting" doc; I inferred the recipe from experimental-features.md.
- The `ReaderStore` doc comments still mention a filesystem adapter that was deleted (stale). Header comment in pg-reader.ts also says src/store/fs.ts is the other half.
- `schema.ts` comment says "revisit at three or four settings" for a separate table; the decision is open.
- Uncertain whether reader.json GET shape consumers (tests/store-reader-parity) require a fs-side change.

## 6. Confidence
6/10
