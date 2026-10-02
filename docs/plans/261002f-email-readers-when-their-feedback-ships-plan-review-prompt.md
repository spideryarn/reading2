# Plan review: email a reader when their feedback ships

You are reviewing a plan, read-only, before it is built. Repo: Spideryarn (read CLAUDE.md for the house rules).

Read the plan: docs/plans/261002f-email-readers-when-their-feedback-ships.md

Then check it against the code it relies on, and say where it is wrong, unsafe, or more complex than it needs to be:

- scripts/deploy.ts (main(), summarise, the migration step's DB connection, fileAt) and scripts/deploy-checks.ts (AFTER_THE_FACT_CHECKS, codeMayNotHaveShipped)
- src/email.ts (sendEmail, idempotency, whyNotSend)
- scripts/feedback-endings.ts, src/feedback-endings.generated.ts, src/feedback-ending.ts (how "shipped" is decided, `parts:` for split reports)
- src/admin.ts (isAdmin)
- src/db/schema.ts § feedback, drizzle/0040_feedback_owner_fk.sql
- docs/project/email.md, docs/project/feedback.md, docs/project/privacy.md, src/web/PrivacyPage.tsx (the Resend paragraph), src/web/FeedbackButton.tsx (the hover card's "so we can write back")

Questions I most want answered:
1. Is "diff the shipped map between origin/main-before-push and the new sha" a sound trigger? What edge cases send twice, send to the wrong person, or lose a send silently? Is the 20-recipient cap and the zero-parse guard the right shape?
2. Is the consent reasoning right (the hover card's "so we can write back", not the diagnostics_consented column)?
3. Reading auth.users from the deploy script as postgres: any problem? Should it be email_confirmed_at, deleted_at, banned_until?
4. Any privacy, security, or "touches a defence" (docs/project/security-map.md § Where the defences physically live) concern?
5. The email text: anything wrong or misleading?
6. Is there a simpler design I passed over?

Answer with numbered findings, each with severity (P0/P1/P2/P3), the file/line evidence, and the change you recommend. End with a one-line verdict.
