---
reports: spya-wwx6ks
ending: shipped
---
# Every reader's feedback, emailed to the admin

Report `spya-wwx6ks`, from Greg (admin), 2026-10-02 20:34 UTC, relayed by the Overseer, Sentry
confirmed, on `/read/entropy-26-00481-with-cover-from-taylor-beck-spya-naz564?mode=citations`:

> Anytime someone submits feedback that isn't from me, the admin, please send me an email with their
> feedback.

**Ending: Shipped**, on `dev`. Plan
[261002j](../plans/261002j-email-the-admin-each-reader-s-feedback.md).

What changed. Every report a non-admin files now sends one plain-text email to the admin address
(`hello@`, which forwards), after the reader has been answered: the report id, kind, page address,
article slug, the reader's email address and account id, and their words, quoted line by line with
links defanged. It goes through the same `notifyAdmin` as the sign-up and upgrade notices. An
admin's own reports, and a retried submit, send nothing.

What caps it: at most 20 such emails a day across every reader and 5 from any one, because Resend's
free 100 a day is shared with sign-up and password-reset mail. Past that a report is still filed and
listed on `/admin/feedback`, just not mailed; each email says the cap exists. `/privacy` now says the
words and address travel this way.

Needs the `feedback-notice` migration on production to cap; without it the email still sends,
uncapped, and logs a warning.
