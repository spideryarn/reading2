## Findings

### P-1 — P0 blocker — The quote guard cannot prove that a quote attributed to the cited paper came from the paper

The plan adds the selected paper chunks to the guard’s existing undifferentiated allowlist. The guard accepts a quote if it occurs in any allowed text: the citing article, title, reference entry, lookup quotes, or—after this change—a paper chunk. A model could write “the cited paper says ‘X’” where X occurs only in the citing article, and the guard would release it.

Evidence: `docs/plans/261001a-…md:147-151`; `src/citation-investigate.ts:364-379`; `src/investigate-quote-guard.ts:182-195,210-220`. The earlier review explicitly required a chunk identifier: `260929g-check-a-cited-paper-plan-review-sol.md:40-46`.

Fix: validate paper quotations against a named chunk, not the union. Require a machine-readable chunk reference such as `[c3]`, hold the quote and reference until both arrive, validate only against `c3`, and emit the chunk’s source slice rather than the model’s spelling. The simpler safe v1 is to keep quotation marks forbidden in streamed prose and show separately parsed, chunk-scoped verified quotations.

### P-2 — P0 blocker — Identifier agreement can confidently certify a mistyped DOI as the cited work

Resolving a row’s DOI and observing the same DOI in the returned document proves that the fetched document belongs to that DOI. It does not prove that the article attached the correct DOI to this citation. The plan itself anticipates a mistyped DOI by refusing to apply registry metadata when its title disagrees, but Stage 2 would then fetch that DOI and accept it at the strongest rung anyway.

Evidence: `docs/plans/261001a-…md:127-135,196-202`; DOI extraction is mechanical at `src/citations.ts:943-973`; the current identity helper short-circuits to true on identifier presence at `src/citation-lookup.ts:319-337`.

Fix:

- Treat a registry-title disagreement as an explicit identity conflict, not as “no registry”.
- Never send the fetched paper in that state.
- When registry metadata is unavailable, require the fetched first-page title to corroborate the citation title before identifier agreement can confirm the work; author evidence can strengthen the fallback.
- Do not call `resultIsTheWork` with a synthesized DOI URL: its identifier branch intentionally bypasses title comparison.

### P-3 — P1 must fix — `readPaperText` does not establish that an HTML result is the paper itself

For HTML, `readPaperText` falls back to any non-empty Readability text when a PDF cannot be followed. That may be an abstract, landing page, paywall notice, or partial HTML. The proposed `read` sentence nevertheless says “We read the paper itself”.

Evidence: `src/paper-text.ts:24-29,343-389`; proposed wording and state constraints at `docs/plans/261001a-…md:155-168`.

Fix: for the first version, reserve `paper_state = read` for a confirmed PDF text layer. Either:

- classify HTML as `partial-page`, label it exactly that way, and fence it separately in the prompt; or
- do not send HTML fallback text as paper evidence.

Also define a legacy/not-attempted representation for existing `citation_investigations` rows. The current table has no paper fields (`src/db/schema.ts:3783-3817`), and none of the four proposed states truthfully describes an old answer. Nullable legacy columns are compatible with migration-before-code; a non-null backfill is not.

### P-4 — P1 must fix — The proposed politeness controls do not enforce either provider’s rate across Vercel instances

Concurrency is not a request-rate limit. Even one process with two quick requests in flight can exceed Crossref’s 10 starts per second, while many cold instances multiply both rate and concurrency. The cache also has no cross-instance single-flight claim, so simultaneous misses for the same identifier all call the provider.

The DataCite limit in the plan is wrong for these unauthenticated-but-identified requests: an email-bearing User-Agent receives **1,000 requests per five minutes per IP**, not 3,000. The latter is the authenticated tier. Crossref’s current polite-pool limits are indeed 10 requests/second and three concurrent requests for a single DOI record. [Crossref limits](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/), [DataCite limits](https://support.datacite.org/docs/rate-limit).

Evidence: `docs/plans/261001a-…md:53-57,95-102`.

Fix: add DB-coordinated controls:

- a leased single-flight claim per identifier, so one instance fetches a cache miss;
- a global service limiter controlling request start times and live leases across instances;
- for the simplest polite v1, serialize each service globally and leave deliberate spacing between starts;
- store provider-wide `Retry-After` cooldown in the DB, not only process memory.

DataCite is a reasonable primary route for an arXiv identifier: it exposes singleton DOI metadata and has `10.48550/arxiv…` records, while arXiv explicitly applies one request every three seconds and one connection across all machines under the operator’s control. [DataCite singleton API](https://support.datacite.org/docs/api-get-doi), [DataCite arXiv example](https://support.datacite.org/docs/metadata-enrichments), [arXiv API terms](https://info.arxiv.org/help/api/tou.html#rate-limits). Drop the absolute claim that it answers “every arXiv paper”; handle and cache a 404 normally.

### P-5 — P1 must fix — The 25-second PDF deadline remains soft, and the Investigate lease no longer has a safe margin

`readPaperText` explicitly says its deadline is checked after PDF parsing, not enforced during it. `pass0` accepts no signal, collects positioned items for every page, and may run past the deadline. Adding up the current maxima gives 60 seconds for lookup, 25 for the paper, and 120 for the streamed answer, while the current allowance lease was sized for only lookup plus answer.

Evidence: `src/paper-text.ts:308-318`; `src/pdf.ts:594-615,658-691`; `src/citation-investigate.ts:113-153`; plan claim at `docs/plans/261001a-…md:170-173`.

Fix:

- add cooperative cancellation to the PDF page loop, destroying the loading task when signalled;
- preferably add a bounded text-only PDF reader that does not retain positioned items;
- cap extracted characters/items as well as bytes and pages;
- extend the allowance lease for the added phase and its margin;
- include a worst-accepted-PDF wall-time/RSS measurement in the real runs.

This leaves earlier 260929g P-7 unresolved as written.

### P-6 — P1 must fix — Adding the `cited_works` foreign keys in the migration-before-code deploy order can break the old production writer

The migration backfills existing rows and immediately adds FKs. Before the new application version is live, the old Citations step can create a new entry ID without inserting `cited_works`; a subsequent old-code Find or Investigate write then fails its new FK.

The side-table backfill is also underspecified: `citation_finds` and `citation_investigations` contain only `(article_id, entry_id)`, not the proposed non-null `key`, DOI, or arXiv fields.

Evidence: `docs/plans/261001a-…md:212-225`; current side-table shapes at `src/db/schema.ts:3676-3687,3783-3794`; current saves at `src/store/pg-citation-finds.ts:29-48` and `src/store/pg-citation-investigations.ts:25-37`.

Fix if the table is retained:

1. First deploy: create the table without these FKs, backfill what can be proven from revision JSON, and deploy the dual writer.
2. Second deploy: backfill again, explicitly query for unmatched side rows, refuse the migration if any remain, then add/validate the FKs.
3. Do not invent placeholder keys for side-only rows.

Two migrations shipped together in one deployment do not solve the compatibility window.

### P-7 — P1 must fix — `cited_works` is an identity history, not a table of current citations, and one claimed payoff is false

A row that is never deleted means “this article has contained this cited-work identity”, not “the current article cites it”. Therefore the proposed indexed query cannot honestly answer “which of my articles cite DOI X” after a citation is corrected or disappears.

It also cannot replace `pg-cited-in-spideryarn.ts`: that query retrieves candidate articles’ own URL, title, and byline to decide whether the cited work itself is already in the library. An outgoing-citations table says what those candidate articles cite, not what those articles are.

Evidence: `docs/plans/261001a-…md:212-225`; the current candidate query at `src/store/pg-cited-in-spideryarn.ts:60-86`; the true “identity survives disappearance” analogue at `src/db/schema.ts:1157-1177`.

Fix: defer §3c from this job. The full move is not justified either. If a stable FK anchor becomes valuable later, call it `cited_work_identities`, document it as “ever seen”, and do not claim current-membership queries. A current query needs revision membership or a publication-maintained current marker.

### P-8 — P2 should fix — The JSON fetch path is not designed yet

`fetchDocument` accepts only HTML and PDF and advertises those types. DataCite returns `application/vnd.api+json`; current code will reject it as unsupported.

Evidence: `docs/plans/261001a-…md:103-105`; `src/fetch.ts:52-75,2193-2221,2416-2435`.

Fix: name the implementation in the plan: add a narrow `fetchJson`/`fetchBibliographicJson` caller over the private guarded `fetchBytes` machinery, with fixed hosts, JSON media types, one attempt, 1 MB cap, and the eight-second deadline. Do not widen ingestion’s `FetchedDocument` union to JSON.

### P-9 — P2 should fix — The proposed canonical text and reference cutoff are not properties of current `readPaperText`

The returned PDF text does not undergo NFKC normalization. `pdf.ts` uses NFKC only while folding lines for furniture detection. In addition, `paper-text.ts` joins every page’s lines with spaces, removing the heading boundary needed to reliably recognize a standalone `References` or `Bibliography` heading.

Evidence: `docs/plans/261001a-…md:137-153`; `src/paper-text.ts:172-207`; `src/pdf.ts:378-384,773-775`.

Fix: have the paper reader return structured pages/lines or preserve heading boundaries. Build one canonical representation—NFKC, whitespace normalization, and the existing named hyphen repair—before chunking, hashing, sending, and quote verification. Store selected chunk IDs or ranges and a selection hash, not only the word count.

### P-10 — P2 should fix — The content hash is provenance, not freshness, and the plan still calls the answer “current”

The plan stores `paper_content_sha` but deliberately omits it from the hash used to attach an investigation. Reading the stored answer does not refetch the paper, so the system cannot know whether remote content changed.

Evidence: `docs/plans/261001a-…md:175-181`; current attachment compares only the recomputable context hash at `src/citation-investigate-context.ts:139-179`.

Fix: state the narrower contract:

- `context_hash` determines whether the article/citation/prompt context still matches;
- an evidence hash covers the fetched content and selected chunks;
- the UI presents the answer as a dated snapshot, not as known-current remote evidence.

If remote freshness is required, only a refetch can establish it. This only partially answers earlier P-8.

### P-11 — P2 should fix — Stage 2 and Stage 3 omit several manual integration surfaces

Stage 2 refers to the registry title before Stage 3 stores a registry on citation rows. It can still land independently only if it explicitly calls `lookupWork` itself and defines behaviour for found, mismatch, not-found, and unavailable outcomes.

Adding `registry` and paper fields also touches manual projections and validators that the plan does not name: the public citation DTO, investigation row mapping, SSE runtime validator, exports, and UI label currently saying “the AI’s reading of web search extracts”.

Evidence: stage order at `docs/plans/261001a-…md:70,116,194`; current public projection at `src/public/dto.ts:542-564`; investigation mapping at `src/store/citation-investigation-row.ts:13-44`; runtime validation at `src/web/useCitations.ts:596-613`; current label at `src/web/CitationInvestigation.tsx:33`.

Fix:

- State that Stage 2 calls the shared lookup directly.
- Make registry fields optional in stored artifacts for old revisions.
- Name and test every manual projection/validator/export.
- Split current Stage 2 into a pure retrieval/identity/selection stage and an Investigate integration stage.
- Split Stage 3a and 3b; defer 3c.

## Earlier 260929g findings

| Earlier finding | Answered? | Assessment |
|---|---|---|
| P-1 — unchecked prose/output contract | Partly | The existing UI labels the prose as an AI reading and avoids categorical negatives. Paper-quote provenance is still unsound; see new P-1. |
| P-2 — wrong-paper title check | Partly | There is now an identity ladder, but identifier equality is tautological for a resolved, mistyped DOI; see new P-2. |
| P-3 — strict verifier/exact sent text | Partly | `"spaced"` and sent chunks are correct. Chunk-scoped IDs and replacement with the source slice are still missing. |
| P-4 — PDF ligatures/hyphenation | Partly | The plan intends NFKC and reuses hyphen repair, but current returned text is not NFKC and page/heading structure is lost. |
| P-5 — coverage | Mostly | Ranked chunks plus retrieved/sent word counts are good. Selected chunks/pages are not stored, and HTML coverage is overstated. |
| P-6 — prompt injection/fencing | Mostly | Evidence fencing, reminder, delimiter defusing, and no new tools are sound. Add adversarial paper-text fixtures and keep the verdict labelled as AI interpretation. |
| P-7 — complete resource envelope | No | The PDF parse deadline remains unenforced and no worst-case memory measurement is planned. |
| P-8 — stale stored checks | Partly | Selection version and content hash improve provenance, but content is not part of attachment freshness. |
| P-9 — duplicate presses/allowance | Mostly | Existing owner-wide concurrency-one admission is taken before spend. The lease needs extending, and saves remain unfenced if a lease expires during an overlong parse. |
| P-10 — provenance/schema | Partly / superseded | Reusing `citation_investigations` is reasonable now that paper reading is part of the same answer. Requested/final identity, selected chunk provenance, legacy nullability, and stronger checks still need definition. |

## Recommended scope and order

1. Shared bibliographic cache, JSON fetcher, per-identifier claims, and DB-wide service limiter.
2. Pure paper evidence package: bounded reading, canonical text, identity, chunk selection, and chunk-scoped quotation verification.
3. Investigate integration: nullable additive columns, UI/provenance, prompt, route, exports, and real runs.
4. PDF-reference identifier extraction.
5. Citation registry enrichment.
6. Debate enrichment.
7. Defer `cited_works` until there is a real current-membership query or a demonstrated need for the FK anchor.

The full row-per-revision move is too large. The proposed middle table is coherent only as an “ever-seen identity” table, but its stated query benefits are not real and its rollout adds disproportionate risk to the core paper-reading work.

**Overall verdict: build with changes.** The shared lookup and on-demand paper-reading direction are sound, and DataCite is a sensible arXiv-metadata route. The two P0 issues—source-scoped paper quotations and mistyped-identifier identity—must be redesigned before implementation, and §3c should be deferred.