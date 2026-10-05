The ranking’s centre is sound, but the plan is not safe to build as written. The main problem is identity: several successful imports cease to be findable by the address the reader originally pasted, causing duplicate paid ingests.

## Findings

### G1 — P0 — established: three paths can repeatedly charge for the same paper

Concrete sequences:

- **Design B:** paste an unrecognised DOI → it redirects to ACL/bioRxiv → the PDF is stored → only the PDF becomes `final_url`. Paste the identical DOI again and shelf lookup cannot find it, so a new article, reservation, and paid PDF pipeline are created. The plan explicitly accepts this at [lines 155–160](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:155>), but the new import is no longer today’s cheap stub: it is a model-read PDF.
- **NBER:** its resolver recognises only `/papers/w<N>`, not the resulting `/system/files/working_papers/...pdf`. Once the PDF is `final_url`, another paste of the landing page has a different key.
- **OSF:** `final_url` is an opaque signed Google Storage URL, not an OSF URL, so another paste of the same OSF landing page also misses.

Part 1’s `workKey` protects active jobs carrying the same original URL; it does not repair a completed article. `slugForUrlKey` and the client shelf index use only `final_url`.

Smallest credible fix: preserve the reader’s original pasted address as an article alias and make server and client identity checks index both that alias and the fetched/canonical address. Add completed-import and concurrent-job tests showing DOI, landing, and PDF forms return the existing job/article without taking another reservation. NBER’s PDF form must also resolve statically.

### G2 — P1 — established: OSF’s stored source expires and cannot be refreshed

The two measured OSF downloads redirect through `files.osf.io` to signed `storage.googleapis.com` URLs ([summary lines 151–154](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/evals/results/paper-sources-261005/summary.md:151>)). Part 1 stores the redirect destination as `final_url`.

Consequences:

- Refresh later fetches the expired signed URL, rather than stable `osf.io/download/<id>/`.
- The owner’s source link points to an expiring capability URL.
- Public provenance disappears because `publicSourceUrl` refuses query-bearing URLs.
- The plan recognises `_v<N>` but constructs `/download/<id>/`, dropping the requested version and potentially fetching the latest instead.

Smallest credible fix: defer OSF until the stable landing/download identity is stored separately from the network’s final redirect destination. Do not recognise `_v<N>` until a version-preserving download form is verified.

### G3 — P1 — established: a pasted bioRxiv full-text page becomes a slower paid PDF read

The resolver recognises `.full` and `.full-text`, then always puts `.full.pdf` first ([plan line 101](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:101>)). Yet the measurement shows `.full` already imports 7,515–9,803 words through the free HTML path ([summary lines 3–8](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/evals/results/paper-sources-261005/summary.md:3>)).

Concrete input: `https://www.biorxiv.org/content/10.1101/2025.08.25.672055v2.full`. Today it is a full HTML paper; after the plan it becomes a roughly ten-cent, one-to-three-minute PDF read.

Smallest credible fix: when the pasted shape is `.full` or `.full-text`, retain that HTML as the first candidate. Restrict the PDF optimisation to landing/abstract forms until the HTML-vs-PDF evaluation is complete.

### G4 — P1 — established: the measured CVF Swin case conflicts with the slug rule

The plan says a source returns `null` when its source-derived slug exceeds 60 characters and explicitly asks for an over-long CVF negative test ([lines 87–90](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:87>), [197–203](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:197>)).

The measured Swin identifier is 90 characters; a `cvf-…` slug is 94. Therefore one of the plan’s two CVF examples resolves to `null`, imports the 339-word landing page, and cannot satisfy “every measured paper ends on a PDF.”

Smallest credible fix: derive a bounded slug by deterministic truncation, as ordinary `slugFromUrl` already does. Keep the full identifier in `key`; do not reject a valid source merely because its human-readable slug is long.

### G5 — P1 — established: landing-page fallback permanently labels a stub as the paper

Sequence:

1. A guessed PDF returns 404/410 or HTML.
2. `fetchFirstCandidate` advances to the landing-page candidate.
3. The stub is stored with a `final_url` that resolves to the paper’s shared key.
4. Later, the reader pastes the actual PDF address.
5. `urlKey` says it is already on the shelf, so the reader keeps the stub rather than importing the paper.

A manual refresh could later upgrade it, but another paste—the normal recovery action—cannot.

Smallest credible fix: remove landing-page candidates and fail legibly when the guessed paper address is absent. The more complex alternative is to store “fallback/incomplete” state and permit a later full-text address to upgrade it.

### G6 — P1 — established: Design B needlessly refetches a document already in hand

Concrete injected sequence:

1. The initial URL redirects to a recognised landing page, which is successfully fetched.
2. Its PDF candidate returns 404.
3. The last candidate refetches that same landing page.
4. The second request returns 503.
5. The job fails even though it already held the usable landing page.

A shortener that ends directly on a recognised PDF similarly downloads the same PDF twice. This does not double the model charge inside one job—only the second document is stored and read—but it doubles network work and can turn success into failure.

Smallest credible fix: allow the first fetched document to satisfy a matching candidate, including the landing fallback. Test “first fetch succeeds, equivalent candidate would fail if called” and assert only one request.

The described control flow does enforce “resolve once”: second-loop documents are not re-resolved.

### G7 — P1 — established: Hugging Face/alphaXiv identity does not reach citation matching

`urlKey` uses `resolvePaperSource`, so the shelf, hover card, and link-facts treat Hugging Face and arXiv as one article. `identityOf`, `keysOf`, and citation address matching do not.

Concrete sequence:

1. An article cites `huggingface.co/papers/1706.03762` without separately printing the arXiv id.
2. Citations records it as an ordinary article URL.
3. Importing it stores arXiv’s PDF address, not the Hugging Face address.
4. Citation matching sees `url:huggingface…` versus an arXiv candidate and falls through to title matching, which can fail or be weaker.

Smallest credible fix: make citation identity source-aware: a URL resolving deep-equal to arXiv should yield the same arXiv work identity in both `keysOf` and `identityOf`. Add HF and alphaXiv citation tests, not only `urlKey` tests.

### G8 — P2 — established: the “worth code now” cut is internally inconsistent and too broad

- medRxiv failed all six measured requests with 403, yet Stage A adds it. The same plan later says “medRxiv … No code” ([line 261](</var/tmp/spideryarn-worktrees/fbayettj-other-paper-sources/docs/plans/261005m-a-landing-page-link-imports-the-paper-the-other-paper-sources.md:261>)).
- “Nine sources” is nine table rows but eleven named source objects: Hugging Face, alphaXiv, ACL, PMLR, NeurIPS, CVF, JMLR, NBER, bioRxiv, medRxiv, OSF.
- The assertion that all “worth code now” sources yielded the paper is false for medRxiv.

Smallest credible fix: remove medRxiv now and split the stage. I would build the verified AI-heavy core first: Hugging Face/alphaXiv, ACL, PMLR, NeurIPS, CVF, and JMLR. Add bioRxiv after G3; NBER after its PDF identity is fixed; OSF after G2. No additional source should be promoted now.

OpenReview and general `citation_pdf_url` following are correctly deferred. PubMed/PMC is correctly left to Greg: the available paths require either changing headers to get through a bot wall, adding an outside lookup, or adding JATS support.

### G9 — P2 — established evidence gap: several promised grammars and the robots conclusion remain unverified

- alphaXiv `/overview/<id>` is marked `[MEM]` and absent from `cases.json`.
- NeurIPS `-Conference` and other track endings are memory-only; the cases contain only ordinary `-Paper.pdf` examples.
- OSF `_v<N>` appears in the plan but nowhere in the research or cases.
- The raw notes explicitly say only the head and tail of bioRxiv’s robots file were read, so `/content/` being allowed was not proved.

The planned live check cannot settle shapes that are absent from its case file.

Smallest credible fix: either remove those recognised forms or add representative cases and verify them before implementation. Fully check bioRxiv’s applicable robots group before calling the external-access constraint satisfied.

### G10 — P3 — established: “174 addresses” is not the measured count

`results.json` has 174 rows but only 157 distinct `requestedUrl` values. Several addresses were deliberately exercised under multiple source/role labels.

Smallest credible fix: say “174 fetch cases over 157 distinct addresses” rather than “174 addresses.” The counts of 92 labelled papers and 45 measurement source groups are correct.

## Overall assessment

The high-level ranking is directionally right: the AI-conference core deserves priority, and the “do nothing” decisions for full-text landing pages and blocked publishers are sensible. OSF’s `/download/<id>/` route itself does not evade a wall or a recorded robots prohibition; it succeeded through the unchanged fetcher. Design B also does not widen SSRF access: both the initial redirect and every fixed candidate still pass through `fetchDocument` and its per-hop address checks.

The blockers are identity, repeat charging, source provenance, and the unintended conversion of already-good HTML into a paid PDF read. Those need to be resolved before implementation, not left to code review.

VERDICT: do not build