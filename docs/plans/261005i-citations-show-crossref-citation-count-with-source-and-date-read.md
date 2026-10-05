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

### GPT Sol's plan review

[The review](261005i-citations-crossref-count-plan-review-sol.md), of commit `d6673bebc`: **build
as written**, no P0 or P1, seven findings, all taken. **Where a row below differs from the text
above, the row wins.**

| | finding | what the build does |
|---|---|---|
| F1 (P2) | `write` must say "stored" for a DataCite or not-found answer too, and `memoryBibliographicStore` in `src/backfill-registry-facts.ts` is a production store, not a test fake | `write` returns the stored `fetched_at` for every successful write and null only for a lost claim; `citedByCountReadAt` is set from it only on a Crossref `found`; the memory store follows, on its injected clock |
| F2 (P2) | `readCitationRegistry` would pass a well-formed `citedBy` on a DataCite record, labelled Crossref | the reader keeps `citedBy` only when `source` is `crossref`; a test has a DataCite record keep its metadata and lose the count |
| F3 (P2) | a safe integer can exceed Postgres `integer`, and the failed write would lose the whole record | the parser keeps a count only up to 2,147,483,647; above that is no count and the record stays |
| F4 (P2) | "once" is one *successful* refresh: a failed refresh leaves the row eligible, and the refresh can first happen in import, Debate or *Dig deeper* | said so here. Other callers' output shapes are unchanged; a cached answer can be `unavailable` during a Crossref outage until one refresh succeeds. Tests: failed refresh then retry, Crossref replaced by DataCite, replaced by not-found, each clearing the old count columns |
| F5 (P2) | stage 2: decoding and then trimming sentence punctuation eats a real trailing bracket (`a%5B1%5D` becomes `a[1`) | trim the sentence's punctuation first, decode the address form second, validate without trimming again. Tests: encoded terminal brackets, a literal `%252F`, a malformed escape, each host form. The `a%2Fb` ambiguity `doiOfUrl` documents stays, and is said |
| F6 (P3) | *influence unknown* is `Tooltip` plus `useTapReveal` in `UnknownInfluence`, not `ControlTip` | that component is the precedent |
| F7 (P3) | nulling `fetched_at` would break `bibliographic_records_shape` | that alternative would not have worked as written; struck |

### What landed

Built by an Opus subagent, tests red first, in commit `83b247bc3`. Departures from the text above,
each read and kept:

- **The day is in the card, not on the line.** The line is `cited 357 times · Crossref`; with the
  day it is about 300px and the band's narrowest is 288px. The day reads *4 October 2026*, through
  the panel's existing `dayOf`, not a second formatter.
- **A second CHECK**, `bibliographic_records_cited_by_count_read_at`: a read moment only on a found
  Crossref row. Both CHECKs use `is not distinct from`, so a claim's null state cannot slip through.
- **`fetched_at` is truncated to the millisecond**, as `claimed_until` already was, so the moment
  `write` returns is exactly what a later read gives.
- **`citedByCountReadAt` is on every Crossref record `lookupWork` returns**, count or not, mirroring
  the column. `registryFor` needs both to attach `citedBy`.
- **The band's (i) gains its own paragraph** (`CITED_BY_NOTE`) and `INFLUENCE_NOTE` is unchanged.
- **Stage 2 puts the address in `doiUrl`'s spelling and calls `doiOfUrl`**, which is not widened;
  `DOI_ORG` is exported for that. Two other readers of a doi.org address exist and already decode
  (`identityOf` in `src/cited-in-spideryarn.ts`, and `src/web/link-preview.ts`); no other strip
  that keeps escapes was found. **One visible change:** an encoded address whose DOI holds `<` or
  `>` (an old Wiley SICI) now gives no DOI, where before it gave the escaped string that was later
  encoded twice. The existing DOI shape refuses those characters.

Mutations, each red and then restored: the reader without its Crossref-only condition (4 tests);
the store without the read-at write (7); `freshSql` without `source = 'crossref'` (1).

**The outage cost, accepted (F4):** until one refresh succeeds, a Crossref record cached before
this is `unavailable` to import, Debate and *Dig deeper* as well as to Citations. Serving the old
record when its refresh fails would remove that, at the price of `read` returning stale answers; not
built, since a Crossref outage already makes every uncached lookup unavailable.

**A deploy where the code arrives before the migration** makes every lookup `unavailable: store`
(the read names columns that do not exist yet): rows lose registry enrichment and nothing fails.
`npm run deploy` applies migrations first, so this is the window only if that order is broken.

### GPT Sol's code review

[The review](261005i-citations-crossref-count-code-review-sol.md) of `83b247bc3`: **land after
fixes (F8)**; no P0 or P1; the six statements it was asked to check hold (the "never re-asked"
one with the obvious qualification that the ordinary 180-day expiry still applies).

| | finding | |
|---|---|---|
| F8 (P2) | chat's `article_citations` put the count and its day inside the article's untrusted fence, against item 6 above | fixed by Sol: the counts are listed outside the fence, tied to numbered rows; [postmortem](../postmortems/261005h-a-formatter-erases-trust-when-it-mixes-checked-facts-with-article-text.md) |
| F9 (P2) | `tests/chat-tools.test.ts:765` does a real DNS lookup before its `fetch` stub | reported; not this work; passed to the Overseer |

One round. Sol's fix was read and is covered by its own red-first test; no second round was run.

### Browser check

Sonnet subagent, Playwright, on commit `88d82abd2`, at 1440×900, 820×1180 (touch) and 390×844
(touch). The shared local database did not have the migration (below), so no list could be made
again; instead one stored list (Antikythera, 79 works) was given `citedBy` on five rows and put back
afterwards, read back identical.

Passed at all three widths: the four wordings (357; 12,480; *cited once*; *no citations recorded*)
on the quiet line between the bars and the source, in the neighbouring text's face, size and colour,
light and dark; no overflow and no sideways scroll; the card on hover, keyboard focus and tap, with
the day and the caveat, not clipped; a DataCite row seeded with a count draws none; the bar hides by
score and the five order buttons are unchanged; the (i) and `/help` say it; no console errors from
this work. The day would not have fitted on the line: it adds about 120px to a band about 506px wide
at desktop, where *Dig deeper* already wraps beside *influence unknown*.

**Not seen in a browser:** a visitor's row (the seeded article is private, and making it public was
outside what the check was allowed to change; `tests/public-dto.test.ts` covers the projection), and
a count that arrived through a real Crossref answer rather than a seeded row.

Screenshots: [desktop](261005i-shot-1-desktop-rows.png) · [phone](261005i-shot-2-phone-rows.png) ·
[the card](261005i-shot-3-open-card.png) · [light](261005i-shot-4-light-rows.png).

### Gates

On the merged tree (`b51d2ce74`): `npm run typecheck` green; twelve touched or structural test files,
509 tests, green (`bibliographic`, `citation-registry`, `registry-client`, `public-dto`,
`citations-panel`, `chat-citations-tool`, `chat-tools`, `backfill-registry-facts`, `paper-metadata`,
`doc-links`, `client-imports`, `fixture-ids`); `db:chain` fine. Before the merges, the implementer's
35 files and 913 tests, which included `bibliographic-pg` against Postgres (24) and the schema and
migration tests.

**The full `npm test` did not finish, and no full-suite pass is claimed.** The first run was
stopped at the Overseer's request when the box was overloaded (load about 195), with no failure in
its log after 75 minutes; the second sat for 30 minutes in a queue of about thirty on the shared
lock and was withdrawn. Pushed on the targeted gates.

### The migration and the shared local database

`npm run db:migrate` (`Target: postgresql://postgres@127.0.0.1:54362/postgres`) refused: the shared
database's ledger holds `20261005150617_chat_thread_origin`, a migration from another worktree that
is not on `dev` yet. Nothing was applied by hand. The Postgres tests ran against the private
database the suite mints from this worktree's `drizzle/`. Both migrations are children of the same
snapshot, so whichever lands second regenerates; the SQL does not change.
