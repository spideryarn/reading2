# Code review: long PDFs at one slot per 50 pages (GPT Sol)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md). GPT Sol
(gpt-5.6-sol, effort high, `--sandbox workspace-write`), 2026-10-20, on commits `48d4d424e` and
`31f3c0979`; prompt in [the prompt file](261020b-longer-documents-up-to-400-pages-code-review-prompt.md).
Its answer, verbatim except that file links are made repo-relative:

### Findings

- **C1-F1 — P0 — High-powered-at-add undercharged an unsettled long-PDF import.**
  Evidence: the add page sends the High-powered request as soon as the draft slug exists (`src/web/add-high-power.ts:161`), while the old lookup only considered settled ingest rows (`src/store/pg-billing.ts:1950`). Interleaving: reserve one slot → create draft → script sends PUT → High-powered falls back to one slot → Fetch later reprices the ingest to as many as five slots.
  Changed: the switch now locks billing → active job → reservation, waits until Fetch has established the price, and uses the priced unsettled reservation’s slots (`src/store/pg-billing.ts:1525`, `:1628`). An unpriced import returns a distinct 409 and the add-page keeps retrying while the job is alive, without the five-minute pre-claim cap (`src/billing/admission.ts:565`, `src/web/add-high-power.ts:182`). Regression coverage is at `tests/billing-long-documents-db.test.ts:392` and `tests/add-high-power.test.ts:83`.

- **C1-F2 — P3 — High-powered copy falsely said every upgrade costs one more article.**
  Input: a 250-page PDF costs five slots and High-powered costs five more, while several surfaces said “one more article.”
  Changed all live reader, Help, profile and admin wording to say the article’s slot count is charged again, half-price while public. Examples: `src/messages.ts:6745`, `src/billing-plan.ts:610`, `src/web/HighPowerSwitch.tsx:124`, and `src/web/help/pages/plans.md:23`. The Help corpus was regenerated.

- **C1-F3 — P2 — Existing barrier tests did not establish the nested lock order.**
  Holding either billing or job and observing that both writers waited would still pass if the reprice acquired those locks in reverse order.
  Changed: added `FOR UPDATE NOWAIT` probes proving billing is already held while waiting for the job, and the job is already held while waiting for the reservation (`tests/billing-long-documents-db.test.ts:563`). The reservation case is deliberately a no-op after its read, so removing its explicit lock cannot pass accidentally through the later update (`:592`).

I found no further defect in rule-4 reruns, retries, Read this, stage-2 fail-closed pricing, `raw_pages` carry, weighted usage/share calculations, or the 250-page cap messages.

Verification: 182 tests passed, one skipped. All four TypeScript projects passed and the coverage-aware typecheck reported all 3,883 source files covered. Lint reported only the existing `priceFetchedPdf` complexity advisory. The private-Postgres test file could not run because this sandbox denies Docker/localhost access (`EPERM`); those new database tests still need execution outside this sandbox.

### Verdict

**Approve with changes**, conditional on the private-Postgres test passing in an environment with Docker access.

## Checked afterwards (Claude)

- **C1-F1's fix introduced a lock-order inversion, corrected.** As written it locked billing → job
  → reservation → article, but settlement takes article → job → reservation (`lockArticleFor`,
  `src/store/pg-session.ts`), so a High-powered switch and a finishing import could each hold what
  the other waits for. `activeImportPrice` now runs after the article `for update`: billing →
  article → job → reservation, which agrees with settlement, with repricing (billing → job →
  reservation) and with visibility (billing → article). A barrier test of High-powered against
  settlement covers it, and goes red under the old order.
- C1-F2 and C1-F3 taken as written. The private-Postgres tests Sol could not run were run outside
  its sandbox.
