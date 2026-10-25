Review and fix code, in this worktree (Spideryarn). You may edit files to fix what you find, inside
this change's scope; report anything wider instead of doing it. Do not commit, push, deploy, or run
anything against a remote database. Do not run evals that spend money.

The change: a cited work's one-search web note may now come from a page that only looks like the
work's own. Read, in order:

1. docs/plans/261025d-citation-web-note-looser-page-rule.md — the plan, and its § "The plan review,
   and what it changed", which overrides the body where they disagree (notably: the column is
   `page_kind`, nullable on a note with null reading as `own`, and no backfill).
2. docs/investigations/261025d-citation-web-note-looser-rule-yield.md — the measurement.
3. The diff: `git diff HEAD~1 -- src tests drizzle evals docs/project` (the change is the last
   commit on this branch; `git show --stat HEAD` lists it).

The files that matter most: src/citation-web-note.ts (`pageLooksLikeTheWork`, `namesAnotherWork`,
`identify`, `searchableByTitle`, `readWebNote`, `WEB_NOTE_SYSTEM`), src/citation-web-note-shown.ts
(`shownWebNote`, `belongsTo`, `couldBeOwn`, `searchedRecently`, the versions),
src/citation-lookup.ts (the `titleNamesWork` "Reviews" tail change — it is shared with other
callers), src/citation-blurbs.ts (`alsoFalse`, `WEB_LOOKALIKE_EVIDENCE`; the abstract notes' check
prompt must stay byte for byte), src/store/citation-web-note-row.ts, src/db/schema.ts and
drizzle/20261025113744_citation_web_notes_page_kind.sql (+ its snapshot), src/store/export.ts,
src/citation-blurb-words.ts, src/messages.ts, src/web/PrivacyPage.tsx, the Sources help page,
and the tests in tests/citation-web-note.test.ts, tests/citation-web-notes-pg.test.ts,
tests/bibliography-panel.test.tsx, tests/privacy-page.test.ts.

Look hardest for:
- a page kind that can be stored or shown wrongly (a `looks-like` page labelled `own`, or `own`
  shown at an address that could not be one); a stored /3 *none* still trusted; a /3 note hidden;
- a title-only search that can happen where it must not (an uploaded file's article — G6 — a row
  with no author, an unpublished work, a conflicting identifier), or spend before the free refusals;
- host matching that refuses or admits the wrong host (subdomains, trailing dots, case, ports,
  Amazon's country domains);
- the migration: does it apply on a database that already holds notes and nones, and can the
  previously deployed writer (which names no `page_kind`) still insert under the new CHECK?
- any reader-facing sentence that claims more than code checked;
- tests that would pass whatever the code did.

Run `npm run typecheck` and `npx vitest run tests/citation-web-note.test.ts
tests/citation-web-notes-pg.test.ts tests/bibliography-panel.test.tsx tests/privacy-page.test.ts
tests/citation-lookup.test.ts` after any fix. Then answer: each finding with severity (P0–P3),
file:line, what is wrong, and whether you fixed it (and how) or are reporting it; then a one-line
verdict.
