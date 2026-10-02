**No P0/P1 found. Three P2 findings fixed; nothing committed.**

- **F1 — P2:** [Library.tsx:396](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/Library.tsx:396): archived counts stayed stale after archiving at an unchanged query. Added shelf identity to [useLibrarySearch.ts:86](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/useLibrarySearch.ts:86), triggering refresh and immediately suppressing answers from an older snapshot. Reproduced red-first.
- **F2 — P2:** [Library.tsx:261](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/src/web/Library.tsx:261): archiving your own shared article could make the retained public listing count it as someone else’s. Changed `ownSlugs` to include reconciled `archivedVisible` edits. Reproduced red-first.
- **F3 — P2:** [public-shelf-page.test.tsx:367](/home/greg/code/spideryarn2/.claude/worktrees/fb-yy5x66-fcbnhq-shelf-public-phone/tests/public-shelf-page.test.tsx:367): StrictMode overlap tests now issued only one request. Replaced them with explicit overlapping retries and corrected the hook comment in `src/web/PublicLibraryPage.tsx`. Removing generation guards now fails both tests.

Also expanded `tests/shelf-archived-in-the-list.test.tsx`, `tests/shelf-include-public.test.tsx`, and `tests/store-shelf-pg.test.ts` for abort races, query/MIN_QUERY identity, public count qualifications, ownership gates, and archived-count isolation. Added two root-cause write-ups under `docs/postmortems/261002c-…` and `261002d-…`.

Source review confirms:

- `searchLibrary` retains owner scope, current revision, gistable/archive/exclusion rules, ordering, and cap.
- `countArchivedMatches` is owner-scoped, distinct, and uncapped.
- Response shape is correct; no `q` logging path found.
- Public count and section share matching, exclusions, snapshot, and live-owner gate; mount, enabled, and retry behavior hold.

**Validation:** 70 UI tests plus 16 doc-link tests passed. Abort and retry mutation checks failed as intended. Typecheck passed via `node --import tsx scripts/typecheck.ts`; lint has only complexity notices.

**Ready for dev once the two Postgres suites pass.** The requested five-file command was attempted but blocked during database setup by sandbox `EPERM` accessing local Postgres/Docker, so `store-shelf-pg` and `routes` remain unverified here.