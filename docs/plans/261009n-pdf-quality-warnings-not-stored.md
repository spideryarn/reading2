# PDF quality warnings not stored

Up: [plans.md](../project/plans.md) · postmortem:
[261009h](../postmortems/261009h-a-flag-the-store-did-not-keep.md) (this is the live sibling its
sweep found)

A bug found in a review, not a reader report, so no feedback note. Fixed under Greg's standing rule:

> You are definitely authorised to fix bugs any time you notice them
>
> — Greg, 2026-10-09

## The bug

`runPdfExtract` (`src/pdf-read.ts`, end of the function) puts the transcription checker's
complaints on `meta.quality`. `src/types.ts` § `Meta.quality` calls the field *"the whole of what is
left of that defence: if nobody reads it, nobody is checking"* — the defence being the per-page
check that used to refuse a bad transcription and, since Greg's call of 2026-08-30, publishes and
says what looked wrong instead ([content-extraction.md](../project/content-extraction.md)).

`article_revisions` has no column for it. `metaColumns` (`src/store/artifacts-pg.ts`) does not
write it, `readMeta` (same file) and `metaFrom` (`src/store/pg.ts`) do not read it. So on Postgres,
the only store since 2026-09-05, every PDF's complaints are computed and dropped at the store's
door. `src/feedback-article.ts` copies `meta.quality` into a feedback snapshot and so always copies
nothing. This also breaks [database.md § AI output we paid for is
kept](../project/database.md#ai-output-we-paid-for-is-kept): the complaints are the output of the
transcription we paid a model for.

Reproduced: `tests/store-artefacts-pg.test.ts` § *takes meta apart…*, with `quality` added to its
fixture, fails — the field is absent on the way back.

## The fix

| # | What | Where |
|---|---|---|
| 1 | `article_revisions.quality text[]`, nullable; null means **no complaints stored** — the checker found nothing (the common case), or the revision predates the column. A CHECK (`article_revisions_quality_nonempty`) refuses `{}` and a null element, so "none" has one spelling. Additive migration `20261009155141_revision_pdf_quality`. | `src/db/schema.ts`, `drizzle/` |
| 2 | Written by `metaColumns` as `meta.quality?.length ? [...meta.quality] : null` (`?? null` semantics, so a re-extraction that finds nothing clears the last one's complaints), and listed in its `META_COLUMNS`. | `src/store/artifacts-pg.ts` |
| 3 | Read back by `readMeta` and by `metaFrom` (and its `META_COLUMNS` projection). Projection policy: owner reads only, like `recall`; the public reader does not get it (`src/public-types.ts` already withholds the PDF provenance block — add `quality` to that list). | `src/store/artifacts-pg.ts`, `src/store/pg.ts`, `src/public-types.ts` |
| 4 | Carried to a new revision like `recall` (`"carry"`), and named in the rollback export beside `recall`. | `src/store/pg-revisions.ts`, `src/store/export.ts` |
| 5 | **The class check, for both read halves.** The meta round-trip fixture is typed `Required<Omit<Meta, NotExtracts>>`, with `NotExtracts` naming the stage-1 fields, `readingDifficulty`, and `publishedAt` (exclusive with `publishedYear` by CHECK, tested on its own) — so a new `Meta` field does not compile into the test until it is placed, and once placed fails until `metaColumns` and `readMeta` both name it. `tests/meta-from-columns.test.ts` does the same for the owner read `metaFrom`: a row typed over every `META_COLUMNS` entry non-null, and a `Record<keyof Meta, …>` saying which fields it surfaces. Both watched red by deleting the `quality` line each holds. | `tests/store-artefacts-pg.test.ts`, `tests/meta-from-columns.test.ts`, `src/store/pg.ts` (exports `metaFrom`) |
| 6 | Through every read: `tests/pdf-quality-pg.test.ts` — the owner's `loadArticle`, a new draft, the export's `meta.json` (watched red), and a visitor, who gets none. The public forbidden-field lists in `tests/public-reads.test.ts` and `tests/public-dto.test.ts` name `quality`. Store tests for `[]` written as null, a clean re-extraction clearing the list, and the CHECK. | `tests/` |

**Simpler option passed over: store `quality` in an existing jsonb column** (e.g. inside `note`, or a
generic provenance jsonb). Rejected: `note` is a string with its own meaning, and a provenance blob
is the whole-row-JSON shape [sql.md](../project/sql.md) steers away from. A `text[]` is one column
holding exactly the field; the schema already uses `text[]` (`authors_family`, `paper_chunks`).

**Not built: any UI.** Nothing renders `meta.quality` and the brief says not to build any. What
could show it, for Greg to decide, is listed in § For Greg.

## Existing articles

Every PDF extracted before this lands has lost its complaints for good; re-extracting would recompute
them at the cost of a fresh transcription. No backfill — that is Greg's call, and it costs a model
run per PDF. Their `recall` and `pagesChecked` are intact, and those are what the masthead shows.

## GPT Sol's plan review

[261009n-plan-review-sol.md](261009n-plan-review-sol.md), APPROVE WITH CHANGES. Taken: the CHECK
and the wording of null (F3), the owner-read and export checks and the separate publication-date arm
(F2), the public forbidden-field lists (F4), the two stale comments (F5). **Not taken, F1**: the
`metadata` step writes meta through the same `metaColumns`, so an administrator re-running it alone
on a fully-extracted PDF clears `quality` — but it already clears `source`, `method`, `pages`,
`unverified`, `recall` and `pagesChecked` the same way, so `quality` only joins its neighbours. Making
that writer step-aware is a change to the whole PDF provenance block, and it is listed for Greg below.

## For Greg

- **Showing the complaints.** Candidates: a line under the metadata page's `Missed` row
  (`src/web/Metadata.tsx` § `CameFrom`), or the masthead's source note. Not built.
- **Backfill** by re-extracting existing PDFs: not done, costs a transcription each.
- **A standalone `metadata` run clears the PDF provenance** (`source`, `method`, `pages`,
  `unverified`, `recall`, `pagesChecked`, and now `quality`) on an article `extract` already read,
  because both steps write through `metaColumns`. Only the administrator can run it alone
  (`src/jobs.ts`). Not changed here; fixed by
  [261009q](261009q-metadata-rerun-keeps-what-it-does-not-make.md).
- **The rollback export's `meta.json` leaves out `abstract`, `doi` and `journal`.** `doi` and
  `journal` are a recorded open question
  ([261004a](261004a-metadata-page-shows-publication-date-and-journal-from-crossref-at-import.md));
  `abstract` is omitted with no comment saying so. Not changed here; 261009q exports `abstract` and
  writes down the other two.
- Siblings found by the sweep: see the postmortem's follow-up.

## Gates

`npm test`, `npm run typecheck`, `npm run lint` on touched files, `npm run db:check`. GPT Sol plan
review before building, code review before pushing.
