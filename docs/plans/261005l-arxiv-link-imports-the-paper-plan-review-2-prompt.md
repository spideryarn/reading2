# Review, round 2: the plan for arXiv links, after your ten findings

Repo: this worktree, branch `worktree-fbayettj-arxiv-import`. TypeScript + ESM.

## The candidate

Committed: commit `b5a3678f2` (on top of `1459ef9d3`, which you reviewed).
`git diff 1459ef9d3..b5a3678f2 -- docs/plans/261005l-an-arxiv-link-of-any-shape-imports-the-paper-and-a-source-resolver-other-sources-can-join.md docs/investigations/261005e-arxiv-html-rendering-against-its-pdf-through-our-pipeline.md`

Your round-1 review is `docs/plans/261005l-arxiv-link-imports-the-paper-plan-review-sol.md`.

## What this round is

Discovery is closed. This is a check **of the fixes to your established P0 and P1 findings**, and
of nothing else: for each row below, is the plan's statement now accurate against the code, and
does the fix introduce a new P0 or P1? Do not re-open the design.

## What you can and cannot run, and what you may change

The tree is read-only. You have no network. You can run one test file and scripts under `/tmp`.

## Previous findings

| ID | Finding, verbatim (first sentence) | Disposition | What changed |
|----|-------------------|-------------|--------------|
| F1 | an active pre-deploy job can cause a second quota charge | fixed, differently from your (b) | § Caller 1, "Jobs already queued when this deploys": `inFlightSlugForUrlKey` compares the **unresolved** key of an active job's address (what it was queued as), and every new job is queued with the canonical `abs` address via a new `sourceAddress`, so new jobs match from any shape and a pre-deploy `pdf/` job is simply not adopted (today's behaviour: a second article) |
| F2 | `sourceUrl` cannot become persisted `meta.url` under the current schema | accepted; design changed | No `sourceUrl`, no new column. The article's address stays `final_url` (the HTML or PDF address). `urlKey` resolving is what joins that to a pasted `abs` link. The extract step passes the manifest's final URL as `runExtract`'s `url`. The abstract-page source link is a question for the owner |
| F3 | the fallback masks real failures and accepts a wrong-kind final response | fixed | § Caller 2: only 404/410 or a wrong kind (or a missing HTML marker) moves on; every candidate must match `expect` |
| F4 | redirect-discovered sources cannot be "one more object" | accepted as wording, not built | § the registry: the claim is narrowed to sources recognisable from the pasted address |
| F5 | the shared parser needs explicit origin and identity boundaries | fixed | origin rule; `versionedId` and `workId` |
| F6 | LaTeXML rewrites 1 and 3 can destroy authored content and cross-reference targets | fixed | § Stage "the HTML arm's faults": the three rules, narrowed shapes, negative fixtures |
| F7 | "stamp the table" omits the mandatory Readability rollback | fixed | fix 4 |
| F8 | SVG hosting is forbidden, but the image repair need not be abandoned | agreed | fix 2 |
| F9 | the eval supports cost and time, not the claimed correctness conclusion | fixed in the write-up; one part overruled | 261005e § The answer and "What this did not measure"; the boxed passage is fault 7. Overruled: HTML-first is not gated on fix 7 if fix 7 would need the sanitiser's policy changed; it is then recorded and reported |
| F10 | the interface may land first, but HTML-first activation should not | accepted | the first stage ships arXiv's candidates as `[pdf]` only |

Treat the fixes as unreviewed work by someone else. Spend most of the run on F1 and F2, which
changed the design:

- **F1.** Trace `enqueue` in `src/jobs.ts` (`freeSlug`, `slugAlreadyHolding`,
  `inFlightSlugForUrlKey`, `sameWork`, the `sourceTaken` and `nameTaken` repairs,
  `handBackToARetry`), `workKeyFor` in `src/store/jobs.ts` and the insert in
  `src/store/pg-jobs.ts`, under the proposed change: `urlKey` resolves; the in-flight lookup uses
  the unresolved key of `job.url`; new requests arrive with `url` already canonical. Is there still
  a sequence, at deploy or after it, in which one reader is charged twice for one address, or two
  active jobs hold one article unrecognised as the same work? Consider also: a retry (`retryOf`)
  of a pre-deploy job; `npm run ingest` and any other caller of `enqueue` that passes a `url`
  without going through `sourceAddress` (find them); the shelf lookup matching an article whose
  `final_url` is the `pdf/` address while an in-flight job for the same paper exists.
- **F2.** With `final_url` as the article's address: does anything that reads it (`urlForSlug`,
  `readMeta`, cited-in-Spideryarn, the article registry and its backfill, export/import, the
  refresh path that re-enqueues with `urlForSlug`) now behave wrongly for an article whose
  `final_url` is `https://arxiv.org/html/<id>` and whose job `url` was `https://arxiv.org/abs/<id>`?

For each finding give an ID (continue from F11), a severity (P0/P1/P2/P3, by consequence, the same
scale as round 1), whether it is established or reasoned, (a) the concrete sequence or contract,
(b) the smallest change to the plan that closes it, as exact wording.

Refuse only on an established P0 or P1. End with one line:
`VERDICT: build it` / `VERDICT: build it after fixing <IDs>` / `VERDICT: do not build`.

Do not change any file.
