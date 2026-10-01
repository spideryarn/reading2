# Citations read the cited paper, and one shared bibliographic lookup

Status: **plan, revised after GPT Sol's plan review (§ Review log); stage 1 next.** Follow-up to SPIDERYARN-READING2-5G and 5Q (Citations
reading the cited paper) and 5P (authors and year in Debate), relayed by the Overseer with Greg's
answers, 2026-10-01 ~00:00.

## What Greg said

On 5G/5Q:

> Oh, Citations definitely needs to read the paper! Especially the References/Bibliography section.
> Otherwise it's useless! Ideally we'd even be storing citations as first-class objects in the
> database (e.g. in a Citations table with individual rows) - though maybe this is out of scope.
>
> — Greg, 2026-10-01

On 5P, a bibliographic lookup (Crossref / OpenAlex / arXiv) for a work's authors and year when its
address carries a DOI or arXiv id:

> If it's free, great. Tell me if you need my help. But don't abuse them.
>
> — Greg, 2026-10-01

In order of importance, as the Overseer put it: (1) Citations reads the article's own reference list
and the cited paper itself; (2) citations as first-class rows, if that is the right shape; (3) one
shared, polite, cached bibliographic lookup used by Citations and by Debate.

## Where things stand

- **The article's own reference list is already read.** An HTML article's bibliography is blocks, and
  every block is sent to the `citations` step. A PDF's numbered list is read from its text layer since
  6J/6K (021e2e30, [260930i](260930i-citations-mark-the-exact-citation-and-read-the-pdf-reference-list.md)).
  The one gap is an author–year PDF bibliography (§ Deferred says why it stays out of this job).
- **The cited paper is never read.** *Investigate* (one button since
  [260930d](260930d-citations-one-button-look-it-up-and-investigate-merged.md)) runs the quick check,
  then one streamed answer written from web-search extracts. The prompt forbids quotation marks, and
  a guard ([`investigate-quote-guard.ts`](../../src/investigate-quote-guard.ts)) holds back any quote
  code cannot find in the article, the work's title or reference, or the quick check's verified quotes.
- **The fetcher for a paper already exists**: [`readPaperText`](../../src/paper-text.ts), built for
  the uploaded-paper link (fb5h). Every request goes through `fetchDocument` (scheme check,
  private-address guard, redirect limit, 15 MB cap), arXiv `abs/` becomes `pdf/`, a PDF is read from
  its text layer with lines mended, an HTML page's `citation_*` meta tags are read and its
  `citation_pdf_url` followed once. 25-second deadline, 150-page cap.
- **The design for reading the paper was written and reviewed once**:
  [260929g § Proposed later stage](260929g-check-a-cited-paper-supports-the-claim.md), and GPT Sol's
  review of it, [260929g-check-a-cited-paper-plan-review-sol.md](260929g-check-a-cited-paper-plan-review-sol.md)
  (P-1 … P-10). This plan answers each of those findings; they are cited by number below.
- **No bibliographic client exists.** [`cited-in-spideryarn.ts`](../../src/cited-in-spideryarn.ts)
  already parses a DOI or arXiv id out of a `doi.org` / `arxiv.org` address.

## Which services, and why these two

| service | what it answers | key? | limit for us | used? |
|---|---|---|---|---|
| **Crossref** REST `/works/{doi}` | most journal and conference DOIs | no; a `mailto` puts us in the *polite pool* | 10 req/s, 3 at once (measured on the box: `x-rate-limit-limit: 10`, `x-concurrency-limit: 3`) | **yes** |
| **DataCite** REST `/dois/{doi}` | DOIs Crossref does not hold — arXiv's own (`10.48550/arXiv.<id>`), Zenodo, datasets | no | 1,000 per 5 minutes per IP with an identifying User-Agent ([DataCite](https://support.datacite.org/docs/rate-limit)) | **yes** |
| arXiv API | arXiv ids | no | **one request every 3 s across all our machines, one connection** | no — DataCite answers arXiv ids under a far looser limit |
| OpenAlex | DOIs, titles | **yes, since 2026-02-13** — an account and a key; 100 credits/day without | — | no — it needs Greg's account, and title search is what 5P said never to do |

So **nothing here needs Greg**: no account, no key, no registration. We identify ourselves with
`User-Agent: Spideryarn/1.0 (https://spideryarn.com; mailto:hello@spideryarn.com)` and Crossref's
`mailto=` parameter, using the site's one contact address (`CONTACT_EMAIL`,
[website-text.md](../project/website-text.md) — *"the contact address to use anywhere"*). If Greg
would rather a different address be the one Crossref can write to, it is one constant.

## The stages

Six, each green and landable on its own, each committed and pushed, each code-reviewed by GPT Sol.
Order is Sol's (§ Review log): the shared lookup, then the paper in two halves, then the cheap
enrichments.

### Stage 1 — one bibliographic lookup, polite across every instance (`src/bibliographic.ts`)

```
identifier (doi:10.1038/nn.4304 | arxiv:1706.03762)
   │
   ├─ cache row?  ── found, < 180 days ──────────────► found
   │              ── not-found, < 7 days ────────────► not-found
   │              ── claimed by another caller ──────► wait ≤ 2 s, re-read, else unavailable
   │
   ├─ claim the identifier (claimed_until = now + 20 s)
   ├─ take a service slot  ── cooldown / no slot in 3 s ► unavailable, nothing stored
   │
   ├─ arXiv id → DOI 10.48550/arxiv.<id> ─► DataCite
   └─ DOI ─► Crossref ── 404 ─► DataCite
                 │
                 └─ store found / not-found; an error stores nothing; a 429 / 503 sets the service's cooldown
```

- **`lookupWork(id)`** → `{ kind: "found", record } | { kind: "not-found" } | { kind: "unavailable", why }`.
  A record is `{ id, source: "crossref" | "datacite", title, authors: { family, given? }[], year?, venue?, doi }`.
- **Identifiers only, never a title search.** Where an identifier came from, and whether the record
  agrees with what the caller already knows, is the caller's business — and every caller below
  checks the title (§ Review log P-2).
- **The cache is a table, `spideryarn.bibliographic_records`**, one row per identifier — global, not
  owner-scoped: public metadata about a public identifier, with no owner, no article and nothing about
  who asked. Columns, not JSON (sql.md): `id` text PK with a CHECK on its two shapes; `state`
  (`found` / `not-found`, CHECK); `source`, `title`, `authors_family text[]`, `authors_given text[]`
  (same length, CHECK; an organisation is a family with no given), `year int` (CHECK 1500–2100),
  `venue`, `doi`, `fetched_at`, and `claimed_until` (the single-flight claim). Nullability CHECKs tie
  the fields to `state`. Insert `on conflict (id) do update`, per sql.md.
- **Polite across instances, in the database** (Sol P-4), not in process memory:
  - `bibliographic_services` — one row per service: `next_start_at` and `cooldown_until`. Taking a
    start is one `update … set next_start_at = greatest(next_start_at, now()) + spacing … returning`,
    so starts are spaced globally: **Crossref 250 ms (4/s, under its 10), DataCite 500 ms (2/s, under
    its 3.3)**. A caller whose start is more than 3 s away gives up (`unavailable`) rather than
    queueing.
  - `bibliographic_service_slots` — leased slots, **2 for Crossref (under its 3), 1 for DataCite**,
    taken with `for update skip locked` and a 15-second lease, freed in `finally`. Bounds how many
    are in flight across every instance.
  - a 429 or 503 writes `cooldown_until` (its `Retry-After`, else 60 s) to the service's row, and
    every caller answers `unavailable` until then without a request.
  - the cache is still the main limiter: a work is asked about once, and a miss is remembered for 7
    days. Every caller is a batch step or one reader's press, never a page load.
- **Fetching: a named JSON caller in `src/fetch.ts`** (Sol P-8) — `fetchBibliographicJson`, over the
  private `fetchBytes` path so it keeps the address guard, deadline and byte cap; fixed hosts
  (`api.crossref.org`, `api.datacite.org`), `application/json` and `application/vnd.api+json`, one
  attempt, 1 MB, 8 s. `FetchedDocument` is not widened.
- **Logged**: service, outcome, status, milliseconds, cache hit, wait. The identifier is logged (a DOI
  is not prose and not personal); never the title.
- **Tests**: recorded Crossref and DataCite answers as fixtures (no network); parsing (`family` /
  `given`, an organisation as author, year from `issued` / `published` / `publicationYear`); a cache
  hit makes no request; 404 → DataCite; a not-found is cached, an error is not; a 429 cools the service
  for every caller; two concurrent lookups of one identifier make one request (the claim); slot and
  spacing against a real Postgres; a malformed identifier refused before any request.

**Simpler options passed over**: an in-memory cache (every cold instance would ask again — the abuse
Greg ruled out); per-process concurrency only (Sol P-4: many instances multiply it).

### Stage 2 — the paper, as evidence: read, bounded, confirmed, chunked (pure; no UI)

A module, `src/paper-evidence.ts`, that turns a cited work into either evidence we can vouch for or
a stated reason there is none. No route, no prompt, no schema: it lands tested and unused.

**Which address.** The first that exists: the row's own DOI or arXiv link (arXiv → `arxiv.org/pdf/…`;
a DOI → `doi.org/…`, which lands on the publisher, whose `citation_pdf_url` is followed once); else
the page the quick check matched (it passed code's identity rule). Otherwise `no-address`.

**Only a PDF's text layer counts as the paper** (Sol P-3). An HTML page's Readability text — which
may be an abstract, a landing page or a paywall notice — is not sent as the paper in this version:
`readPaperText` gains an option that refuses the HTML fallback, and that outcome is
`not-the-full-text`.

**Bounded for real** (Sol P-5, the old P-7): `pass0` gains an `AbortSignal` checked between pages,
destroying the loading task when fired, and a cap on extracted characters (400,000) as well as bytes
(15 MB) and pages (150). The paper read runs under its own 25-second signal. Measured in the real
runs: the slowest and the largest accepted PDF, wall time and peak RSS.

**One canonical text** (Sol P-9). The reader returns pages and lines, not one joined string. The
canonical text is NFKC-folded, whitespace-normalised, with the existing named hyphen repair
(`pdf.ts`) — and that one string is what is chunked, hashed, sent and searched. A standalone line
`References` / `Bibliography` / `Literature Cited` (heading-shaped: short, own line) ends the
candidate text.

**Is it the work?** (Sol P-2 — a DOI the article typed wrongly resolves perfectly to the wrong paper,
so an identifier alone never confirms.) Code decides; any disagreement refuses:

1. **The citation's title must be corroborated**, always: found by the spaced, anchored title match
   (the `resultIsTheWork` title rule, called on the title, never on a synthesised DOI URL whose
   identifier branch skips the title) in the PDF's first ~2,000 canonical characters or the page's
   `citation_title`.
2. **And one of**: an identifier agreeing (the page's meta DOI, or the arXiv id of the final address,
   equals the row's), or the first author's surname in the same first-page window.
3. **The registry, when the row has an identifier** (stage 1, called directly): its title disagreeing
   with the citation's is an **identity conflict** — nothing is sent, and the state says so. Not
   found or unavailable changes nothing above.
4. A different identifier on the document is a refusal, whatever the title says.

States: `read` · `no-address` · `unreadable` (its existing `paperUnreadableSentence`) ·
`not-the-full-text` · `not-confirmed` · `identity-conflict`.

**Chunks.** ~250 words each, numbered `c1…`, with the page each starts on. Selected: the first two
(title, abstract) plus the highest-scoring against `why` and the citing passages — plain term
overlap, stop-words dropped, deterministic, ties by position — up to ~5,000 words, in document order.
`PAPER_SELECTION_VERSION` names the rule; the selection's chunk ids and a hash of the sent text are
part of the result.

**A verified passage names its chunk** (Sol P-1). `verifyPassage(evidence, { chunk: "c7", quote })`
finds the quote with the strict `"spaced"` pass **in chunk c7 only** and returns the chunk's own
characters and its page — never the model's spelling, and never from a chunk that was not sent.

**Tests**: each identity rung, including a mistyped DOI whose registry title disagrees, a title found
only in the references refused, and a different DOI refused; the canonical text (a ligature, a line-end
hyphen, a page-boundary hyphen, curly quotes); the references cut; chunk selection deterministic and
within budget; a quote from an unsent chunk refused, one from the wrong chunk refused; an abort
mid-parse stops the page loop; an adversarial chunk (*"ignore previous instructions…"*) carried as
text.

### Stage 3 — *Investigate* reads the paper

One press becomes: quick check (unchanged) → **the paper** (stage 2) → **the paper's passages** → the
streamed answer.

**The streamed prose keeps its rule: no quotation marks** (Sol P-1, the simpler safe v1). The guard's
allowed texts do not change. The paper's words reach the reader only through the passages below.

**The paper's passages: one small JSON call**, not streamed, on the quick check's model, sent the
selected chunks (fenced as evidence, never instructions, a reminder after; `untrusted()`'s delimiter
defusing; no tools) and what the article cites the work for. It answers up to three
`{ chunk, quote, bears: "supports" | "partly" | "context" }`, and code keeps a passage only if
`verifyPassage` finds it in the chunk it names. What is shown and stored is the chunk's slice and its
page. No passage survives → the row says the AI found no passage it could point to in what it was
shown — never *the paper does not support*.

**The prose is written knowing it**: the stream is sent the verified passages and the selected
chunks (so it can describe the paper), with the rule that it may paraphrase but not quote them, and
told which state the paper is in — it cannot say *the paper shows* when it was not shown it.

**What was read, said by code** (5G's rule). Nullable columns on `citation_investigations`
(additive; **null means an answer from before this stage** — Sol P-3's legacy state, drawn as today):

| `paper_state` | the row says |
|---|---|
| `read` | *We read the paper itself: a PDF from arxiv.org, 11,200 words. The AI was shown 4,900 of them — the opening and the passages closest to what the article cites it for. Matched by its title and arXiv id.* |
| `unreadable` | *We could not read the paper: nature.com turned us away.* |
| `not-the-full-text` | *We reached a page for this work, but not its full text.* |
| `not-confirmed` | *We found a document but could not confirm it is this work, so the AI was not shown it.* |
| `identity-conflict` | *The identifier the article gives points to a different title, so we did not use it.* |
| `no-address` | *We had no address for the paper itself.* |

Columns: `paper_state`, `paper_requested_url`, `paper_final_url`, `paper_host`, `paper_words`,
`paper_sent_words`, `paper_chunks text[]` (the ids sent), `paper_matched_by`, `paper_unreadable_why`,
`paper_evidence_sha` (the sent text), `paper_selection_version`, `paper_read_at`, and
`paper_passages jsonb` — at most three `{chunk, page, text, bears}`, one opaque display value read and
written whole, with a CHECK on its length (sql.md's allowance; the earlier review's P-10 said the
same). CHECKs tie each field to its state.

**A dated snapshot, not a current reading** (Sol P-10). The context fingerprint still decides whether
the article-side inputs match; `paper_selection_version` joins it. The paper's own content is not in
it — nothing re-fetches on read — so the row says *read on 1 October* and never implies the remote
paper is unchanged. `paper_evidence_sha` is the record of what was read.

**Bounds.** Money: the passages call is ~7k input tokens on the quick check's model (~1–2¢), plus
~7k more into the stream (~2¢) — ~4¢ added to a press budgeted at $0.345; the per-press budget
constant and its comment are updated, and the daily ceiling re-checked. Time: the paper's 25 s and the
passages call's own deadline are added to the allowance lease (Sol P-5), with a margin. A new
`stage: "reading-paper"` event, so the reader sees why a press is slower.

**Surfaces named** (Sol P-11): the investigation row mapping
(`src/store/citation-investigation-row.ts`), the SSE runtime validator (`src/web/useCitations.ts`),
all three exports and their coverage tests, the row's label that says *the AI's reading of web search
extracts* (`src/web/CitationInvestigation.tsx`), `docs/project/citations.md`, and the public
projection — which must **not** gain any of this (an investigation is owner-only).

**Prompt version** `CITATION_INVESTIGATE_VERSION` bumps; earlier answers show as needing a new press
(no automatic spend).

**Tests**: each `paper_state` stored and drawn; a legacy row drawn as today; passages with a wrong
chunk dropped; the stream's guard unchanged; the lease covers the longer press; exports carry the new
columns. Then **real runs** on five works — arXiv, an open-access journal, a paywalled one, a Scholar
row with a quick-check match, and one mistyped DOI if a real one can be found — with cost, time, the
guard's stop rate, the identity outcome and the passages recorded here.

### Stage 4 — a DOI or arXiv id in a PDF's reference-list entry becomes the row's link

The item 260930i deferred, and what lets stages 3 and 5 reach a PDF article at all, whose rows today
are mostly Scholar searches. Same rule as an HTML entry: a unique DOI or arXiv id in the entry text
code split (never the model's), `linkFrom` naming it. The title check of stage 5 then guards a
mistyped one.

### Stage 5 — Citations rows carry the registry's record

At the end of the `citations` step (batch; nobody waiting), every row with a DOI or arXiv link is
looked up through stage 1 — at most 80, cache first. A found record is kept on the row as an
**optional** `registry: { title, authors, year, venue, source }` only if its title agrees with the
article's; a disagreement is kept as `registry: { conflict: true }` so the row can say the article's
identifier points elsewhere. The by-line stays *as the article gives it*; where the article gives no
authors or year, the registry's are drawn, marked *from Crossref* / *from DataCite*. Old revisions
have no field and draw as today. `publicCitedWork` gains the found record's fields — public metadata
about a public identifier — named and tested (Sol P-11).

### Stage 6 — Debate's authors and year (5P)

In the `debate` step, after its searches: each distinct source address that **carries** an
identifier — `doi.org/…`, `arxiv.org/abs|pdf/…`, or a publisher path with a `/doi/10.…/…` segment — is
looked up through stage 1. Kept only when the record's title agrees with the engine's title for the
page (a cut-short title matched on its opening words, as Debate already does) — for every address,
since a doi.org link can be as mistyped as any other. **Never a title search.** The row gains an
optional `registry: { authors, year, title, source }`; the by-line and the date order, built and
waiting since 260929h, prefer it to the extract's, and say where it came from. Public metadata, so it
reaches a visitor with the rest of the row (the public DTO named and tested). Existing debates get it
on a re-run from Metadata — no prompt bump, nothing spent unasked.

## Cost

Stages 1, 2, 4, 5 and 6 spend no model money. Stage 3 adds ~4¢ to an *Investigate* press, inside its
existing allowance. The outside services are free; the cache and the global limiter bound what we ask.

## Deferred, named

- **Citations as rows (Greg's "Citations table")** — decided with GPT Sol and Opus, § Review log P-6,
  P-7. Opus proposed an identity table, `cited_works`, one row per work per article, never deleted,
  with foreign keys from `citation_finds` and `citation_investigations`. Sol showed two things wrong
  with it: never-deleted rows answer *has this article ever cited X*, not *does it cite X*, so the
  query it was meant to buy is not honest; and adding those keys in the same deploy breaks the old
  code's writes in the minutes between migration and code. **What it would take**, for the day a real
  query asks for it: (1) a `cited_works` table of the *current* list per article, rewritten with the
  artefact in one transaction (or `cited_work_identities`, documented as *ever seen*, if only the FK
  anchor is wanted); (2) a first deploy creating and dual-writing it, backfilled from every revision's
  JSON; (3) a second deploy that backfills again, refuses if any side-table row has no match, then adds
  the foreign keys. Two migrations, two deploys, ~400–600 lines. The full move — no JSON at all, one
  row per work per revision — is 1.5–3k lines through `loadCitations`, the public projection, three
  exports, chat and the re-run path, and needs a *ran* marker to tell *not run* from *found nothing*.
- **A cited work whose only title is an author–year label** (`Santoro et al 2016`, gwern's style)
  and that has no reference entry: its registry record is *inconclusive*, so the paper is not read
  and no registry by-line is drawn. After the final review, 3 of 12 works in the real run. A first
  author and a year cannot tell a mistyped identifier from the right one; what could is a second
  identity signal — the quick check's matched page agreeing with the identifier, say.
- **An author–year PDF bibliography.** 6K splits a numbered list at its own numbers; an author–year
  list has none, and its entries run together in the text layer. Needs a splitter on `Surname, I.`
  starts, measured on real PDFs.
- **An HTML page as the paper** (`not-the-full-text` above): an open-access article's HTML full text is
  the paper, but telling it from an abstract page needs its own rule.
- **Quoting the paper inside the streamed prose** (Sol P-1's fuller fix: a `[c3]` tag held with its
  quote and checked against that chunk).
- **A table of publisher address rules** (`nature.com/articles/X` → `10.1038/X`, and so on).
- **OpenAlex**, for works with no identifier or for real citation counts: needs an account and a key
  from Greg.
- Reading the paper in the quick check, for every row, or from the hover card.

## Review log

### GPT Sol, plan review, 2026-10-01 — *build with changes*

[261001a-citations-read-the-paper-plan-review-sol.md](261001a-citations-read-the-paper-plan-review-sol.md).
Every finding taken:

- **P-1 (P0) — a paper quote could be the article's words.** The guard checks a union, so a quote
  presented as the paper's could come from the article. Taken as Sol's simpler v1: the stream keeps
  *no quotation marks*; the paper's words reach the reader only as passages from a separate JSON
  call, each checked in the one chunk it names (stages 2, 3).
- **P-2 (P0) — a mistyped DOI confirms itself.** Taken: the title is corroborated always; a registry
  title that disagrees is an identity conflict; `resultIsTheWork` is never called with a synthesised
  DOI URL (stage 2).
- **P-3 — HTML text is not the paper.** Taken: only a PDF text layer is `read`; null columns are the
  legacy state.
- **P-4 — politeness across instances.** Taken: DB-held spacing, leased slots and cooldown, and a
  per-identifier claim. DataCite's limit corrected to 1,000 / 5 min; "every arXiv paper" dropped.
- **P-5 — the PDF deadline is soft.** Taken: abort between pages, a character cap, the lease extended,
  worst-case PDF measured.
- **P-6, P-7 — `cited_works`.** Taken: deferred, with what it would take (above). Sol and Opus agree
  the full move is not justified.
- **P-8 — no JSON fetch path.** Taken: a named caller in `fetch.ts`.
- **P-9 — no canonical text, headings lost.** Taken: pages and lines returned; one canonical string.
- **P-10 — "current" overclaimed.** Taken: a dated snapshot.
- **P-11 — surfaces and stage order.** Taken: six stages in Sol's order; every projection named.

## Real runs, 2026-10-01

`scripts/probes/261001a-paper-read-probe.ts`, on three local articles (the Antikythera mechanism,
spider silk, gwern's *The Scaling Hypothesis*), real Crossref, DataCite and publishers.

**The free part, twelve works, first run**: read 3, unreadable 5, not-the-full-text 1, identity
conflict 2, not confirmed 1. Three of those outcomes were wrong, and are fixed:

- **An author–year label is not a title.** gwern cites `Santoro et al 2016` with an arXiv link; the
  registry's title can never agree with a label, so the identifier the article itself linked was
  called a conflict — and stage 5 would have told the reader so. The first fix accepted the
  registry's first author and year, but final code review found that this lets a one-digit-wrong
  arXiv id confirm another `Smith et al 2020` paper. Now that pair makes the record *inconclusive*,
  not a conflict; it becomes agreement only when the article's own reference entry also contains
  the registry title (`authorYearLabel`, `registryIdentifiesCitation` in `paper-evidence.ts`, shared
  with `citation-registry.ts`).
- **A running-header title vanished from page 1.** arXiv templates repeat the title on every page,
  so furniture removal stripped it from page 1 too, and the title check could not succeed. The
  identity check now reads page 1 with its furniture kept, but a title found only there counts only
  when its first author is in the following by-line — an issue or proceedings header cannot certify
  another paper merely because the identifier agrees. What is chunked and sent is unchanged.
- **A publisher's suffix on a DOI.** `doi.org/10.1101/2020.06.26.174482.full` is not a DOI; the
  lookup and the paper's address drop bioRxiv's and the observed BioOne route suffixes. The rule is
  deliberately publisher-shaped rather than generic: DOI suffixes are opaque, so a real DOI may
  itself end `.pdf`, `.full` or `v2`.

**After the first fixes, before the review hardening above**: read 6 (every arXiv row), unreadable 5
(nature.com and Wiley turn us away; two DOIs doi.org could not resolve before the address fix),
not-the-full-text 1 (Google Books). A read took 0.5–2.6 s. Peak RSS of the probe process grew from
600 to 930 MB over twelve reads in one process; one press reads one paper. The `Santoro et al 2016`
row has no reference entry carrying its title, so the hardened rule deliberately leaves that one
unconfirmed rather than accepting an identity that the article does not independently corroborate.

**The paid part, five presses, $0.90**: $0.14–$0.21 a press; the passages call cost ~3¢ and took
2.6–8.2 s, and offered three passages each time, all three kept by code every time — so the
quotes a reader sees are the paper's own characters. **And it found a P0**: all three presses that
read the paper then failed with *"the web search came back with nothing to read"* and kept nothing.
With the paper in hand the model ran no search, and both the code and the `citation_investigations`
CHECK still required at least one extract. The two presses that could not read the paper finished
normally. Fixed in the commit after this one, with a test of exactly that shape — the harness's fake
stream always returned an extract, so no test could see it.

A known limit, accepted: a bioRxiv PDF's line numbers are in its text layer, so a passage can read
*better than120 recurrent networks*. It is still the paper's own characters.

## Landed

- Plan and review: 7881483a.
- Stage 1, the lookup: f6691763. Stage 2, the paper as evidence: 229d363b. Stage 4, PDF entry
  identifiers: 6b2afb28. Stages 3, 5 and 6: 5bfff263, merged in 4b37a249 (stage 3's migration
  re-stamped to follow dev's). Two guards I had not run, fixed on reports from peers: db-schema-drift
  (dc7dd1cc) and client-imports (c3040a72).
