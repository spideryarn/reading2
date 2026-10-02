---
reports: spya-mmhrnw
ending: shipped
---

# Email a reader when their feedback ships

Report `spya-mmhrnw`, a suggestion from Greg (admin; provenance proved by `feedback-reporter.ts`,
exit 0), 2026-10-02, filed from Summary mode on an article:

> When someone (other than an admin - I will already be aware) has submitted a Feedback report that
> gets shipped & deployed, send them an email to let them know their feedback is now live!

**Shipped** to `dev`. The last step of `npm run deploy`, once the code is live and verified, emails
each non-admin reader whose report's note says `shipped` and whom the new ledger
`feedback_shipped_emails` has not yet told: one plain-text email per report, quoting nothing they
wrote, to their current confirmed address. `/privacy` says so. No Sentry issue (the report never
reached it — postmortem 261002b).

The plan, the email's text, the alternatives, two GPT Sol reviews and what is deferred:
[261002f](../plans/261002f-email-readers-when-their-feedback-ships.md). Open for Greg: whether the
thank-you toast should also say *"If we change something because of it, we will email you when it
is live."*
