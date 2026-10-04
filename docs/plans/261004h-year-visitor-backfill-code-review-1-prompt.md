# Review and fix: stage 1 of 261004h — a publication year, and two facts for a visitor

Repo: this worktree, branch worktree-paper-year-visitor-backfill. TypeScript, ESM, Postgres, React.

## The candidate

Committed: commit 698c9052d
    git diff 698c9052d^..698c9052d
    changed paths: git show --stat --format= 698c9052d

Start with: src/public/dto.ts, src/store/public-reader.ts, src/public-types.ts,
src/article-registry.ts, src/web/relative-time.ts, src/web/PublicPages.tsx,
drizzle/20261004143816_article_published_year.sql. That is where to begin, not the limit.

The plan, with your plan review's findings folded in:
docs/plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md
Only "Stage 1" is in this candidate. Stage 2 (the backfill script) is being built now by another
agent in this same tree: it is creating scripts/backfill-registry-facts.ts, a per-page reader in
src/pdf.ts, and tests for those. Do not review or touch those files; they get their own review.

## What it is meant to do

1. A registry record with a year and no whole day fills `article_revisions.published_year`
   (`Meta.publishedYear`). An article holds a day or a year, never both; a table check enforces it.
   The owner's Metadata page prints "Published 2011". On the Shelf a year-only paper sorts among
   the dated ones at the start of its year (a sort key only, never stored or printed); it ties with
   1 January of that year, which is accepted.
2. A visitor to a shared article receives `journal`, `published` (the calendar day, never the
   stored string) and `publishedYear` in `PublicMeta`, and the public Metadata page prints them.
   The product owner approved the journal and the publication date and nothing else. `doi` and
   `abstract` must not cross. docs/project/security-map.md is the contract for this surface.

Out of scope: Timeline and datedArticleFingerprint, the public shelf listing, the backfill.

## You may fix

You have write access. Fix what is inside this stage, narrowly, with a failing test first. Report,
do not fix, anything wider. Do not edit an existing migration file other than
20261004143816_article_published_year.sql, and if you change that one say so loudly: it has not
been applied to the shared local database yet. Do not commit. Do not write any sentence attributed
to Greg; the only words of his in this work are "Q-visitor-page yes" and
"Q-year-only-papers yes".

You have no network and no Postgres. These were run by the author and passed (raw tails):

    typecheck: ✓ all 2992 source files are covered by some project
    21 unit/jsdom files: Tests 583 passed (583)
    14 Postgres files (store-artefacts-pg, store-revision-columns, store-revision-policy,
      store-parity, store-roundtrip, store-export-covers-tables, db-schema-drift, db-schema,
      migration-journal, migration-snapshots, migration-ledger, minimal-paper,
      public-visibility-pg, pipeline-artifact-store): Tests 564 passed (564)

Run tests/public-dto.test.ts and tests/article-registry.test.ts yourself.

## Independent pass first

Attack it. In particular:
- Can anything other than the three named facts reach a visitor by this change, on any public
  route or the server-rendered /read/:slug page? Is any other public projection or DTO fed from
  the same row?
- Can an import now fail on the new table check (a day and a year together) by any path:
  keptPaperMetadata, the metadata step, a draft copy, the revision carry table?
- Every mapping `journal` has that `publishedYear` lacks, or has wrongly (the read policy).
- Any reader of `publishedAt` that now disagrees with the Shelf column or the Metadata page.
- Docs: is every new sentence true of the code?

Findings with IDs continuing from the plan review (start at F7), P0 to P3:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

For each: what you found, whether you fixed it, the test. End with a one-line verdict.

## My own suspicions, worth less than yours

- `const shared: PublicMeta = meta` in PublicPages.tsx: a visitor's article is typed `Article` on
  the client, so the page reads the public fields through a widening assignment.
- A year taken when the registry's day is not a real calendar day.
- Reader.tsx and DebateMode.tsx comments say a visitor's meta has no publishedAt.
