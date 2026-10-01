---
reports: spya-vp4mdn
ending: shipped
---
# Gift vouchers: extra free articles, given by email

A suggestion from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0 — the row, not the
Sentry event, which was not matched), filed from Citations mode on `9689-full-spya-m43th2`, build
`6d09e3cc`. The time in the file name is the feedback row's `created_at` (18:51:49Z), in London time.

> I'd like to be able to give somebody a gift voucher (e.g. 20 free articles).
>
> Perhaps it's a voucher code that I provide them that they type in somewhere? Actually better still
> add a new page in `/admin` where I can enter their email address (and if they log in or are
> already logged in with that email address, it automatically & permanently increases their
> allotment of articles that they can process while still on the Free pricing plan, and indicates to
> them during login that this has been applied.) That /admin/vouchers page should show existing
> vouchers that have been created, which have been claimed and how used, allow me to edit/invalidate
> them, etc.
>
> If we don't already, we should indicate somewhere on the logged-in Homepage for free users how
> many free articles used & remaining, plus default-collapsed section:
> - Brief explanation of how free articles & pricing works, with link to page with more information
> - Linking to Pricing page
> - Linking/explaining how to upgrade
> - if they have a voucher, show it and its status. Perhaps indicate this prominently with a little
>   icon next to the "Remaining" count so it's easy to see at a glance that a voucher has been
>   applied.
> - If they don't have a voucher, don't mention vouchers at all
> - (plus anything else you can think of)
> - etc

**Shipped** to `dev` — the work ends at `f83f9a453` (not deployed — the Overseer deploys). `/admin/vouchers` creates,
edits, revokes and restores vouchers by email. A voucher binds to the account that signs in with
that **confirmed** address — an address with no account yet waits until sign-up — and raises the
Free allowance (3 + the gift) for as long as the reader is on Free. The shelf now has a free-allowance
box with a gift icon and a collapsed *How free articles work* section, and for a week after a claim
a dismissible *a gift has been added* notice. Codes were not built, and "during login" became that
notice on the page sign-in lands on; why, and the rest, are in
[261001m-gift-vouchers-for-free-articles.md](../plans/261001m-gift-vouchers-for-free-articles.md).
