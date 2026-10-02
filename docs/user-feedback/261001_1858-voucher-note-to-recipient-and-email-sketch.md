---
reports: spya-hc5q0e
ending: shipped
---
# A note to the voucher's recipient, and a sketch of their email

Report `spya-hc5q0e`, a suggestion, from Greg (admin), 2026-10-01, dispatched by the Overseer on
2026-10-02 with no Sentry mirror, on `/admin/vouchers`:

> In the gift vouchers page, you've got a private note field, which is great. Can you also add a
> note for them so that I can add a sentence or two that they will see? So I might say, oh, it was
> great to meet you earlier today, blah, blah, blah.
>
> And can you also give a small indication of what the gift voucher email that gets sent will look
> like and where my "note for them" would go?

**Ending: Shipped**, on `dev`. Plan
[261002b](../plans/261002b-voucher-note-to-recipient-gift-on-profile-whole-dollar-spend.md) § Stage 1.

What changed: the create form has a *Note to them* box. The note goes in their email under the
heading, above our own words, labelled *A note from the person who gave you this gift:*. Beside the
box, a small sketch of the email updates as you type, showing the subject, the heading and where the
note lands, with the rest of the body described. The table has a *Note to them* column you can edit;
editing it does not re-send the email.
