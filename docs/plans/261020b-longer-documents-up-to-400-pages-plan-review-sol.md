# Plan review: longer documents up to 400 pages (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol (gpt-5.6-sol, effort high, `--sandbox review`), 2026-10-20, verbatim.


**Verdict: do not approve unchanged.** The weighted-row direction is sound, but the stage-1 repricing boundary, Read-this path, and reader-facing counts need redesign.

1. **P1 — Stage 1 does not have `ingestEventId`, despite the plan assuming it does.**

   `ingestEventId` exists on `EnqueueRequest` only and is deliberately omitted from the browser-visible `Job` (`src/jobs.ts:3648-3661`). `StepContext` has `jobId`, but no reservation ID (`src/pipeline.ts:703-761`; constructed at `src/jobs.ts:1354-1376`). The plan’s proposed `topUpReservation(reservationId, slots)` therefore cannot be called as described.

   Resolve the event from `jobs.ingest_event_id` inside a store operation receiving `jobId` and the current claim identity. Do not expose the reservation ID through `Job` merely for this feature.

2. **P1 — A reservation-only top-up is not fenced against a stale fetch claimant.**

   Every claim walks the steps again; completed fetches skip, but an unfinished fetch runs again (`src/jobs.ts:1438-1473`). Deadline handoff returns the job to the queue with the running step pending, so an old attempt can still finish after its replacement starts. The account lock serializes quota calculations (`src/store/pg-billing.ts:957-989`), but it does not prove that the caller still owns the job.

   A stale attempt could overwrite four slots with one after the replacement fetched a 400-page response, leaving the expensive job charged as one slot. Conversely, always taking `greatest(old,new)` prevents the bypass but can overcharge when a mutable URL returns a shorter replacement.

   Make repricing claim-bound: accept `jobId`, attempt/claim ID and the measured page count; verify the live job fence, owner, linked unsettled `kind='ingest'` row, and desired range under the billing-account lock. Couple that evidence to the fetched artifact being committed. Test:

   - the same claimant repricing twice;
   - a stale claimant after handoff;
   - two claimants observing different URL responses;
   - concurrent top-ups for different jobs belonging to one account.

3. **P1 — “Read this” does not run stage 1, so the proposed upgrade charging cannot work.**

   The route explicitly carries the minimal paper’s existing fetch result and forces only `extract`; fetch is skipped (`src/routes.ts:7667-7690`). `reserveUpgrade` currently checks and inserts a fixed one-slot ingest before the job exists (`src/store/pg-billing.ts:1206-1226`, `1267-1288`). Retry reconstruction also records only `ingest`, `minimal`, or `upgrade`, not its weight (`src/store/pg-billing.ts:1301-1334`).

   A 300-page minimal paper would therefore still cost one slot. Persist the measured PDF page count/slot weight when the minimal paper is initially fetched, then have `reserveUpgrade` reserve that exact weight, less only the existing two-point minimal credit. Preserve the weight through retry reconstruction. Re-fetching is neither necessary nor reliable, and an upload-based Read-this job may have no URL or upload left to fetch.

4. **P2 — Jobs already past fetch when this lands will never be repriced.**

   A fresh fetch artifact causes stage 1 to skip (`src/jobs.ts:1438-1473`), while migrated ledger rows would default to one slot. Thus an in-flight 101–250-page PDF could finish for one slot after deployment.

   The plan needs an explicit transition rule: backfill from durable page-count evidence, force a safe remeasurement, or deliberately grandfather these jobs with Greg’s approval. Do not silently imply all outstanding jobs receive the new charge.

5. **P2 — Multiplying High-powered AI by PDF length is a new product decision, not an implementation consequence.**

   Today High-powered AI is exactly one additional article charge (`docs/project/billing.md:780-800`, `821-827`; `src/store/pg-billing.ts:1490-1510`). The plan says it should consume the PDF’s slots again, but labels this a question without presenting it as an approval question.

   Ask Greg explicitly. If approved, define the durable source of the original weight and update the admission calculation and inserted high-power row. Otherwise retain one slot. This cannot safely be inferred from whatever ingest row happens to be found later.

6. **P2 — One `slots` column is the right storage shape, but the plan wrongly collapses “imports” and “slots used.”**

   A single weighted ledger row preserves atomic settlement, release, article linkage and delete-price freezing. Multiple rows would complicate all of those, so the column choice is preferable.

   However, `ingestsUsed` deliberately counts actual article ingests, not billing points (`src/store/pg-billing.ts:326-333`), and reader copy describes articles added. Replacing every `count(*)` with `sum(slots)` would make one 150-page PDF appear as “2 articles added,” contradicting the existing distinction and the rule that UI does not derive article counts by dividing points.

   Retain both:

   - row counts for “articles added” and public/private article counts;
   - weighted sums for “article slots used.”

   Suitable copy is: “1 article added, using 2 article slots.”

7. **P2 — Updating only `usageSql` misses other quota-derived queries and displays.**

   `usageSql` currently uses row counts (`src/store/pg-billing.ts:500-512`), but `articlesToShare` independently counts charge rows and assumes each public conversion frees 100 points (`src/store/pg-billing.ts:872-915`). With weighted rows it could omit the article that would make room, or claim sharing will not help when it would.

   The admin aggregation has separate lifetime, period, in-flight, shared and High-powered counts (`src/store/pg-admin.ts:552-645`), while the browser derives costs from those counts (`src/web/admin-columns.tsx:213-230`). Audit all ledger aggregations, not just `usageSql`; carry both event counts and slot sums where the surface needs both meanings.

   Public half-price, in-flight full price and delete-price freezing remain compatible with a slot multiplier. Minimal papers should remain fixed at two points. The admin exemption also remains correct because admin jobs have no reservation.

8. **P2 — The warning mechanism is deferred past the point where the plan can promise it works.**

   `StepContext.report` is explicitly live-only and not persisted (`src/pipeline.ts:727-735`; `src/jobs.ts:1358-1362`). A warning sent there disappears after the step and across a claim handoff.

   Return page count/slot usage as durable fetch-step detail or a structured persisted job field. Specify when it appears and disappears. Cover uploads and fetched PDFs; admins should not be told that quota-free work “uses several slots.”

9. **P2 — The cost/limits section understates both financial exposure and the unresolved response-size limit.**

   On the plan’s own estimate, a 400-page document costing about $5.30 consumes four slots—about $1.33 cost per slot, versus roughly $0.50 gross allowance value per slot. The weighting limits abuse, but it does not “roughly track what we pay.” Two such evaluation imports already total about $10.60 before retries.

   The document also acknowledges that the article response may exceed the current 4.5 MB limit, yet schedules raising the production cap before measuring that boundary. Reverse those stages: test dense/pathological 400-page documents first, then raise the cap only after proving they can be stored and loaded. The current chunk guidance says 250 ordinary pages can already approach roughly 84 chunks (`src/jobs.ts:647-657`), so extrapolating one relatively sparse document is not an honest upper-bound estimate.

10. **P3 — The PDF route coverage should be an explicit security-boundary test matrix.**

    Uploads are sniffed from their bytes and run through the page check (`src/pipeline.ts:1685-1727`). Pasted URLs, redirects and paper-source PDF fallbacks are checked after acquisition according to the resulting document kind (`src/pipeline.ts:2893-2904`). Europe PMC JATS becomes HTML, not a late PDF (`src/pipeline.ts:2714-2777`), so it correctly remains one slot.

    No route bypass was evident, but helper-only tests are insufficient. Add cases for:

    - direct pasted PDF;
    - redirect and paper-source PDF;
    - PDF upload with a misleading filename;
    - HTML, Word and Europe PMC JATS remaining one slot;
    - 100/101/200/201/300/301/400/401-page boundaries;
    - refusal before any later paid stage begins.

## Simpler complete design

Keep one `slots smallint not null default 1 check (slots between 1 and 4)` column. Add one claim-fenced `repriceFetchedPdf(jobId, attemptId, pages)` operation that resolves the reservation through the job, locks the billing account, subtracts that row’s current weight, checks the exact new weight, and updates it idempotently. Persist the measured page count with the raw source so Read-this and any approved High-powered charge reuse the same fact. Leave settlement and release operating on the single row, and keep article counts separate from weighted slot totals.