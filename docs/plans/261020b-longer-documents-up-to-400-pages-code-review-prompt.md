# Code review: plan 261020b, a long PDF costs one slot per 50 pages (write-capable)

Up: [261020b](261020b-longer-documents-up-to-400-pages-cost-a-slot-per-100-pages.md).

You are reviewing the code built from plan 261020b in this worktree. Read the plan first, all of
it: Greg's answers, § "The race between reserving and raising the charge" (rules 1–4), the paths
that skip stage 1, legacy grandfathering, the stage-2 assertion, and § "Stage 1, measured: the cap
stays at 250 for now". Also read docs/project/billing.md § "The quota, and the one thing it has to
survive" and docs/project/security-map.md's billing line: the slot count is a listed defence.

The code is two commits, plus a regenerated migration:

```
git show 48d4d424e      # stages 2-3: ledger, pricing in stage 1, messages, tests
git show 31f3c0979      # barrier, settlement, voucher, stage-2 and fetch-matrix tests
cat drizzle/20261020210546_long_pdf_slots_and_raw_pages.sql
```

(The merge commits in between are trunk and an unrelated investigation, so leave them out of scope.)

Look hardest at, in this order:

1. **The race between reserving and raising the charge.** `priceFetchedPdf` in
   src/store/pg-billing.ts and its caller in src/pipeline.ts / src/jobs.ts / src/billing/admission.ts.
   Lock order must be billing row (lockBillingAccount, insert-on-conflict then FOR UPDATE), then the
   job row (fenced by `liveAttempt(id, attempt)`), then the ingest row. The owner lookup must be an
   unlocked read. Any interleaving with Stop, expiry, settlement (success and failure), visibility
   change, voucher revocation, a concurrent second import or a stale claimant that either deadlocks,
   or lets paid transcription start on an underweighted reservation, is P0.
2. **Free re-run paths (rule 4).** A Rebuild (`force: ["fetch"]`) of a one-slot article whose URL now
   serves a long PDF must be refused before `writeRaw`, before any paid call. `previousSourcePages`:
   is the source being replaced read reliably (including a reset's fresh draft and a legacy source
   with no `raw_pages`)? Are there other no-reservation paths?
3. **Weights carried on paths that skip stage 1**: retry (`reservationShapeOf` / `withRetrySlot`),
   *Read this* (`reserveUpgrade`, minimal row's `pages`), High-powered (`switchOnHighPower`), and
   legacy null pages ⇒ one slot. `articlesToShare` against the requested weighted cost. `usageSql`
   slot sums, public half price, delete-frozen prices.
4. The stage-2 assertion (`pdfIsPriced`, `[pdf-unpriced]`) fails closed, and `raw_pages` is
   carried through artifacts-pg.ts / pg-revisions.ts carry policy.
5. Reader-facing messages in src/messages.ts are true under MAX_PAGES = 250, and admin columns.
6. Tests: does each barrier test actually prove its claim (would it go red if the lock were
   removed)? Gaps?

Severity: P0 a money/quota bypass reachable by a script, or a deadlock; P1 a wrong charge or a wrong
refusal on an ordinary reader path; P2 should be fixed in this work; P3 wording.

**You may fix what you find inside this stage** (src/, tests/, and this plan's docs), keeping to the
surrounding code's style. Do not commit, do not run any git command that changes the index or
discards work, do not touch the remote database. Run the tests you touch with `npx vitest run
<file>` (the private-postgres lane mints its own database) and `npm run typecheck`. Report anything
wider for me to decide.

Write your answer as: findings with IDs C1-F1…, each with severity, file:line evidence, the
interleaving or input that defeats it, and what you changed (or why you did not); then a list of
the files you modified; then a verdict: approve / approve with changes / do not approve.
