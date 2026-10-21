# Plan review 2: longer documents up to 400 pages (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol (gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, after Greg's answers, on plan commit `779c797d8`, verbatim.

The billing-row → job-row → ingest-row design is sound for newly charged ingests, and I found no lock-order inversion. But the plan still has one scriptable bypass and two ordinary-path transition gaps.

## Findings

### R2-F1 — P0 — A refresh can turn a one-slot article into an eight-slot PDF without repricing

Evidence:

- The plan claims no paid work can start without repricing (`docs/plans/261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md:106-110`), but explicitly makes a re-run with no reservation return `unpriced` (`:185-199`).
- Rebuild of an article with a URL sends `{slug, force:["fetch"]}` (`src/web/ShelfEntry.tsx:688-745`).
- A bare-slug request is free and carries no reservation (`src/routes.ts:13763-13775`; `src/billing/admission.ts:20-26`).
- Forcing `fetch` forces extraction and the rest of the ingest pipeline (`src/jobs.ts:1101-1137`).

Reachable sequence:

1. Import a one-page URL for one slot.
2. Change that URL to serve a 400-page PDF.
3. POST the ordinary refresh/rebuild request.
4. Stage 1 counts 400 pages but returns `unpriced`; transcription onwards runs while the article remains charged as one slot.

That is a money/quota bypass reachable by a script, matching the supplied P0 definition. The proposed stage-2 belt also returns `unpriced`, so it does not close it.

Fix: decide and document how a refresh that increases the PDF’s slot band is handled. Safe options are to reserve the positive slot delta before replacing the raw source, or refuse the refresh and require a newly charged import. Persist the current source’s page count independently of the historical ledger row so the old and new weights can be compared. A null reservation must not automatically authorize a heavier fetched PDF.

### R2-F2 — P1 — Existing PDFs have no page count, breaking weighted Read-this and High-powered charges

Evidence:

- The migration defaults every existing ledger row to `slots = 1` and leaves `pages` nullable (`docs/plans/…:162-170`, `:267-274`).
- Read-this skips fetch and depends on the minimal row’s stored pages (`:149-151`; `src/routes.ts:7729-7753`).
- High-powered copies the largest charged ingest row’s `slots` (`docs/plans/…:200-204`).
- The only stated grandfathering covers jobs already past fetch during deployment, not completed articles or existing minimal papers (`:152-153`).

Consequences:

- An existing 250-page minimal paper has `pages = null`; Read-this either cannot calculate its reservation or silently reserves one slot.
- Switching an existing 250-page full article to High-powered charges one slot, contrary to Greg’s chosen “charge the article’s slots again.”
- A later refresh does not populate the missing fact because re-runs are explicitly `unpriced`.

Fix: add a transition rule for completed articles and minimal papers. Prefer a durable page count on the current raw source/revision, lazily populated from the canonical stored PDF when absent. Read-this and High-powered must resolve that count before admission. If existing documents are deliberately grandfathered, obtain and record that decision explicitly and define both paths’ behavior rather than treating only in-flight jobs as grandfathered.

### R2-F3 — P1 — `articlesToShare` still answers the one-slot question for a multi-slot refusal

Evidence:

- A reprice refusal can return `shareToMakeRoom` (`docs/plans/…:193-195`).
- The plan changes how much each shared long article frees, but does not change what requested cost the offer must make room for (`:211-215`).
- Today `articlesToShare` stops as soon as `admitsIngest` says one ordinary slot would fit (`src/store/pg-billing.ts:872-917`, especially `:915`).

Example: if sharing one article frees enough for one slot but the rejected PDF needs five, the response will tell the reader that sharing that one article makes room; after sharing it, the five-slot import is still refused.

Fix: pass the requested slot cost—and the minimal-paper credit for Read-this—into `articlesToShare`. Stop only when the same predicate that refused the actual request now admits it. Order candidates by freed slot-points, not row count. Add a test where several private articles must be shared before a five-slot PDF fits.

### R2-F4 — P2 — The stage-2 “belt” does not provide the coverage claimed

The plan says it turns “any path nobody has listed” into a charge or refusal (`docs/plans/…:155-158`). As written, it does not cover:

- refreshes, because no reservation returns `unpriced`;
- existing or grandfathered rows, because their `pages` is null;
- a genuinely unknown stage-1 skip unless some other path has already stored the page count.

For correctly implemented fresh imports, retries and Read-this, the weight is already known and reserved before stage 2, so the second mutation adds little.

Fix: do not add the second full billing transaction as currently described. Instead, make stage 2 assert a durable invariant before transcription: a charged PDF has a trusted page count and `slots === ceil(pages/50)`. Fail closed on mismatch. If the belt is retained as a repairing operation, it needs an independently durable page count and explicit behavior for null reservations and legacy null counts; otherwise it is false reassurance.

### R2-F5 — P2 — The plan lacks tests for the transitions its lock-order proof depends on

The stage-2 tests name concurrent reprices and stale claimants, but not settlement, Stop, expiry, visibility or voucher races (`docs/plans/…:267-274`).

Relevant competing paths are:

- `requestCancel`: job row, then reservation release (`src/store/pg-jobs.ts:2062-2121`);
- `settleExpired`: articles, jobs, then reservations (`src/store/pg-jobs.ts:1705`, `:1823-1887`);
- normal settlement: article, job, then reservation (`src/store/pg-session.ts:787-811`, `:605-633`);
- visibility, High-powered and Read-this: billing row, then article (`src/store/pg-billing.ts:1206-1252`, `:1424-1469`).

Fix: add barrier-based real-database tests for reprice versus:

- terminal and non-terminal Stop;
- expiry requeue and terminal expiry;
- successful and failed settlement;
- visibility change and voucher revocation;
- deduplicated enqueue releasing the unused reservation;
- an upload refused at reprice, remaining `claimed`, then succeeding through Retry after allowance increases.

Each test should prove both completion without deadlock and the final job/reservation weight.

### R2-F6 — P3 — “Same half-article overdraft, once” is too broad

The reprice predicate correctly permits only `budget + 100` at admission (`docs/plans/…:179-184`). But usage is deliberately non-monotonic: unsharing raises it, and voucher revocation or entitlement changes can lower the budget (`src/store/pg-billing.ts:470-483`, `:966-980`). Unsharing an eight-slot article can raise usage by 800 points after a valid admission.

This is existing policy rather than a race: the shared billing lock ensures the operations see one another in a definite order. But the account can end farther over the wall than half an article.

Fix: say that the half-article bound applies to each admission at the instant it commits. Later visibility or entitlement changes may put the account farther over, after which new admissions are refused.

## Race and lock-order conclusions

For a newly charged ingest that actually passes through `priceFetchedPdf`, I found no interleaving that admits paid work on an underweighted reservation. Concurrent admissions are serialized by the billing row; cancellation, expiry and settlement serialize against repricing on the job row; all shared paths take job before ingest.

The proposed lock order is deadlock-consistent. The initial owner lookup must remain an unlocked read: do not lock the job to discover the owner and then request the billing lock. That reversal could participate in a three-way cycle with billing → article operations and article → job settlement.

Specific suspicions:

- `retryJob` does skip a completed ordinary fetch: `forceForRetry` forces only steps that were originally forced (`src/jobs.ts:5217-5257`). Carrying the old weight therefore is necessary and correct.
- An upload refused by repricing before promotion remains `claimed`, which is the state Retry can use; `acquireUpload` later promotes only a claimed record (`src/pipeline.ts:1840-1851`). This needs the explicit test in R2-F5.
- `jobs.ingest_event_id` is unambiguous: it has a partial unique index (`src/db/schema.ts:3376-3390`) plus the owner-composite foreign key.
- Fetch detail is persisted and displayed after completion (`src/jobs.ts:1615-1634`; `src/web/AddArticle.tsx:923-937`). The warning mechanism is viable.
- I found no incorrect 50-page arithmetic: 1–8 slots, the 150-page free limit, boundary examples, public half-price and the High-powered multiplier are consistent.

**Verdict: do not approve.**