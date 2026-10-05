The revised cut is sound, and the repeat-charge defect is closed for the seven retained sources. Two P1 issues remain: G7 is not actually fixed, and the new missing-PDF failure tells the reader the wrong thing.

## G1–G10

| Finding | Status | Trace |
|---|---|---|
| G1 | **Closed for this build** | Redirect discovery, NBER, and OSF are deferred. For every retained source, the pasted form, candidates, and real redirect destination must share a `urlKey` ([plan lines 87–93](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:87>), live gate at [line 206](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:206>)). That is sufficient for active-job and completed-shelf deduplication. The deferred follow-on has the separate G14 flaw below. |
| G2 | **Closed** | OSF is deferred until stable asked-for identity exists; its signed Google URL is no longer stored by this build. |
| G3 | **Closed** | bioRxiv and medRxiv are deferred together with an explicit requirement that pasted `.full` HTML remain HTML ([line 236](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:236>)). |
| G4 | **Closed** | The full identifier remains in the key while the display slug is cut. `freeSlug` subsequently applies `slugWithShortId`, which trims again to make room for the random id. Two CVF names sharing 60 characters therefore have distinct keys and independently unique final slugs. |
| G5 | **Closed, but the fix opened G12** | Landing-page fallback is gone, so a stub cannot occupy the paper’s identity. The resulting failure copy is misleading. |
| G6 | **Closed** | Redirect discovery—and therefore its redundant second fetch—is deferred, with the requirement recorded in that row. |
| G7 | **Still open — G11** | The planned `identityOf` and `arxivPdfUrl` tests do not close the cited-work side of matching, and neither function currently calls `arxivIdOf`. |
| G8 | **Closed** | The plan now builds the recommended AI-heavy core: two arXiv mirrors plus ACL, PMLR, NeurIPS, CVF, and JMLR. |
| G9 | **Closed as a build gate** | Unverified retained shapes must be live-checked or removed: alphaXiv `/overview`, NeurIPS tracks, HTTPS PMLR layouts, and old ACL DOI ([lines 206–213](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:206>)). OSF and bioRxiv evidence gaps left the build. The facts are not yet measured, but the plan cannot declare the stage done without measuring them. |
| G10 | **Closed** | Both plan and research now say “174 fetch cases over 157 distinct addresses.” |

## New findings

### G11 — P1 — established: G7’s revised fix cannot produce the claimed citation match

At `0f63486a2`:

- `arxivIdOf` has **no production callers**; only `tests/paper-sources.test.ts` calls it.
- `cited-in-spideryarn.ts::identityOf` imports only `ARXIV_ID_PATTERN` and maintains its own host/path parsing.
- `paper-text.ts::arxivPdfUrl` also maintains its own arXiv-only parser.
- More importantly, `citations.ts::keysOf` still keys a cited Hugging Face or alphaXiv link with `linkFrom: "article"` as `url:huggingface…`.

Concrete sequence:

1. An article cites `https://huggingface.co/papers/1706.03762`.
2. `identifiersIn` does not recognise that as arXiv, so the work remains `linkFrom: "article"`.
3. `keysOf` produces `url:huggingface.co/papers/1706.03762`.
4. Importing the link stores arXiv’s PDF as the article’s final address.
5. The candidate therefore has arXiv identity, but `sameIdentifier` compares it with the cited work’s `url:` key and fails.
6. Matching falls back to title/author heuristics, exactly as in G7.

Making `identityOf` understand Hugging Face does not repair step 3. The proposed tests at [lines 192–193](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:192>) would all pass while the end-to-end match remained broken.

Smallest credible fix: make `identityOf`, `arxivPdfUrl`, and the cited-work side in `keysOf` use `arxivIdOf`. Add a `matchOf` test whose work URL is Hugging Face/alphaXiv and whose candidate URL is the stored arXiv PDF. Preserve `workId` for matching and `versionedId` when choosing the PDF.

### G12 — P1 — established: a missing derived PDF blames the reader’s valid address

For the only or final candidate answering 404/410:

`fetchFirstCandidate` → `fetchStepFailure` → `fetchFailed("not-found", …)` produces:

> There is no page at that address. The site said so, and trying again will get the same answer. Check the address for a slip or a missing part, and add it again. [fetch-not-found]

But the visible address the reader pasted is the valid ACL/PMLR/NeurIPS landing page. The absent address is a derived PDF URL they never saw. Checking and adding the original address again simply repeats the failure.

This path does **not** charge the reader:

- `fetch` is the first default ingest step, so no model call has happened.
- No raw document is stored.
- A failed ingest releases its quota reservation; billing defines a slot as a successful ingest.

Smallest credible fix: map terminal absence for a resolved paper source to source-aware copy such as: “The paper page exists, but the paper file was not where this source says it should be. Download the PDF and upload it, or report the link.” Keep it blocked, not retryable.

### G13 — P2 — established: failed grammar rules do not produce the promised source/tried log

The plan says a rule that keeps missing will show up because the log carries the source and candidate count ([lines 133–137](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:133>)).

At `0f63486a2`, that log runs only after `fetchFirstCandidate` returns successfully. On terminal failure:

- `tried` is never returned.
- The pipeline never constructs `via`.
- The diagnostic contains only the fixed fetch code and optional HTTP status.

Thus repeated bad NeurIPS/PMLR rules are indistinguishable from ordinary missing pages in logs.

Smallest credible fix: have the paper-source caller catch the terminal failure and record fixed source name plus attempted count before rethrowing. That requires a small change to the loop’s failure result/error metadata, contrary to [“the fetch step’s loop” is untouched](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:144>).

### G14 — P2 — established: the deferred alias design relies on the wrong `requested_url`

The deferred redirect design says `article_revisions.requested_url` already holds the address the reader asked for ([lines 163–171](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:163>)).

For a resolved source, it does not:

1. The pipeline calls `fetchDocument(candidate.url)`, not `fetchDocument(job.url)`.
2. `FetchedDocument.requestedUrl` is therefore the derived candidate.
3. `writeRaw` copies that into the manifest.
4. Publication copies it to `article_revisions.requested_url`.

A future redirect-discovery second fetch would likewise replace the first fetch’s original requested URL with the candidate’s URL.

Smallest credible fix: the deferred work must persist `job.url` as an explicit article alias independently of the fetched document’s `requestedUrl`; do not claim the existing revision column already supplies it. This does not block Stage A.

## Caller trace and consequences of “the mirrors are arXiv”

At `0f63486a2`:

- `arxivIdOf`: no production callers.
- `resolvePaperSource`:
  - `pipeline.ts`: chooses arXiv’s candidate PDF for mirror links.
  - `ingest.ts::urlKey`: gives mirrors and arXiv one article identity.
  - `ingest.ts::slugFromUrl`: gives every form the arXiv base slug.
- `urlKey` then feeds:
  - `workKeyFor`, `sameWork`, active-source uniqueness, in-flight lookup, retries, and `freeSlug`;
  - completed-article lookup in `store/find-article.ts`;
  - the browser shelf index and link hover behavior in `web/link-facts.ts`.

The ingest/deduplication effects are correct. The surprising, deliberate consequences are:

- The revision’s source address is arXiv’s candidate/final URL, not Hugging Face or alphaXiv; the source link opens arXiv as the plan explicitly decides.
- A Hugging Face link in article prose is shown as the arXiv article already in the library, may be marked as a self-link, and its separate mirror-page preview and relation summary are suppressed.
- Once `identityOf` is correctly refactored, bibliographic lookup and paper-evidence checks will also treat the mirror address as arXiv.
- `arxivPdfUrl` will bypass the mirror page and read arXiv’s PDF directly.

Those are coherent with the recorded product decision, but the mirror page’s own commentary is intentionally discarded.

## Identity, NeurIPS, and PMLR

The final-address rule is sufficient against G1 for the retained sources. The completed shelf lookup compares the pasted link’s key with `urlKey(final_url)`; the proposed live assertion proves those meet. Candidate-address unit tests plus real final-address checks cover both static forms and redirects.

The other raised identity cases are safe:

- A cut source slug is only a readable base; `slugWithShortId` supplies uniqueness.
- Two CVF names sharing the first 60 characters retain different full keys and get different random final slugs.
- Mirror versions remain distinct ingest keys, while scholarly citation identity can use `workId`.

NeurIPS’s revised rule is the right one: transform the suffix actually present, `Abstract[-track]` → `Paper[-track]`, and remove any unverified track shape. PMLR’s two candidates are correctly both PDFs; newer layout first, older flat layout second. Both PDF forms must resolve to the same key, as the tests require.

## The cut

Yes. The seven retained sources are the right first slice.

- DOI/redirect discovery, OSF, and NBER correctly wait for durable asked-for identity.
- bioRxiv/medRxiv correctly wait for the HTML-versus-PDF evaluation and access evidence.
- Generic `citation_pdf_url` following deserves its own stub-classification design.
- OpenReview needs a production-network result.
- HAL is an extraction/challenge-detection bug, not a paper-source rule.
- PubMed/PMC correctly remains Greg’s decision because it combines a deliberate User-Agent change around a bot wall with a new NCBI lookup.

No network was used and no file was changed.

VERDICT: build it after fixing G11–G14