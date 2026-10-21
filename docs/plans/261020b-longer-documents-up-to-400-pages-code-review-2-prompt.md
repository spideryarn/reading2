# Narrow check: plan 261020b code review fix C1-F1 (read-only)

Do not change any file. Discovery is closed: check only the C1-F1 fix as it now stands in commit
`4b07261d7` (`git show 4b07261d7 -- src/store/pg-billing.ts src/billing/admission.ts
src/web/add-high-power.ts tests/billing-long-documents-db.test.ts tests/add-high-power.test.ts`).
Your review is `docs/plans/261020b-longer-documents-up-to-400-pages-code-review-sol.md`; read its
"Checked afterwards" section — your original fix locked job before article, which deadlocks with
settlement (`lockArticleFor` in src/store/pg-session.ts takes article → job → reservation), so
`activeImportPrice` now runs after the article `for update`.

Check, each with a verdict and file:line evidence:

1. Is billing → article → job → reservation consistent with every other path that takes two of
   those locks: settlement (all seven ending sites, `settleExpired`, `requestCancel`),
   `priceFetchedPdf`, `pg-visibility.ts`, `reserveUpgrade`, voucher revocation, delete? Any cycle?
2. Does `activeImportPrice` find the right job (status `running` only — what about a job `queued`
   or `claimed` but not yet running, or between steps, or a retry's fresh job) so High-powered
   can't still be charged one slot for a long PDF by a script timing the PUT?
3. Does the `pending` 409 loop in src/web/add-high-power.ts terminate when the job fails or is
   stopped?

Severity P0–P3 as before. IDs C2-F1…. End with a verdict: approve / approve with changes / do not
approve.
