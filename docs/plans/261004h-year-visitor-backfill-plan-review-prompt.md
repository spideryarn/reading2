# Review: a plan, before it is built. Read-only: change nothing.

Repo: this worktree, branch worktree-paper-year-visitor-backfill. TypeScript, ESM, Postgres.

## The candidate

Live pre-commit: base is HEAD; one untracked file:
docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md

It follows docs/plans/261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md,
which is built and deployed. Read both.

## What it is meant to do

Three decisions by the product owner: (1) store a year when a registry states no whole day, show
"Published 2011", and decide where such a paper sorts on the Shelf; (2) show the journal and the
publication date to a visitor of a shared article, which widens the public allowlist by those facts
and no others; (3) a backfill script for existing production articles whose default is a dry run,
and whose apply writes exactly what the dry run listed.

Code to read: src/article-registry.ts, src/bibliographic.ts (WorkRecord, parseCrossref,
parseDatacite, askService, lookupWork), src/pipeline.ts (keptPaperMetadata, withArticleRegistry, the
extract and metadata steps), src/types.ts § Meta and LibraryEntry, src/db/schema.ts §
articleRevisions, src/store/pg.ts (the projections, metaFrom, the read policy near line 700),
src/store/artifacts-pg.ts, src/store/pg-revisions.ts, src/library-scalars.ts,
src/web/relative-time.ts § calendarDay, src/web/library-columns.tsx, src/web/Metadata.tsx § facts,
src/public-types.ts § PublicMeta, src/public/dto.ts § publicMeta, src/store/public-reader.ts,
src/web/PublicPages.tsx § PublicMetadataPage, src/web/shared-inventory.ts,
tests/public-dto.test.ts, tests/shared-inventory.test.ts, tests/public-imports.test.ts,
tests/owner-isolation.test.ts, docs/project/security-map.md, src/paper-text.ts and
src/paper-metadata.ts (how a PDF's text layer is read without a model), src/source-hash.ts §
datedArticleFingerprint, scripts/db-migrate.ts (how a script prints its Target: line and picks a
database), docs/project/database.md.

## Independent pass first

Attack the plan. Then answer these, saying plainly where it is wrong:

1. "What is already true": is any claim false?
2. Every place that must hear about `published_year` / `Meta.publishedYear` /
   `LibraryEntry.publishedYear` that the plan does not list.
3. The visitor fields: does any guard test (public-dto, shared-inventory, public-imports,
   owner-isolation, the network trace) need a decision the plan does not name? Does sending the
   day rather than the stored string leak anything, or break a reader? Can `doi` or anything else
   ride along by the path the plan describes?
4. The sort decision: is "start of its year, as a sort key only" coherent with numberOrMissing and
   the chip's wording? Any reader of LibraryEntry.publishedAt that would now disagree with the
   column?
5. The backfill: is reading the first two pages' text layer from the stored raw PDF actually
   available without a model, and does it give ownIdsOfPdf the shape it wants? Is the raw source
   reachable for every article (Supabase Storage, from a script, read-only)? Is anything written by
   apply besides article_revisions that the plan misses (a cached shelf scalar, a stamp, a hash)?
   Would writing published_at make anything other than Timeline stale, or make any step re-run and
   spend money on its own?
6. The `where … is null` guard and the one transaction: is there a way apply overwrites a reader's
   data, writes a non-current revision, or reports success having written nothing?
7. Is anything more than the simplest version that meets the three decisions?

Findings as P0/P1/P2/P3 with an ID each (F1, F2, …) and file:line. Be brief.

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Grade by consequence, not by file. Refuse only on an established P0 or P1: direct evidence with no
unresolved material inference. End with a one-line verdict: build it, or not yet.

## My own suspicions, worth less than yours

- Whether a year belongs in the public payload under a yes to "publication date".
- Whether the direct registry fetch in the script duplicates too much of askService.
