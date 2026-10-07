I would revise before building. The main ownership design is sound, but E10 is an established P1: the plan knowingly accepts a violation of the globally-unique-ID contract.

## Findings

### F1 — P1 — established: E10 is a defect, not an acceptable probability

(a) Greg’s recorded requirement is “make sure it’s globally unique” in [src/ingest.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/ingest.ts:491), and the database enforces that with global `articles.short_id` uniqueness in [src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:172).

`lockOrCreateArticle` extracts the already-minted ID and inserts once, but its conflict handler covers only `articles.slug` ([src/store/pg-revisions.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-revisions.ts:866)). Thus:

- Same short ID, different base slug: the `short_id` unique constraint throws.
- Same full slug: publication refuses because another owner has it.
- Retry preserves the failed name, so it fails again.
- The failure happens after queueing and potentially after paid work.

That is user-visible wrong behaviour and violates the stated contract, however unlikely.

(b) Replace E10 and Stage 2’s paragraph with:

> **E10 — short-ID collision:** an established defect against the globally-unique handle contract. Add a deterministic red-first collision test and fix allocation so a `short_id` conflict atomically remints both the slug and handle before any paid step. Retry must retain the repaired name. The design must close concurrent allocation too; a preflight `SELECT` alone is insufficient.

If an atomic remint is materially invasive, bring that design choice to Greg. Do not document the current failure as accepted.

### F2 — P3 — established: “nothing is cached across owners” and “bytes only” are false

(a) The claims at [the plan](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/docs/plans/261007f-two-readers-import-the-same-article-checked-end-to-end-and-the-edge-cases.md:48) contradict both the schema and the plan’s own appendix:

- `link_previews` is explicitly an ownerless cache shared by every reader ([src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:6650)).
- Bibliographic records are globally shared cached metadata ([src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:7123)).
- Personalized link summaries are correctly owner/article keyed ([src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:6973)).

(b) Replace the two bullets with:

> **Personalized article output is not shared across owners.** Mode output, checkpoints, conversations and personalized link summaries are attached to an owned article/revision or explicitly keyed by owner. Ownerless caches are limited to shared source/image bytes and public factual metadata such as link previews and bibliographic registry results.

### F3 — P2 — established: Stage 1 is not end-to-end as presently specified

(a) Stage 1 starts at `enqueue`, bypassing the authenticated route, request parsing, billing admission and slot reservation. More importantly, the obvious fixture helper is a trap: `loadArticleIntoPg` creates its own synthetic running job and publishes through that, rather than completing the job returned by `enqueue` ([tests/helpers/load-article.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/helpers/load-article.ts:381), [tests/helpers/load-article.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/helpers/load-article.ts:426)). A test could therefore enqueue two jobs, publish two unrelated fixtures, and call the result end-to-end.

(b) Change Stage 1’s opening to:

> Drive each queued job to publication through production `advanceJobWith`, `claimSession` and publication, using fake pipeline steps and an in-memory blob adapter. Do not publish it with `loadArticleIntoPg` or `scratchArticleInPg`; those create an unrelated synthetic job. Either drive `POST /api/jobs` too, or call the test “queue-to-publication integration” rather than end-to-end.

The nearest pattern is [tests/open-before-structure-queue.test.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/open-before-structure-queue.test.ts:13), although its fake steps and driver are currently local rather than reusable helpers.

### F4 — P2 — established: the AI-is-separate case can pass vacuously

(a) If implemented with checkpoints as “write A, then try to read it through B’s slug,” `createPgCheckpointStore`’s request assertion can reject the mismatched reference before querying Postgres ([src/store/checkpoints-pg.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/checkpoints-pg.ts:80)). Different slugs and an owner-route 404 do not establish that stored model output is independently keyed.

(b) Replace that test wording with:

> Write the same namespace/key for both article IDs with different marker values, then read each through its matching article reference and assert each returns only its own marker. Separately assert that B cannot resolve A’s article ID through an owner lookup.

A revision mode column with distinct A/B markers would be an equally good non-vacuous version.

### F5 — P2 — established: simultaneous imports and retry isolation are missing

(a) E1 says both readers enqueue, but does not require concurrency. The important split is:

- `jobs_active_source` is owner-scoped ([src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:2992)).
- `jobs_reserved_slug` is global ([src/db/schema.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/db/schema.ts:2943)).
- Conflict classification deliberately distinguishes owner-scoped address conflicts from global name conflicts ([src/store/pg-jobs.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-jobs.ts:669)).

(b) Add:

> **E13 — simultaneous imports and retry:** A and B `Promise.all`-enqueue the same normalized URL; both get active reserving jobs and distinct slugs. A failing and retrying must reuse A’s job/name/reservation, never B’s. A later paste by each account adopts only that account’s article.

Also add a deterministic global reservation collision case; ordinary random IDs will almost never exercise `jobs_reserved_slug`.

### F6 — P2 — established: minimal imports and “Read this” upgrades are absent

(a) E5 covers ordinary uploads, not the owner-scoped minimal duplicate rule or upgrade billing. The duplicate SQL explicitly includes the owner ([src/minimal-paper.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/minimal-paper.ts:146)), and `reserveUpgrade` requires both article and owner ([src/store/pg-billing.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-billing.ts:1226)).

(b) Add:

> **E14 — minimal copies and upgrades:** A and B minimally import identical PDF bytes; each gets a minimal article and charge. A’s “Read this” supersedes only A’s minimal charge and article. B remains minimal and can independently upgrade later.

### F7 — P2 — established: cross-owner billing and cost attribution are untested

(a) The plan changes visibility but never checks its billing consequence. Concrete case: A’s copy is public and should count half-price; B’s private copy should remain full-price. A unsharing or deleting must not reprice B. `usageSql` scopes by `ingest_events.owner_id` ([src/store/pg-billing.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-billing.ts:500)), while visibility changes lock the current owner’s billing row ([src/store/pg-visibility.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-visibility.ts:154)).

AI ledger attribution likewise resolves the article using the row’s owner, not merely the globally unique slug ([src/store/ai-calls-pg.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/ai-calls-pg.ts:45)).

(b) Add assertions that:

- A and B each have one independent ingest event.
- Publishing A changes only A’s full/half-price counts.
- Deleting A freezes only A’s historical price.
- Synthetic AI-call rows for each job carry the correct owner and article ID.
- The admin projection reports both accounts separately.

Because direct `enqueue` has no ingest reservation, these require the route/admission path or explicit real reservations.

### F8 — P2 — established: private links and actual asset delivery are missing

(a) Share tokens are globally unique but belong to individual article rows. The owner operations are scoped through `ownedSlug` ([src/store/pg-share-link.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/store/pg-share-link.ts:85)). E4 checks B’s manifest, but not that the public/link-shared asset route continues returning the shared bytes.

(b) Add:

> **E15 — private links and assets:** both owners create private links; A’s key opens only A and B’s only B. Revoking or deleting A leaves B’s key and public asset response working. A’s key must not authorize B even when both manifests name the same content hash.

The offline/browser-account-switch concern is already well covered: the cache is reader-partitioned, and [tests/api-fetch-offline.test.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/api-fetch-offline.test.ts:359) exercises A→B races. Record that as existing coverage rather than duplicating it here.

### F9 — P2 — reasoned: Q1 omits the cleaner public-shelf design; Q2’s recommendation is unsafe as written

(a) Q1’s “show one card” option silently hides copies. A cleaner alternative is one grouped card with expandable variants, retaining both public contributions without exposing profiles.

Q2 is honest and answerable, but “your own copy always wins” knowingly lets a title-only false positive beat an exact DOI/arXiv match. The current order is explicit in [src/cited-in-spideryarn.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/cited-in-spideryarn.ts:212), and the exact scenario is pinned in [tests/cited-in-spideryarn.test.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/tests/cited-in-spideryarn.test.ts:266).

(b) Add to Q1:

> **D. Group variants under one card.** Show “2 public versions” and let the visitor expand them. Group only on a strong shared identity initially; keep ambiguous address/title matches separate.

Replace Q2’s recommendation with:

> **A. Your own copy wins among equally strong matches.** An exact DOI/arXiv match still beats a title-only match. To prefer your copy in that case, first confirm/enrich its identifier, or show both candidates.

Q3 is an honest cross-reference, but it is not a third question. Call the section “two questions and one existing decision.”

### F10 — P2 — reasoned: E8 should be refused deterministically, not only after the probe produces junk

(a) A clean extraction failure still makes the reader wait for unnecessary work and receive a less useful failure. Whether today’s renderer happens to extract junk is not a stable policy.

The route placement is correct: `parseJobRequest` normalizes first, then the handler can reject before `withIngestSlot` ([src/routes.ts](/var/tmp/spideryarn-worktrees/fbrvbmss-same-article-two-importers/src/routes.ts:11140)). `normaliseUrl` should remain a general URL/SSRF normalization boundary.

This is not a defence edit under the security map if implemented as a separate route-level product refusal. It neither sanitizes stranger content nor widens/narrows the network-address defence.

(b) Replace the conditional branch with:

> Always refuse a normalized Spideryarn `/read/<slug>` URL immediately in the `POST /api/jobs` handler, before billing admission. The production probe records the current symptom; it does not decide whether the input is accepted. Use a product-level origin/path predicate, not `normaliseUrl` or the sanitiser’s `ownOrigins()` defence.

## Test feasibility

All Stage 1 cases can avoid external model/provider calls, but only with the right seams:

- Reuse `pgReady`, `seedAuthUser`, `runAsOwner`, `takeRunLockAndSetUp`, and `expectClaimed`.
- Drive jobs using the production coordinator pattern in `open-before-structure-queue`, with fake fetch/extract/assets and a mocked model response or fake structure step.
- Mock `blobStore()` with the in-memory-map pattern from `asset-route.test.ts`; otherwise E4/E5 and `loadArticleIntoPg` reach Supabase Storage over HTTP.
- Drive public reads directly through `servePublicApi` with a fake `ServerResponse`, as `owner-isolation.test.ts` does.
- Use real `pgVisibilityStore`, `pgShelfStore`, `pgShareLinkStore`, comment and tag stores under the relevant owner.
- Do not use `scratchArticleInPg` to finish an enqueued job.

E1–E3, E6, E11, comments and tags are straightforward with Postgres plus fake stages. E4 requires the blob mock if “still serve” means actual bytes rather than merely a surviving manifest. E5 requires real upload records/claiming plus the blob mock; direct insertion of one `raw_sources` row would not prove upload deduplication.

I could not run the Postgres cases in this environment. I did run the service-free citation and offline-cache suites: 106 tests passed across the two files.

VERDICT: revise