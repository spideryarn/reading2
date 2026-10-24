---
reports: spya-h2r5ap
ending: shipped
---
# A discarded author-gift draft can be deleted for good

An admin report from Greg (`feedback-reporter.ts` exit 0), filed from `/admin/vouchers?tab=drafts`
on build `db758ed8`. No addenda.

> There's a discarded draft. I want an option not just to show and restore, but to actually delete
> permanently the discarded draft.
>
> — Greg, 2026-10-23 22:36 UTC (`spya-h2r5ap`, #685)

**Ending: Shipped**, to `dev`, not deployed. Plan:
[261024f](../plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md)
§ D1, built with #687 and #688 from the same evening.

A discarded gift's line now has *Delete* beside *Show* and *Restore*. It asks inline, *Delete this
draft for good? Its notes and lookups go with it. This cannot be undone.*, and only *Delete for
good* deletes it (`DELETE /api/admin/author-gifts/:id`). Only a discarded gift can go: a draft has
to be discarded first, and a sent gift cannot be deleted because its voucher is a billing record.
What its lookups cost stays in the ledger. Once it is gone, that article can have a new gift
drafted.
