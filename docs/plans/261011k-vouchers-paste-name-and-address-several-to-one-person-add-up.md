# /admin/vouchers: paste `Name <email>`, and several vouchers to one person add up

Two admin suggestions, one page. Queue item `qi-x3ndt2yw`.

> If I paste in a combination name and email address (e.g. `Firstname Lastname <firstname@example.com>`
> into the email address, accept that - keep just the email address, and immediately populate the
> name if it's empty.
>
> — Greg, 2026-10-11 (`spya-cfbp0q`, SPIDERYARN-READING2-GY, from /admin/vouchers)

> It should be possible to send multiple gift vouchers to the same person and they're additive.
>
> — Greg, 2026-10-11 (`spya-dkddku`, SPIDERYARN-READING2-H6)

## What is already true

**Several vouchers to one address already add up**, and have since the first voucher plan
([261001m](261001m-gift-vouchers-for-free-articles.md)). Nothing makes an address unique on
`billing_vouchers` (the only index on it is a plain partial index for the claim's lookup);
`claimVouchersFor` claims *every* waiting, unrevoked voucher at the address in one `UPDATE`; and
`freeEntitlement` adds the claimed, unrevoked **sum** to the Free limit. The reader-side copy
already speaks in plurals (`giftMakeup`: *3 free + 30 from gifts*), and the gift email to an
existing reader already counts gifts waiting at the same address (261002a, Sol F5).

What is missing is (a) a test that holds the sum: tests already make two vouchers to one address
and claim them together (`billing-voucher-emails.test.ts`), and already check the gift email's
*after* count, but none asserts the summed allowance or that a revoke takes back only its own;
and (b) any sign on the page that it is so, which is presumably why the question came up.

### What "additive" means, in slots

On Free, a reader's lifetime allowance is **the Free base plus the articles of every voucher they
have claimed and that is not revoked**: two vouchers of 20 and 10 to the same address raise the
Free allowance from 3 to 33 articles, for good — no expiry, no reset. That is 33 whole-article
units, not necessarily 33 more additions: what was used before stays used, and a public article,
an abstract-only paper or High-powered AI is charged its own share of one
([billing.md § The quota](../project/billing.md)). Revoking one takes back only its own
articles. A paid reader's limit is untouched, as now; the gifts wait for Free. No time is involved:
a voucher is articles, never days.

## The work

1. **Additive: a test and a sentence, no behaviour change.** `tests/billing-vouchers.test.ts`
   gains a case: two vouchers at one address, claimed together, give base + both; a third made
   after that claim is claimed on the next visit and adds again; revoking one subtracts only it.
   `billing.md § Gift vouchers` gains one line saying so. The create form, when the typed address
   already has unrevoked vouchers in the list, says under the field *"This address already has 2
   gifts (30 articles). This one adds to them."* — computed in the browser from the list the page
   already holds, so no new route. A waiting voucher counts by its address; a claimed one only
   while its claimant's current address is the typed one, because a claimed voucher belongs to an
   account, which may have changed address since (Sol's plan review, F1).
2. **Paste `Name <email>`.** A pure `splitNameAndAddress(raw)` in
   [`src/email-address.ts`](../../src/email-address.ts) (the module that already holds the address
   rules and imports nothing): `Name <addr>`, `"Name" <addr>` and `<addr>` give the address and
   the name (or null); anything else gives null and the field keeps what was typed. It runs in
   the email field's `onChange`, so it works on paste and on typing the closing `>`. The address
   field takes the address; the name field is filled only if it is empty. Applied in all three
   address fields on the page that sit beside a name field: the new-voucher form, a waiting
   voucher's editor, and an author gift's draft editor.

## The simpler option passed over

For (2): parse on the server, so the API accepts `Name <addr>` too. Passed over: the request is
about the paste box, the name has to land in a *visible* field before Send so it can be checked,
and the server's strict shape check is a defence worth keeping strict.

For (1): doing nothing but answering "it already works". Passed over because a property nothing
tests is one a later change can remove silently, and the form gave Greg no way to see it.

## Review

GPT Sol, plan stage ([prompt](261011k-vouchers-plan-review-prompt.md),
[answer](261011k-vouchers-plan-review-sol.md)): *approve with changes*. F1 (the hint counted a
claimed voucher whose account had moved address) and F2 ("33 slots" overstated) changed the plan
above; F3 added the mismatched-quote refusal and the edge tests; F4 corrected what the old tests
already covered.

GPT Sol, code stage ([prompt](261011k-vouchers-code-review-prompt.md),
[answer](261011k-vouchers-code-review-sol.md)): *approve with changes*, fixed in place. The hint
now speaks only from a settled, successful list (not while a refresh is in flight or after one
failed); the docs say exactly which vouchers it counts; and tests cover Edit filling its own empty
name, an author gift's replaced address sending both fields, and a claimant whose address could not
be read.

Browser check (Playwright on the box, a Sonnet subagent): the paste in the form and in Edit, and
the hint appearing and going, all as above in Chrome, no console errors —
[the paste](261011k-shot-1-paste.png), [the hint](261011k-shot-2-already.png).

## Not touched

No schema change, no route change, no defence in security-map.md. The MCP tools are untouched.
