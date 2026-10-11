Found seven issues; all are fixed. No report-only findings remain, and no security-defence file was edited.

- F1 — P1 — A refreshed Bibliography could leave a newly cited work visible in Not cited because the stored answer was fetched only once. The hook now rereads when the Bibliography object changes. Evidence: [useRelatedWork.ts](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/web/useRelatedWork.ts:149), [SourcesMode.tsx](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/web/modes/sources/SourcesMode.tsx:172), [test](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/not-cited-panel.test.tsx:176). FIXED in those files and `docs/project/sources.md`.

- F2 — P1 — Fresh OpenAlex responses could retain 50 works despite requesting 25, while stored JSON was revalidated item-by-item without reapplying the result cap or deduplication. Evidence: [related-work.ts](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/related-work.ts:447), [stored-row validation](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/store/pg-related-work.ts:89), [tests](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/related-work.test.ts:317). FIXED in `src/related-work.ts`, `src/store/pg-related-work.ts`, and tests.

- F3 — P1 — Comma-separated email addresses without spaces left the second address’s domain in the OpenAlex query. Evidence: [scrubber](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/related-work.ts:238), [red-first regression](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/related-work.test.ts:454). FIXED in `src/related-work.ts` and tests.

- F4 — P2 — The abstract key limit was not a true read bound: `Object.entries` eagerly read every value before the loop stopped. Evidence: [bounded loop](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/related-work.ts:384), [red-first regression](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/related-work.test.ts:370). FIXED in `src/related-work.ts` and tests.

- F5 — P2 — `publishedYear` bypassed `plausibleYear`; values outside 1500–2100 could trigger OpenAlex and then fail the database constraint. Evidence: [year validation](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/related-work.ts:309), [constraint](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/drizzle/20261011175129_related_work_searches.sql:13), [test](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/related-work.test.ts:449). FIXED in `src/related-work.ts` and tests.

- F6 — P2 — The empty state claimed every OpenAlex result was in the Bibliography, although OpenAlex may have returned nothing or only the article itself. Evidence: [messages.ts](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/messages.ts:5902), [test](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/tests/not-cited-panel.test.tsx:243). FIXED in `src/messages.ts` and tests.

- F7 — P3 — The Sources explanation still named query recipe `related-work/1`; implementation and storage use `/2`. Evidence: [SourcesMode.tsx](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/web/modes/sources/SourcesMode.tsx:480). FIXED in `src/web/modes/sources/SourcesMode.tsx`.

The exclusion matcher now has explicit Transformer regressions for Sutskever and ByteNet plus the generic-title refusal. Owner filtering, visitor degradation, GET purity, and rate-limit ordering checked out; allowance acquisition occurs before the OpenAlex call at [related-work.ts](/var/tmp/spideryarn-worktrees/qibk9r7kgc-sources-not-cited/src/related-work.ts:761). I also verified that current OpenAlex documentation specifies `per_page`, so that spelling was retained. [OpenAlex paging documentation](https://help.openalex.org/api/paging/)

Checks:

- Focused tests: 75 passed.
- Related UI/URL tests: 330 passed.
- All four TypeScript projects compiled directly. The wrapper command itself cannot open its IPC socket in this sandbox.
- Biome lint and `git diff --check HEAD`: clean.
- PostgreSQL tests were not rerun because this sandbox has no database; the supplied author run remains the evidence.
- No commit made.

verdict LAND AFTER FIXES (all fixed)