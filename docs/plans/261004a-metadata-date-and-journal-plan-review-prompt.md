Review this plan before it is built. Read-only: change nothing.

Plan: docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md
(untracked in this worktree)

Read it, then the code it names: src/bibliographic.ts (WorkRecord, parseCrossref, lookupWork),
src/store/pg-bibliographic.ts and src/db/schema.ts § bibliographicRecords, src/citation-registry.ts
(registryTitleIsDistinctive, titlesDifferByObjectQualifier, registryIdentifiesCitation),
src/pipeline.ts (the `metadata` and `extract` steps, keptPaperMetadata), src/pdf-read.ts (where
`meta` is built, and the `all` records before front matter is hidden), src/extract.ts (where the web
`meta` is built; publicationDate), src/paper-text.ts (citation_doi), src/paper-metadata.ts
(normaliseDoi), src/cited-in-spideryarn.ts (identityOf), src/types.ts § Meta, src/store/artifacts-pg.ts
(metaColumns), src/store/pg.ts (REVISION_PROJECTIONS, metaFrom), src/store/pg-revisions.ts (the
carry table), src/web/Metadata.tsx § facts, src/web/relative-time.ts § calendarDay.

Check, and say plainly where I am wrong:
1. "What is already true": is any claim false? Is there another writer of published_at or doi?
2. The title-agreement rule as the only guard against a cited work's DOI printed on page 1. Is
   "same folded words in the same order" too strict to be useful (subtitles, a trailing full stop,
   maths) or too loose? Is there an existing helper that already does exactly this comparison?
3. Putting the lookup inside the `extract` step: does it break extract's caching, its hash input,
   a retry, the standalone-stage contract, or a test that runs extract offline? Would the suite now
   reach the network anywhere?
4. Every place that must hear about a new Meta field and column `journal` that the plan does not
   list: projections, the carry table, export, snapshot tests, fixture round-trips, minimal-paper
   "Read this" carry-over (keptPaperMetadata).
5. The new `published_day` column on bibliographic_records: does the shape constraint need to name
   it, and is skipping that safe?
6. Does `journal` or the new date reach a visitor or a public projection by any path?
7. Is anything here more than the simplest version that meets the report? Is anything missing that
   would make it report success while doing nothing?

Findings as P0/P1/P2 with an ID each (F1, F2, …) and file:line. Be brief.
