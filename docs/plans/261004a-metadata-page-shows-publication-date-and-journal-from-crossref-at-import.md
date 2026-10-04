# The Metadata page shows the publication date and the journal, taken from Crossref at import

Up: [plans.md](../project/plans.md)

Report `spya-pcz6a3`, Greg, 2026-10-03, from the Metadata page of the Entropy paper:

> It would be great if the metadata page also somehow figured out and listed the publication date.
> And perhaps journal etc

Relayed by the Overseer with two bounds: do it for **new imports**, by asking Crossref about the
paper's own DOI (the lookup Citations already uses), and **no backfill** of articles already in
production, which is Greg's call. The sibling work is
[261003m](261003m-shelf-sorts-by-publication-date.md): the Shelf sorts by `publishedAt`, and no PDF
has one.

## What is already true

- `Meta.publishedAt` exists (`article_revisions.published_at`, text). Its only writer is
  `publicationDate` in `src/extract.ts`, from a web page's own `article:published_time`. A PDF never
  gets one.
- **The Metadata page does not show it.** Its facts line under the title is byline, site name,
  language (`src/web/Metadata.tsx` § `facts`).
- Every reader of `publishedAt` wants a full calendar day at the front (`calendarDay`, `dayFrame`);
  `yearOf` alone takes four digits. So a bare year cannot go in that field.
- `Meta.doi` exists (`article_revisions.doi`), written only by the `metadata` step, for a minimal
  paper. A fully read PDF has no DOI, and neither has a web page.
- `lookupWork` (`src/bibliographic.ts`) asks Crossref, then DataCite, about a DOI or arXiv id, with
  a database cache, a global rate limit and bounded waits. It never throws for a registry's
  failure. Its `WorkRecord` keeps a `year` and a `venue` (Crossref's `container-title`), not a day
  and not a publisher.
- The journal has no field anywhere on an article.

## What gets built

1. **The paper's own identifier, found without a model.**
   - A read PDF: every DOI and `arXiv:<id>` printed on **page 1**, in any record type (the DOI strip
     is furniture the reading view hides, but the record is still there). At most three, in page
     order.
   - A web page: `citation_doi`, then a DOI or arXiv id in the page's own address (`identityOf`).
   - A minimal paper: the DOI the `metadata` step already found.
2. **The registry confirms it, or nothing is kept.** Each candidate goes to `lookupWork`. A record
   is the article's own only when its title agrees with `meta.title`: the same words in the same
   order after folding, both titles distinctive (`registryTitleIsDistinctive`), and not a
   correction or supplement of the other (`titlesDifferByObjectQualifier`). A DOI printed on page 1
   that belongs to a cited work, or to the journal issue, fails this and is dropped. The first
   candidate that agrees wins. A model never chooses.
3. **What the article keeps from the agreed record:**
   - `doi`, when it had none;
   - `journal`: the record's venue. A new nullable text column, `article_revisions.journal`, and
     `Meta.journal`;
   - `publishedAt`: only when the article has none **and** the registry states a full day. The
     page's own date wins, because it is the publisher's own and may carry a time.
4. **`WorkRecord.published`**: the ISO day Crossref states, the earliest full `[y, m, d]` among
   `published-online`, `published-print`, `published` and `issued`. Absent when none is a full day.
   The cache table gets a nullable `published_day` text column with a shape check. DataCite states
   only a year, so an arXiv preprint gets its venue and no day.
5. **Where it runs:** inside the `extract` step, after the extractor has built `meta`, and inside
   the `metadata` step. One helper, `withRegistryFacts(meta, candidates, lookup)`, in a new
   `src/article-registry.ts`. A lookup that is unavailable, not found, or disagrees leaves `meta` as
   it was and the import carries on. It logs counts, never a title.
6. **The Metadata page.** The facts line gains, before the site name: `Published 31 May 2024` and
   the journal's name. Owner's page only in this version.

## What is not built, and why

- **No backfill.** Nothing here touches a stored article. An existing article gets the facts only
  if its owner re-reads it (Read it again re-runs `extract`). What a backfill would touch is in the
  debrief.
- **A year without a day** (older print papers, DataCite). `publishedAt` cannot hold it and a
  guessed `-01-01` would be a date we made up. Deferred, as its own queue entry.
- **The publisher** (`MDPI AG`). Not kept by `WorkRecord` today; one more field and column for a
  fact nobody asked for by name. Deferred with the year.
- **The visitor's page.** `journal` stays out of `PublicMeta`, as `doi` is. Adding a field to the
  public allowlist is a change to a defence, which an unattended run does not make. A question for
  Greg in the debrief.
- **A journal read off the page** (`citation_journal_title`) with no DOI. Registry only.

The simpler option passed over: show `publishedAt` on the Metadata page and stop. It gives a paper
nothing, and the report was filed from a paper.

## Risks

- **A wrong DOI lends a wrong date.** The title check is the guard, and it fails closed. A title the
  front-matter pass got wrong means no facts, which is the correct failure.
- **`extract` now makes a network call.** Bounded by `lookupWork` (about 5 s a candidate at worst,
  three candidates), cached for 180 days, and never fatal.
- **A cached record from before this change has no day.** A paper already cited by another article
  may be cached without one for up to 180 days; it gets its journal and no date. Accepted.
- **The article fingerprint.** `datedArticleFingerprint` reads `publishedAt`, so a re-read that
  gains a date makes Timeline stale once. That is the field doing its job.

## Tests, each seen red first

- `parseCrossref`: a full day from `published-online`; year-only gives no `published`; the earliest
  full day wins.
- Candidates: page-1 DOIs found in furniture, a page-2 DOI ignored, trailing punctuation off, cap of
  three; `citation_doi` and an arXiv address for a page.
- `withRegistryFacts`: agreeing title fills the three fields; a disagreeing title fills none; an
  existing `publishedAt` is kept; `unavailable` fills none and does not throw; the second candidate
  wins when the first disagrees.
- The store round-trip carries `journal` and `published_day`.
- Metadata page: the date and journal are drawn; absent when the meta has neither.

## Stages

One stage. Migration, the parser and cache, the helper and its two call sites, the page, the docs
(`content-extraction.md`, `database.md` if it lists columns), the feedback note. GPT Sol reviews this
plan, then the code.

## GPT Sol's plan review, and what changed

[The review](261004a-metadata-date-and-journal-plan-review-sol.md): no P0, eight findings. The text
above is the plan as reviewed; where a finding changed it, this section wins.

- **F1, taken.** `journal` goes through every mapping `doi` does: the two `META_COLUMNS`,
  `metaColumns`, `readMeta`, the read policy, `metaFrom`, the carry table. Not `store/export.ts`:
  it does not export `doi` or `abstract` either, and that is a separate question.
- **F2, taken.** *Read this* now keeps the journal and the day along with the DOI
  (`keptPaperMetadata`), so an unreachable registry does not take them away. Tested through the real
  step, and the test was seen red with the line removed.
- **F3, taken.** A title alone does not say whose DOI it is. An author must agree too: one of the
  registry's family names in the article's byline. No byline, or no registry author, means nothing
  is kept.
- **F4, taken, and wider than asked.** The suite's fetch guard now refuses `api.crossref.org` and
  `api.datacite.org`. Five minimal-paper tests went red on it, which showed both that the suite had
  been reaching Crossref and that the step's call site runs. They are handed a lookup now.
- **F5, met another way.** The new `bibliographic_records_published_day` check allows a day only on
  a `found` row, so a claim or a not-found row cannot hold one. The older shape check is untouched.
- **F6, taken.** One lookup can take about 28 s against a slow registry, not 5. No second or third
  lookup starts after 10 s, and none after the step is cancelled.
- **F7, taken.** The journal comes from Crossref, and from an arXiv id (`arXiv`). A DataCite
  record's venue may be the repository that deposited it, so it is not used.
- **F8, taken as a correction.** A read PDF or page may already hold a minimal paper's DOI. And
  Readability's date also comes from JSON-LD `datePublished`.
- **Pages, not page.** The candidates come from the first two pages, not the first, so a
  publisher's cover page does not hide the DOI. The agreement checks are what make that safe.
- **The title rule** allows one title to be the other plus a subtitle, when the shared part is at
  least four words: Crossref keeps a subtitle in a field of its own.

## Log

- 2026-10-04: plan written, reviewed, built in one stage.
