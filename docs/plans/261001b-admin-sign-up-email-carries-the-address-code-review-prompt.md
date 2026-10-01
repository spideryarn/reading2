Code review of commit 1f6ae0d7 (`git show 1f6ae0d7`), which builds
docs/plans/261001b-admin-sign-up-email-carries-the-address.md. Your plan review is
docs/plans/261001b-admin-sign-up-email-carries-the-address-review-sol.md; check each of its findings
was actually addressed in code, not only in the plan's prose.

The change: the admin's sign-up mail (src/arrivals.ts) and upgrade mail (src/billing/sync.ts) now
carry the reader's address and link /admin/users. Sign-up takes it from the verified JWT via
noteArrival(user.id, user.email) in src/routes.ts; upgrade asks the Auth Admin API through
accountEmail in src/store/admin-accounts.ts, which also now owns authAdminEndpoint (moved from
pg-admin.ts). oneLine in src/email.ts flattens the address. /privacy (src/web/PrivacyPage.tsx),
docs/project/privacy.md and docs/project/email.md describe it.

Look for: correctness bugs; anything that could make a notice throw, hang, or fail to send; an
address or response body reaching a log or error; the wrong person's address; import cycles or
layering problems (billing -> store/admin-accounts -> store/blobs); tests that could stay green
while the thing they claim is broken; wording on /privacy that is false or incomplete;
docs that now contradict the code.

You may FIX what you find inside this change's scope (edit the files; do not commit). Report
anything wider for me to decide. Run the focused tests you touch:
npx vitest run tests/admin-notice-address.test.ts tests/reader-arrivals.test.ts tests/privacy-page.test.ts tests/admin-accounts.test.ts tests/billing-upgrade-notice.test.ts
and npm run typecheck (judge it by exit code).

End with: findings ranked P0/P1/P2 with file:line, what you changed, and a one-line verdict
(ship / ship after my fixes / do not ship).
