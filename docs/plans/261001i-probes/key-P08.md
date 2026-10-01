# Answer key P08: a per-reader "preferred summary depth", stored, editable on /profile

Nearest landed work: `260930f-high-powered-ai-per-article.md` (a nullable column, a strict route,
a server-controlled checkbox) and `260930j-quiz-questions-shaped-by-the-readers-reading-goal.md`
(what the reader's profile already carries). The closest *per-reader* precedent is the
experimental switch: `spideryarn.reader_profiles.experimental_since`, `PATCH /api/reader`, the row
in `src/web/SettingsSection.tsx`.

**First, what "summary depth" means.** Two axes are called depth today: the outline's `?deep=`
(Parts / Sections, free) and Simple's level (Brief / Simple / Fuller, paid, as `?summary=` values - `SummaryView`, `isPlainLevel` in `src/web/params.ts`).
`docs/project/summaries.md` § "Why there is no Length control" records Greg retiring a second axis
once. The ideal agent asks which one, explained plainly, and whether it is a default or a profile
input to the prompt (the profile already shapes all three Simple levels).

## 1. Docs it must read
- MUST `docs/project/experimental-features.md` § "Where it lives" (column, contract, wire, client store, three client states, one field per `PATCH`) - the template for a reader setting.
- MUST `docs/project/sql.md` § "Columns, not JSON" and § "A nullable timestamp says more than a boolean" (here a nullable enum-ish `text` with a `check`, null = no preference).
- MUST `docs/project/database.md` (§ `npm run db:migrate`, never `drizzle-kit push`; § "Two worktrees generated at once"; § "`DATABASE_URL=… npm run db:migrate` does not do what it looks like" - read the `Target:` line).
- MUST `docs/project/summaries.md` § "The URL", § "Three levels, one row, shaped by the reader", § "Why there is no Length control".
- MUST `docs/project/reader-profile.md` § "Two boxes, one string", § "Where the pieces are" - so the setting does not become a third box.
- MUST `docs/project/url-state.md` § "Reopening an article where you left it" - precedence against an explicit URL and `last-view`.
- USEFUL `docs/project/privacy.md` (stored reader data is listed), `docs/project/export.md` (`reader_profiles` is outside the export), `docs/project/security-map.md`.

## 2. Existing code to reuse
- `src/db/schema.ts` § `readerProfiles` - add the column here; its comment says "Revisit at three or four settings", so no settings table. Trap: a new `reader_settings` table, or JSON in `profile`.
- `src/store/contracts.ts` § `ReaderStore` (`readExperimental`/`writeExperimental` shape) and `src/store/pg-reader.ts` (upsert on `owner_id`). Trap: raw SQL in the route.
- `src/routes.ts` § `READER_PATH` - `GET`/`PATCH /api/reader`; one field per `PATCH`, strict parsing (a body naming two fields is a 400). Trap: a new `/api/reader/settings` route.
- `src/web/experimental-store.ts` + `src/web/useExperimental.ts` - the session-bound store with unread/saving/stale states. Trap: a `useState` + `fetch` in the page that lets a press write a value nobody chose.
- `src/web/SettingsSection.tsx` (the row on `/profile`), `src/web/ProfilePage.tsx`.
- `src/web/params.ts` (`deep`, `summary` and the Simple level), `src/web/last-view.ts`, `src/web/SimplePanel.tsx`, `src/web/useSimple.ts`, `src/web/modes/summary/SummaryMode.tsx` - where the default is applied.

## 3. Code files it would edit
`src/db/schema.ts`; a generated `drizzle/<timestamp>_….sql`; `src/store/contracts.ts`, `src/store/pg-reader.ts`; `src/routes.ts`; a client store/hook beside `experimental-store.ts`; `src/web/SettingsSection.tsx`; `src/web/modes/summary/SummaryMode.tsx` / `src/web/params.ts`; tests incl. `tests/authenticated-api-route-contract.test.ts`; `docs/project/summaries.md`, `docs/project/reader-profile.md` or a short new doc with one parent.

## 4. Project rules that apply
- Ask Greg which depth, and simpler-first: a `localStorage` default needs no schema (`CLAUDE.md` § Simplest version first; `url-state.md` precedent). He asked for the database, so say what that costs.
- Additive migration: generate with `npm run db:generate`, apply locally, say what ran; nothing destructive on the remote without Greg (`CLAUDE.md` § Real data belongs to the reader; `docs/project/database.md`).
- Failing test first: route 400 on two fields / bad value, store round-trip on Postgres, the control's states (`CLAUDE.md`; `docs/project/testing.md`).
- Plan + GPT Sol reviews; `npm test`, `npm run typecheck`, `npm run check`; browser check in a Sonnet subagent.

## 5. Traps (from the landed plans)
- The shared local database may hold another worktree's unmerged migration, so `db:migrate` refuses; 260930f wrote `ADD COLUMN IF NOT EXISTS` and applied the SQL locally only (260930f § What landed, Stage 2).
- The control is controlled by the server's last answer, never by the click; disabled until loaded and while saving; a lost reply re-reads (260930f § Stage 3; `experimental-features.md`).
- A response missing the field is an error, not "default" (`experimental-features.md` § Where it lives).
- The Simple door rule: arriving at a level reads what is stored and spends nothing; a stored default of Fuller must not start a paid job on open (`summaries.md`; `useAutoRun`).
- An explicit `?summary=`/`?deep=` and a restored last view must win over the stored default.
- The profile is frozen per job and not in the stamp, so a preference change makes nothing stale (260930j § What is already there; `reader-profile.md` § One profile per job).
