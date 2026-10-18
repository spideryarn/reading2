No P0 findings. The overall design is viable, but several P1 issues would undermine the promised identity guarantee, prevent the Semantic Scholar cascade from working, or duplicate paid work.

1. **P1 — `resultIsTheWork` cannot support “the work’s own page, never someone else’s.”**

   Evidence: the plan makes that absolute promise at `docs/plans/261018o-citation-notes-web-search-for-the-clicked-work-and-registry-keys.md:17-21` and relies on `resultIsTheWork` at `:173-176`. The function itself warns that it cannot distinguish a paper from a page merely titled like it (`src/citation-lookup.ts:37-40`). It accepts any URL containing the DOI (`src/citation-lookup.ts:331-340`) and, when author/year are unavailable, any page with the whole title (`:350-356`). Tests deliberately accept an arbitrary blog and publisher path (`tests/citation-lookup.test.ts:233-245`, `:295-318`). The bibliography documentation already describes this as a match, not proof (`docs/project/bibliography.md:650-658`, `:710-715`).

   Concrete fix: for this feature, accept only destinations whose canonical identifier can be parsed exactly: DOI resolver/known registry pages with the exact DOI, exact arXiv `/abs/` or `/pdf/` identifiers, and similarly tight provider-specific rules. Do not create title-only web notes in v1. The alternative is to change the promise to “looks like the work’s page,” but that reopens Greg’s explicit 1B choice.

2. **P1 — The planned Semantic Scholar batch cannot be sent through the current fetch API, and the limiter migration is incomplete.**

   Evidence: the plan adds only a `registryKey` option to `fetchBibliographicJson` (`plan:63-66`) but calls Semantic Scholar with one batch `POST` (`:91-96`). `fetchBibliographicJson` exposes no method or body (`src/fetch.ts:2657-2667`, `:2698-2721`), while the underlying request is hard-coded without either (`src/fetch.ts:2383-2391`). Its 1 MiB response limit (`:2620-2627`) may also be too small for 150 abstracts. In addition, adding the enum at `src/bibliographic.ts:67-73` is insufficient: permitted services and seeded slots are constrained in `src/db/schema.ts:8479-8510`, and startup expects the current three services in `src/store/pg-bibliographic.ts:61-63`.

   Concrete fix: add a narrow `fetchSemanticScholarBatch(ids)` path in `fetch.ts`, with a fixed host/path, `POST`, JSON content type, bounded body, timeout, and an explicitly justified response cap or smaller chunks. Add `semantic-scholar` to the database constraint, seed one service row/slot, update expected-slot validation, and test both missing and present rows. Do not turn the generic bibliographic fetcher into an arbitrary-method/arbitrary-body SSRF surface. Semantic Scholar documents the batch endpoint, up to 500 IDs, and the `x-api-key` header in its [official API documentation](https://api.semanticscholar.org/api-docs/).

3. **P1 — Existing blurbs will not acquire the newly available sources “on their next run.”**

   Evidence: the plan says no evidence-domain or validation-version change is required and that an article gains the new sources on its next run (`plan:111-114`). But entries with matching identity, prompt, model, and validation stamps are reused before evidence lookup (`src/citation-blurbs.ts:666-720`). `citationBlurbsExpectedHash` contains no registry-capability/source-set stamp (`src/citation-blurbs-identity.ts:78-122`). The evidence-domain comment explicitly says to bump it when what counts as evidence changes (`src/citation-evidence.ts:91-99`).

   Concrete fix: add a source-policy stamp derived from enabled sources—at least abstract-only versus Semantic Scholar/OpenAlex cascade—to the job input hash and per-entry reuse predicate. Keep old notes readable until refresh, but make enabling a key stale the relevant generation. Bump `EVIDENCE_HASH_DOMAIN`; the validation version may remain unchanged because the checks themselves are unchanged. G1/G2 partial-result semantics remain sound once errors and negatives are classified correctly.

4. **P1 — Storage needs an atomic claim, transient failure handling, and inclusion in reader-data workflows.**

   Evidence: the plan promises only one first-press request (`plan:155-158`) but its table has only `note | none` (`:195-202`), so two simultaneous presses can both observe absence and spend. It also turns every unsupported or failed check into a seven-day negative (`:181-185`), although `readCheckAnswer` distinguishes substantive rejection from transient malformed/cut-off output (`src/citation-blurbs.ts:394-413`), and call failures are transient (`:543-575`). The proposed columns omit the described `owner_id` and `why`. Existing claimable work uses a lease, token, and fenced finish (`src/store/pg-source-guesses.ts:41-127`). Reader-owned state is explicitly inventoried for export and rollback (`src/store/article-rows.ts:214-230`, `:988-997`; `src/store/pg-article-transfer.ts:202-222`; `src/store/export.ts:928-953`).

   Concrete fix: keep the separate `citation_web_notes` table—it is cleaner than overloading generated `citation_blurbs` or saved `citation_finds`—but give it `searching | note | none`, `owner_id`, `why`, `claim_token`, `claimed_at`, and `checked_at`. Claim atomically; fence completion by token; release on provider/model/store failure. Cache only completed “no acceptable result” outcomes for seven days. Add the table to deletion, owner transfer, ArticleRows, export/rollback, and their contract tests. Attach by identity against the stored bibliography row, as blurbs currently do (`src/store/pg.ts:4466-4470`).

5. **P1 — A normal Semantic Scholar key is not an adequate commercial-use gate.**

   Evidence: the plan proposes building the path key-gated and asking Greg about attribution later (`plan:27-42`). Semantic Scholar’s current standard API licence limits ordinary use to non-commercial research and education, requires attribution, and directs commercial users to request expanded licensing: [Semantic Scholar API licence](https://api.semanticscholar.org/license/). Key presence does not demonstrate that permission.

   Concrete fix: build the integration dormant, but require a separate explicit approval flag—such as `SEMANTIC_SCHOLAR_COMMERCIAL_USE_APPROVED=true`—in addition to the key before making requests. Ask Greg to obtain written expanded/commercial permission for this paid product, then implement the returned attribution/logo conditions before activation. The OpenAlex work need not wait.

6. **P2 — The cascade needs explicit phases and an OpenAlex-specific adapter.**

   Evidence: the plan wants one Semantic Scholar batch containing ID rows plus DOIs discovered by title lookup (`plan:80-104`). The current collector launches per-row identifier and title work concurrently (`src/citation-evidence.ts:555-618`), and a Crossref title match without an abstract returns immediately (`:485-497`), so no single complete batch exists without restructuring. The shared strict rule is currently coupled to Crossref-like fields and vocabulary (`:275-324`).

   The Semantic Scholar rule—normalized external ID equality plus strict title agreement—is appropriately conservative, provided returned IDs are reparsed rather than trusted. OpenAlex needs adaptation:

   - The documented parameter is `per_page`, not `per-page`.
   - Broad `search=` covers title, abstract, full text, and other fields; use `search.title`.
   - `display_name` is the work title.
   - Authorships expose explicit byline position; select `author_position === "first"` and prefer `raw_author_name`.
   - Its work-type vocabulary contains values such as `book-review`, `erratum`, `retraction`, and `paratext`, so raw values cannot be passed into Crossref’s allow/refuse lists.

   These are documented in the official [OpenAlex search](https://help.openalex.org/api/searching/), [work fields](https://help.openalex.org/data/works/attributes/), [authorships](https://help.openalex.org/data/authorships/), and [work types](https://help.openalex.org/data/work-types/) references.

   Concrete fix: define three phases: resolve direct registry records and strict title matches into canonical work IDs; deduplicate unresolved IDs and perform bounded Semantic Scholar batches; then perform OpenAlex DOI reconstruction as fallback. Add an OpenAlex adapter that emits normalized title, first author, year, DOI, and semantic kind, and construct queries with `URLSearchParams`, `search.title`, `filter=has_doi:true`, `per_page=5`, and a small `select`. A Semantic Scholar outage or bad optional key should fall through to existing OpenAlex behavior rather than suppress it.

7. **P2 — `admitDig` is the wrong allowance.**

   Evidence: the plan describes it as the existing per-work press allowance (`plan:166-167`). In fact, `admitDig` is shared by relatively expensive Dig deeper requests and permits 20/hour and 60/day (`src/dig-deeper.ts:117-143`, `:166-190`). Bibliography investigate deliberately has a separate tighter allowance (`src/citation-investigate.ts:240-278`; `src/routes.ts:12212-12216`; `docs/project/bibliography.md:688-697`).

   Concrete fix: create a `citation-web-note` allowance with its own measured spend ceiling, concurrency one, global fuse, and lease cleanup. Take it only after owner/current-row/cache/claim refusals, and release it in `finally`. Sharing `admitDig` would let cheap citation lookups starve unrelated Dig deeper work and vice versa.

8. **P2 — The validation sequence is broadly right, but its prompt and read boundary are not yet safe enough.**

   Evidence: annotation validation → identity → self/copy rejection → `judgeNote` → independent support check is the correct order (`plan:168-185`). However, `checkRequest` tells the model the evidence is an “abstract” (`src/citation-blurbs.ts:453-474`, system wording at `:177-186`). Search extracts are explicitly hostile model input (`src/citation-lookup.ts:42-52`), and prompt fencing is mitigation, not a security boundary (`docs/project/security.md:923-934`). `isWebUrl` accepts URLs containing credentials (`src/urls.ts:37-44`, `:617-623`). Existing search code caps titles and reconstructs stored fields (`src/citation-find.ts:646-669`), while blurb attachment uses a strict read guard (`src/citation-blurbs-identity.ts:139-189`).

   Concrete fix: factor a provenance-neutral support checker, or make a separately versioned web-extract checker. Give it no tools and fence the extract, while retaining quote substring validation. Add a `shownWebNote` read guard that reconstructs every field, caps sentence/quote/title/URL lengths, requires `isWebUrl && !hasCredentials`, recomputes the host, validates the identity/version, and renders all text as React text. Never expose it through the public DTO. Document prompt injection as residual risk rather than claiming the quote/check pair eliminates it.

9. **P2 — Stages-only SSE is a defensible exception, but the plan must state the lifecycle and the exception honestly.**

   Evidence: the repository says to stream any model call a person waits for (`docs/project/reading-view-overview.md:47-49`), whereas the plan sends only progress stages because no prose is safe before both validations (`plan:187-189`). There is precedent for stages followed by a validated whole result (`docs/project/skim.md:1017-1023`). The existing investigate route deliberately lets paid stored work finish after disconnection (`src/routes.ts:2288-2306`, `:2336-2382`).

   Concrete fix: retain stages-only SSE; streaming a sentence that may later be rejected is worse. Record this as an explicit bounded exception in the owning bibliography documentation, with the reason. Specify that once the atomic claim and paid work begin, the server finishes and stores the result after client disconnect; before work begins, a dead connection releases the claim without spending. Also resolve the client ambiguity: `plan:155-158` says only the hover-card “Open in Sources” starts work, while the test at `:229` says a row press starts it. Test the hover callback, not an ordinary Sources-row click (`src/web/ProseHoverCard.tsx:848-861`; `src/web/Reader.tsx:1757-1765`).

10. **P3 — The current header-based key design is sufficient; the older append-and-redact approach would not be.**

    Evidence: the current plan correctly keeps both secrets out of URLs and uses `Authorization: Bearer`/`x-api-key` headers (`plan:57-68`), which OpenAlex officially supports: [OpenAlex authentication](https://help.openalex.org/api/authentication/). `FetchFailure` retains an enumerable URL and underlying causes (`src/fetch.ts:703-735`), so putting a secret in a query parameter and redacting just the top-level URL would be fragile. Today, structured logging omits `error.url` while traversing causes (`src/log.ts:87-114`); Sentry disables request/fetch/linked-error integrations (`src/monitoring.ts:73-103`) and rebuilds sanitized errors (`src/monitoring-scrub.ts:193-251`). Bibliographic cache rows contain public metadata, not request URLs (`src/db/schema.ts:8332-8386`), and the AI ledger stores metrics rather than prompts, responses, or URLs (`src/store/ai-calls-pg.ts:9-15`). Current bibliographic log lines report service/ID/status, not complete URLs (`src/bibliographic.ts:573-609`; `src/citation-evidence.ts:411-422`).

    Concrete fix: keep secrets exclusively in headers and never implement query-string fallback or URL redaction as the primary defence. Add forced HTTP-status and network-failure tests proving that the key appears in neither `FetchFailure`, serialized logs, Sentry events, nor stored rows, and test that each header is sent only to its exact configured host.

VERDICT: proceed with fixes