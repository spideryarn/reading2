You are reviewing a PLAN (read-only; do not edit files) in this repo, the Spideryarn reading app.

Plan: docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md (untracked, in this worktree).
Base: the worktree's HEAD. Nothing is built yet.

Context to read (start here; it does not limit scope):
- docs/project/marketing.md § "A tool to make this cheap" (Greg's request)
- docs/project/billing.md § "Gift vouchers" and docs/project/admin.md § "/admin/vouchers"
- src/db/schema.ts (billingVouchers, billingVoucherEmails, aiCalls)
- src/store/pg-vouchers.ts (claimVouchersFor, createVoucher, updateVoucher, listVouchers), src/store/pg-voucher-emails.ts,
  src/store/voucher-starter.ts, src/admin-vouchers.ts
- src/store/pg-share-link.ts and parseShareLinkRequest / the share-link route in src/routes.ts (keepExisting)
- src/routes.ts: the /api/admin namespace gate and the vouchers routes (~9460-9760)
- docs/project/high-powered-ai.md § "Switching it on while the article is added", src/web/add-high-power.ts, src/web/AddPage.tsx (~190-210)
- src/citation-find.ts (web search request, url/extract checks), src/openrouter-stream.ts collectSearchEvidence
- docs/project/cost-tracking.md, docs/project/security-map.md

What the plan must settle (from the brief): what a draft voucher is in the data (additive migration only), where Greg sees and
sends drafts, how the lookup's results and cost are shown and tracked, admin-only enforcement on the server, what happens when no
author or address is found. Nothing may ever be emailed automatically.

Please attack it independently first: correctness of the data model and migration (including the deploy window where the migration
lands before the code), every existing code path that could treat a draft as a live voucher (claim, entitlement, emails, retry,
PATCH, list, replay of create), concurrency (double press, send races), the lookup's trust model (prompt injection from the article
or search results, hallucinated addresses), cost attribution, the add page's timing, and whether a simpler design gets most of the
value. Then:

My own suspicions, worth less — spend most of the run elsewhere:
- Is backfilling issued_at = created_at in the migration acceptable as "additive", and does `default now()` then explicit null for
  drafts behave as I think in Drizzle/Postgres?
- Does making billing_vouchers.email nullable break anything that assumes a string (renders, replayOf, normaliseEmail callers)?
- Is generation_id a sound key from author_lookups into ai_calls for the cost figure?
- Is sending the request at completion without awaiting it, then navigating, safe in this SPA?

Severity scale: P0 data loss / exploitable security / incorrect charging / broadly unusable; P1 user-visible wrong behaviour or an
authoritative contract violated; P2 design/maintainability risk; P3 prose. Give each finding an ID (F1, F2, …), a severity, the
evidence (file:line), and a concrete fix. Start with a verdict line: APPROVE / APPROVE WITH CHANGES / REJECT.
