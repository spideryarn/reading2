Review the plan docs/plans/261001b-admin-sign-up-email-carries-the-address.md (read-only review).

Context: Greg asked for the admin's sign-up email (src/arrivals.ts) to include the new reader's
address and a link to /admin/users; also the plan-upgrade email (src/billing/sync.ts notifyUpgrade)
if it names the reader the same way. Read src/arrivals.ts, src/email.ts, src/billing/sync.ts
(notifyUpgrade and its call site), src/store/pg-admin.ts (accountSource), src/store/admin-accounts.ts
(gotruePages), src/auth.ts (requireUser, AuthedUser.email), src/routes.ts around noteArrival,
src/web/PrivacyPage.tsx's Resend entry, and docs/project/email.md.

Questions: Is the design sound and the simplest that meets the brief? Is the address from the
verified JWT trustworthy enough? Is the Admin API single-user lookup right (endpoint, key, where the
function should live, what billing may import without breaking a layering or client-import test)?
Is the plain-text sanitisation right and sufficient? Anything wrong or missing: tests, privacy
wording, docs? Give findings ranked P0/P1/P2 with file refs, and end with a one-line verdict:
proceed / proceed with changes / rethink.
