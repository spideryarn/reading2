Do not build this plan as written. F1 is an established P0: the `urlKey` rollout can charge one reader twice for the same ingest.

## Findings

### F1 — P0 — established: an active pre-deploy job can cause a second quota charge

(a) A queued `/pdf/` or `/html/` job retains its old persisted `url_key` and `work_key` ([store/jobs.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/jobs.ts:81), [schema.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/db/schema.ts:2694)). After deployment, `inFlightSlugForUrlKey` recomputes that job’s URL with the new resolver and adopts its slug ([jobs.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/jobs.ts:4322)), but the old persisted `work_key` does not match and an adopted request is outside `jobs_active_source`. A second job can therefore be inserted ([pg-jobs.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-jobs.ts:646)). Its new reservation cannot be released once attached to that job, and even an all-skipped successful job is strictly charged ([pg-session.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-session.ts:498), [pg-session.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/pg-session.ts:588)).

(b) Add after the `urlKey` bullet:

> **Deployment compatibility:** active jobs may carry pre-change `url_key` and `work_key` values. Before changing `urlKey`, add a red test that seeds queued `/pdf/` and `/html/` jobs with the old persisted keys and ingest reservations, then enqueues an equivalent canonical `/abs/` request. It must return the existing job and release the new reservation: one job and one slot. Implement either an atomic migration of both active keys or a race-safe hand-back of an adopted holder that `sameWork` considers equivalent under the current resolver. Do not rely only on keys persisted by the previous code.

### F2 — P1 — established: `sourceUrl` cannot become persisted `meta.url` under the current schema

(a) `writeRawSource` writes the candidate’s requested and final network URLs into `requested_url` and `final_url` ([artifacts-pg.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/artifacts-pg.ts:1197)). Extraction cannot overwrite the URL because `META_COLUMNS` deliberately excludes it ([artifacts-pg.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/artifacts-pg.ts:854)). `readMeta`, `metaFrom`, `urlForSlug`, cited-in-Spideryarn, exports, public projections and registry backfill all reuse `final_url`; passing `/abs/…` as `runExtract.sourceUrl` would therefore be discarded. The source link would remain `/html/…` or `/pdf/…`, and overwriting `final_url` instead would destroy the correct redirect base.

(b) Replace Caller 3 with:

> Keep three URL facts distinct. `RawManifest.requestedUrl` and `RawManifest.url` remain stage 1’s actual candidate request and final redirect address. Add a nullable `article_revisions.source_url`, owned by extraction, for the canonical article address; legacy rows read `source_url ?? final_url`. For URL-origin HTML, `runExtract.url` is `manifest.url ?? sourceUrl` and `runExtract.sourceUrl` is the canonical job address; uploads pass `null` for both. `Meta.url`, `urlForSlug`, shelf lookup, human-facing source links, public projections and article exports use `source_url ?? final_url`. Raw export preserves the actual requested/final pair. Consumers resolving relative links use the raw final URL, while cited-in-Spideryarn and registry backfill consider all three addresses. Add store round-trip, export/import, legacy-row and slug-based re-extraction tests proving `meta.url` stays `/abs/…` while relative links use `/html/…`.

### F3 — P1 — established: the fallback masks real failures and accepts a wrong-kind final response

(a) The plan catches every `FetchFailure`, although the fetcher distinguishes 404/410 from timeout, rate limiting, TLS/DNS errors, `too-large`, and `blocked-address` ([fetch.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/fetch.ts:1956)). It can hide the actionable HTML failure behind a later PDF failure. More seriously, the last candidate’s expected kind is not enforced: a PDF URL returning a long HTML challenge/error page is accepted as the paper. `fetchDocument` explicitly trusts bytes over the extension and classifies that response as HTML ([fetch.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/fetch.ts:2398)).

No SSRF bypass was found—the second request still traverses the existing defence—but its first refusal can be concealed.

(b) Replace the candidate-skipping bullets with:

> ArXiv advances from HTML to PDF only when the HTML representation is absent (`not-found`, HTTP 404/410) or a successful response has the wrong detected kind. Timeout, DNS, TLS, redirect, rate-limit, forbidden, blocked-address, too-large, empty and other failures propagate after `fetchDocument` completes its own retries. Every candidate, including the last, must match `expect`; a last mismatch is a typed failure and stores nothing. The HTML candidate must also carry the source’s full-paper marker (`article.ltx_document`), so a 200 HTML error or challenge is not accepted as the paper. Add tests for first-candidate 503, timeout, blocked-address and too-large; a 200 HTML error page; and a PDF candidate serving HTML.

### F4 — P1 — established: redirect-discovered sources cannot be “one more object”

(a) `PaperSource.resolve(URL)` runs before fetching and can express only candidates derivable from the pasted URL. The plan itself acknowledges that a DOI may redirect into a publisher source only after the resolver has run ([plan, “What is not in this plan”](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md:161)). Adding such a source requires a new pipeline caller and source-specific acceptance policy, contradicting “one object in `SOURCES`; callers unchanged.”

(b) Replace that claim with:

> A statically recognisable source whose identity and candidates are derivable from the pasted URL is one `SOURCES` object. The registry also exposes a bounded post-fetch transition: after a guarded fetch, the current source may inspect the guarded result’s final URL and declared scholarly metadata and return further candidates while preserving the original work identity. Every discovered candidate re-enters `fetchDocument` unchanged; visited targets are rejected and source transitions are capped. Candidate absence and acceptance policy belong to the source object. Add a DOI → publisher redirect fixture proving that registering the publisher requires no pipeline-caller change.

### F5 — P1 — reasoned: the shared parser needs explicit origin and identity boundaries

(a) `normaliseUrl` preserves non-default ports, while current `identityOf` explicitly treats them as different services ([cited-in-spideryarn.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/cited-in-spideryarn.ts:101)). A hostname-only matcher would rewrite `https://arxiv.org:444/abs/2608.13566`, which is not the canonical arXiv service.

Separately, import identity must retain `vN`, but cited-work identity deliberately strips it: current tests require a citation for `2001.08361` to match an article at `2001.08361v2` ([cited-in-spideryarn.test.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/tests/cited-in-spideryarn.test.ts:59)). Reusing `ResolvedPaper.id` literally would break cited-in-Spideryarn and DataCite lookup.

(b) Replace the shared-pattern paragraph with:

> A source matches an allowed origin, not a hostname alone: require HTTP(S), no credentials and no non-default port before matching host and path. The shared arXiv parser returns both `versionedId`, used by imports, candidates, canonical URLs and `urlKey`, and versionless `workId`, used by `identityOf`, `parseWorkId`, citations and registry lookup. `paper-sources.ts` also owns `arxivIdOfDoi`; `source-guess`, `paper-evidence`, `identityOf` and `arxivPdfUrl` consume these helpers. Add non-default-port near-misses for both arXiv and DOI hosts, and retain the existing any-version cited-work tests.

### F6 — P1 — reasoned: LaTeXML rewrites 1 and 3 can destroy authored content and cross-reference targets

(a) Real LaTeXML equation tables contain row and formula IDs, not merely an outer table ID—for example `tbody#S3.Ex1` and `math#S3.Ex1.m1` ([ar5iv.html](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/evals/extraction/fixtures/ar5iv.html:286)). Existing `canonicaliseMaths` refuses a replacement if any descendant ID is a fragment target because stage 3 otherwise cannot retarget the link ([maths-import.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/maths-import.ts:161)). The proposed equation replacement keeps only the table ID.

Likewise, converting a listing with `textContent` can delete links, descendant anchors or non-line siblings. Class names alone also do not prove a page is LaTeXML. The equation selector covers alignment shapes it has not measured; one formula cell must not acquire an artificial `&`, and multiple numbered rows cannot be represented by one number “beside” the group.

(b) Insert before the fixes and narrow fix 1:

> The pass first requires the target to be beneath `article.ltx_document`; target class names alone are not provenance. Every destructive rewrite requires a documented direct-child topology with no additional authored nodes. It preserves the container ID and every externally targeted descendant `id`/`name`, or leaves the source unchanged.  
>  
> Fix 1 initially handles only the measured `ltx_eqn_align` layouts: one semantic formula cell is emitted with no `&`, two with one `&`, and every other cell or numbering topology is left unchanged. Preserve row targets and refuse multiple independently numbered rows until their numbers and anchors can be retained. Add separate fixtures before admitting `eqnarray`, `gather`, `multline` or `split`.  
>  
> Fix 3 requires direct line children plus whitespace only and moves their child nodes into `<pre>` separated by newline text nodes; it does not flatten them with `textContent`. Add negative fixtures for a descendant fragment target, linked code token, extra sibling and identical classes outside `article.ltx_document`.

### F7 — P1 — established: “stamp the table” omits the mandatory Readability rollback

(a) `protect.ts` says `KEEP_CONTENT` must never be placed on a table, and demonstrates that even weightless `KEEP_COLUMN` can make a table win candidacy and delete surrounding prose ([protect.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/protect.ts:33)). Every protection rule must participate in treatment/control rollback through `RULES`, `ProtectOptions` and `WITHDRAWALS`. The plan neither identifies the Readability branch nor chooses a token or rollback.

(b) Replace fix 4 with:

> **4. A data table inside a list item survives without displacing prose.** First reproduce and name the exact Readability branch that removes the target. If it is the early `header` match caused by `ltx_guessed_headers`, apply only the weightless `KEEP_COLUMN` token; never put `KEEP_CONTENT` on a table. Give the rule its own `RULES` key, `ProtectOptions` switch and `WITHDRAWALS` entry so `armThatKeptTheProse` compares treatment with control. Test the real target and a full-page adversarial fixture with substantial prose before and after a table large enough to win candidate scoring; that fixture must roll the rescue back rather than lose prose. If the deletion is from a branch `KEEP_COLUMN` cannot safely defeat, do not stamp it.

### F8 — P1 — established: SVG hosting is forbidden, but the image repair need not be abandoned

(a) `sniffImage` deliberately refuses SVG because the owned `blob:` delivery path does not preserve a sandbox CSP ([assets.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/assets.ts:800)); Supabase independently rejects `image/svg+xml` ([blobs-supabase.ts](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/src/store/blobs-supabase.ts:41)). Thus fix 2 cannot make stage 4.5 host the SVG. However, an unsupported `<img>` is already recorded as `unsupported-format` and remains hot-linked, so the conversion can restore the five missing plots without editing the defence.

(b) Replace fix 2 with:

> **2. An SVG plot in an `<object>` becomes an image without hosting SVG.** For an otherwise-empty `object[type="image/svg+xml"][data]` beneath a LaTeXML figure, create an `<img>` whose `src` is `data`, preserving the object’s `id`, dimensions and applicable accessibility attributes. Objects with fallback children remain unchanged. Do not add SVG to `AssetExt`, `SIGNATURES`, the bucket MIME allowlist or the owned-asset route: stage 4.5 records `unsupported-format`, after which the existing failed-asset behaviour leaves the publisher SVG hot-linked. Test the DOM conversion, manifest failure, reader fallback and that no defence file changes.

### F9 — P1 — established: the eval supports cost and time, not the claimed correctness conclusion

(a) In commit `1459ef9d3`, the investigation says HTML won four of five judgments, but its committed table contains four completed judgments: three HTML, one PDF, with the fifth pending ([investigation](/var/tmp/spideryarn-worktrees/fbayettj-arxiv-import/docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md:90)). The judges did not inspect page images and PDF figure recovery was not run, so figure correctness was not compared. The proposed repairs were not run or judged. Finally, a known boxed passage loses 58 authored words but is classified as “cosmetic”; that contradicts “correct first.”

The numbers do support the narrower result: HTML extraction cost $0 and took 3–41 seconds; PDF extraction cost $0.0875–$0.1328 and took 92–164 seconds, totalling $0.6167.

(b) Replace the correctness conclusion with:

> On this purposive six-paper sample, HTML was decisively cheaper and faster at extraction. Of the four completed arm judgments in this committed run, HTML was preferred on three and PDF on one. Figure correctness was not compared: judges did not inspect page images and the PDF figure-recovery stage was not run. The run measured the current extractor, not the proposed repairs. The 4-of-36 probe describes only the sampled categories and is not a general arXiv prevalence estimate. HTML-first remains gated until every authored-content loss below is repaired and the same rubric is rerun, including the end-to-end figure paths.

Replace the boxed-passage exclusion with:

> **5. A boxed authored passage keeps its words.** Cut a fixture from the `tcolorbox` in `2608.13566`, trace why its 58 words disappear, and preserve its text and links without weakening sanitisation. HTML-first is not enabled until this fixture passes; if it cannot be repaired safely here, return the format choice for a decision rather than calling the loss cosmetic.

### F10 — P2 — reasoned: the interface may land first, but HTML-first activation should not

(a) The plan intentionally enables HTML-first before known equation, image, listing and table losses are fixed. A session interruption can leave trunk selecting the known-broken path indefinitely. Any affected article later repaired by re-extraction will correctly mint new IDs for changed blocks under the block-ID contract, potentially orphaning state attached to the broken text; the “brief window” is therefore not necessarily transient for imported data.

(b) Replace the stage-order paragraph with:

> The pure resolver types and registry may land first so part 2 can compile against them, but arXiv’s shipping candidate order remains disabled—or PDF-first—until the LaTeXML repairs pass their fixtures and the correctness rerun is recorded. The commit that activates HTML-first includes that evidence. Re-extraction tests assert that unchanged blocks retain their IDs and every block whose text changes receives a new ID, as required by `block-ids.md`.

The guarded fetch path itself is otherwise sound: fixed candidate URLs still traverse `fetchDocument` unchanged, uploads exit before URL resolution, and resolving inside the fetch step covers retries and refreshes. I reviewed the committed objects because the working tree contains later uncommitted eval changes; I changed no files.

VERDICT: do not build