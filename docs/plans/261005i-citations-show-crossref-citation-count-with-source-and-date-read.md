# Citations: a row with a DOI shows Crossref's citation count, its source and the day it was read

## What this is for

A Citations row says how much a cited work matters with one thing: `influence`, the model's memory
of the work, and since `citations/6` that is *unknown* unless the model is confident
([261003m](261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md)).
*Dig deeper* was meant to fill it in from the web and almost never does: 0 of 13 in the probe
([261003f](../investigations/261003f-citations-influence-unknown-unless-confident-before-and-after.md)),
because a search for a paper returns the paper and an abstract does not say how famous it is.

The source that does say is a citation count. Crossref returns one, `is-referenced-by-count`, in
the same answer the app already fetches for every row whose link is a DOI. The question was put to
Greg as [Q-crossref-count] in 261003m ("Should a cited work with a DOI show a real citation count
from Crossref, e.g. 'cited 357 times · Crossref'?"). His answer, relayed by the Overseer:

> Q-crossref-count yes
>
> — Greg, 2026-10-04

So: for a row whose work has a DOI that Crossref holds, show the count as the number itself, with
its source and the date it was read, alongside the model's influence.

## What is there today

- [`src/bibliographic.ts`](../../src/bibliographic.ts) § `lookupWork` asks Crossref (and on its 404
  DataCite) for a DOI, politely, and caches the answer in `bibliographic_records` for 180 days.
  `parseCrossref` reads the title, authors, year, venue and day. It ignores the count.
- [`src/citation-registry.ts`](../../src/citation-registry.ts) § `attachCitationRegistry` runs at
  the end of the `citations` step, and puts `registry: { kind: "found", … }` on a row only when
  `registryIdentifiesCitation` confirms the record is the article's work. A mistyped DOI is a
  `conflict` and carries no record.
- [`src/registry-work.ts`](../../src/registry-work.ts) § `readCitationRegistry` is the one guard a
  stored row is read through, by the panel and by the public projection
  ([`src/public/dto.ts`](../../src/public/dto.ts) § `publicCitationRegistry`).
- [`src/web/CitationsPanel.tsx`](../../src/web/CitationsPanel.tsx) draws the row's quiet line: the
  relevance and influence bars, or the words *influence unknown*.

## What changes

One stage for the feature, and a second, tiny one for an unrelated bug the Overseer handed over.

### Stage 1 — the count, from Crossref's answer to the row

```
Crossref answer ──parseCrossref──▶ WorkRecord.citedByCount
        │                                │
        ▼                                ▼
bibliographic_records            lookupWork's result carries
  cited_by_count                   the count and when it was read
  cited_by_count_read_at                 │
                                         ▼
                        attachCitationRegistry: only on a `found`,
                        Crossref-sourced record
                                         │
                                         ▼
                 row.registry.citedBy = { count, readAt }
                                         │
              ┌──────────────────────────┼─────────────────────┐
              ▼                          ▼                     ▼
      the owner's row           a visitor's row        chat's article_citations
  "cited 357 times · Crossref · read 4 Oct 2026"
```

1. **Parse.** `parseCrossref` reads `message["is-referenced-by-count"]` and keeps it only when it
   is a non-negative safe integer; anything else is no count. `WorkRecord` gains
   `citedByCount?: number`. `parseDatacite` is not touched (see Passed over).

2. **Store, additively.** One migration adding two nullable columns to `bibliographic_records`:

   - `cited_by_count integer`, CHECK null or `>= 0`, and only on a `found` row whose `source` is
     `crossref`;
   - `cited_by_count_read_at timestamptz` — when the count was asked for. CHECK: a count implies a
     read time.

   Nothing is dropped, rewritten or backfilled. Generate with `npm run db:generate`, apply to the
   shared local database with `npm run db:migrate`, read the `Target:` line, and run `db:chain`.

   **Why a second timestamp when `fetched_at` exists.** A record cached before this ships has no
   count and stays fresh for 180 days, so without something more those rows would show nothing for
   six months. The fix is in the freshness test (`freshSql` in
   [`pg-bibliographic.ts`](../../src/store/pg-bibliographic.ts)): a `found` Crossref row whose
   `cited_by_count_read_at` is null is not fresh, so the next caller asks Crossref again, once.
   The write sets `cited_by_count_read_at = now()` on every Crossref `found` answer, **whether or
   not Crossref gave a count**. That is what stops a loop: "asked, and there was none" is a
   different state from "never asked", and `cited_by_count is null` alone cannot tell them apart.
   The simpler option passed over is a date constant in the predicate ("rows fetched before the day
   this shipped are stale"); it is wrong for any row fetched by old code between the constant and
   the deploy, and nobody knows the deploy time in advance. A migration that nulled `fetched_at`
   on old rows would also work, and is a data rewrite the brief rules out.

   **Cost of that one refresh:** each cached Crossref record is asked for once more, the next time
   a list containing it is made. That goes through the same limiter (4 starts a second, 2 slots, a
   60-second budget per list), so it cannot exceed what a first-ever list already does.

3. **Carry when it was read.** `lookupWork`'s `found` result must say when the count was read, from
   the database's clock, on both paths: the cached read selects `cited_by_count_read_at`, and
   `write` returns the moment it stored (its `returning` clause), which replaces today's boolean
   with "the stored moment, or null when the claim was lost". `WorkRecord` gains
   `citedByCountReadAt?: string` (ISO). Every fake `BibliographicStore` in the tests follows.

4. **Attach to the row.** In `registryFor` (citation-registry.ts), a `found` verdict from a
   Crossref record that has a count gets `citedBy: { count, readAt }`. `CitationRegistry`'s `found`
   arm gains the optional field; `RegistryWork` itself does not, so Debate's rows and the article's
   own registry facts are untouched. `readCitationRegistry` reads it back field by field: a
   non-negative safe integer and a parseable ISO moment, else no `citedBy` and the rest of the
   record still reads. A `conflict` never carries a count: the DOI points at another work, and that
   work's count is not this row's.

   The record is still outside the step's stamp and outside what the model is sent, as the rest of
   `registry` is. A new counter, `counted`, joins `RegistryCounts` on the step's log line.

5. **Draw it**, on the row's quiet line beside the bars, for owner and visitor alike (a count is
   public data about a public DOI, and the visitor already gets the `found` record):

   - `cited 357 times · Crossref` with thousands separators (`cited 12,480 times`), `cited once`
     for 1;
   - **zero** reads `no citations recorded · Crossref`, not *cited 0 times*: Crossref counts only
     citations from works whose publishers deposit their reference lists, so zero is a statement
     about Crossref's records, and the words should say that;
   - the date read is in the card that opens on hover, focus or tap (the same `ControlTip` shape as
     *influence unknown*): *Crossref's count on 4 Oct 2026. It counts citations from works whose
     reference lists publishers have deposited with Crossref, so it is usually lower than Google
     Scholar's, and it is not comparable across fields or ages.* **Open to the implementer and the
     browser check:** if the row has room at desktop width, the day goes on the line too
     (`· read 4 Oct 2026`); at phone width it stays in the card. The brief asks for "the number
     itself with its source and the date it was read", and all three must be reachable by a finger.
   - It is words, never a bar: nothing maps a count onto 0–1.

   The prose hover card draws no scores today and gets no count.

6. **Say it elsewhere.** The band's **(i)** (`BandAbout`), which today says influence is "not a
   citation count", gains a sentence saying the count shown on some rows is Crossref's, for works
   with a DOI. `/help` likewise ([help-page.md](../project/help-page.md)). Chat's
   `article_citations` tool adds the count, its source and the day to a row that has one, outside
   the untrusted fence as our own words. [citations.md](../project/citations.md) gets a section and
   loses the item from § Deferred; [database.md](../project/database.md) if it lists the columns.

7. **The bar and the orders do not change.** `priorityOf`, the threshold, the influence order and
   `effectiveInfluence` are untouched. Whether the bar should judge every row on relevance alone
   now that counts exist is [Q-bar-on-relevance], which is Greg's and still open. If the counts
   make a better rule obvious, it goes to him as a question; it is not built here.

**An existing list gets counts when it is made again** from the Metadata page, as every other
registry fact does. Nothing re-runs by itself.

**Tests, red first.** `parseCrossref` (a count, zero, a missing field, a negative, a float, a
string); the store's read/write round trip and the freshness rule against Postgres
(`tests/bibliographic-pg.test.ts`: a pre-feature Crossref row is not fresh, a DataCite row is, a
Crossref row asked and given no count is fresh — the loop test); `lookupWork` returning the read
moment on both paths; `registryFor` (found + Crossref + count → `citedBy`; conflict → none;
DataCite → none); `readCitationRegistry` (malformed `citedBy` dropped, record kept); the public
projection passes it; the panel's wording for 0, 1, 357 and 12,480, and the card. All network goes
through the suite's fetch guard; nothing calls Crossref for real in a test. At the end, mutate the
finished code (drop the `source = 'crossref'` condition; drop the read-at write) and check the
suite goes red.

### Stage 2 — a DOI that arrives percent-encoded is decoded once

From GPT Sol's finding 7 on 261004j, handed over by the Overseer: `normaliseDoi` in
[`src/paper-metadata.ts`](../../src/paper-metadata.ts) strips a `doi.org` prefix with a regex and
keeps the path as written, so a DOI that arrives as an already-encoded address
(`https://doi.org/10.1002/%28sici%29…`) is stored with its escapes and encoded a second time when
`doiUrl` builds a link. [`src/doi-url.ts`](../../src/doi-url.ts) § `doiOfUrl` is the one reader of
a doi.org address back to its DOI. Use it for the address forms (`http://`, `dx.doi.org` and
case-insensitive hosts included, which `doiOfUrl` does not take as written, so normalise the
prefix first or widen `doiOfUrl` — whichever leaves one reader); a bare `10.…` or `doi:` string is
not an address and is not decoded. Red test first. The class is in
[the postmortem](../postmortems/261004m-an-encoder-is-not-reversible-until-every-consumer-agrees-on-the-boundary.md);
the implementer greps for any other place that strips a doi.org prefix by hand and reports it.

## Passed over

- **DataCite's `citationCount`.** arXiv ids resolve at DataCite, so this would cover preprints. Its
  counts are thinly populated: a famous arXiv paper can read as a handful or zero, which would
  mislead more than it informs. Greg's yes was to Crossref. Worth a look later, with a measurement
  first.
- **OpenAlex's `cited_by_count`.** Better coverage than Crossref (it has arXiv, and counts more
  citing works). The Debate session added OpenAlex for *the papers that cite the article*
  (`src/citation-index.ts`, commit e8de3e851), which shares this limiter (`inServiceTurn`,
  `coolAfter`) but asks a different question about a different work, once per article. Asking it
  per cited work is up to 80 more requests per list to a second registry. A candidate for a
  follow-up question to Greg once the Crossref counts have been looked at on real lists.
- **A "most cited" order.** Not asked for; easy to add later, and it is entangled with
  [Q-bar-on-relevance].
- **Feeding the count to *Dig deeper*'s influence call** (option B of the question): the 0–1 scale
  would be the model's judgement again.
- **Refreshing the count on read.** It is a dated snapshot, said as one; the row never claims the
  number is current.

## Stages

| | what | done when |
|---|---|---|
| 1 | the count, parse to row to screen, docs and help | tests green, typecheck, browser check at desktop, iPad and phone, GPT Sol's code review |
| 2 | `normaliseDoi` decodes an encoded doi.org address once | red test green, in the same code review |

## Review log

(filled in as the reviews arrive)
