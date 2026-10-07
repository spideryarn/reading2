# Auxiliary fields inherit the enclosing form's submission contract

Caught before landing stage 2 of [261007j](../plans/261007j-gift-voucher-starter-article-by-private-link.md), introduced by `90d414d4c`. No production incident was observed. A read-only subagent investigated the root cause; the reviewer reproduced and fixed it.

## The class: a field for a separate action participates in native form validation

The import address opens another tab, but its `type="url"` input lived inside the voucher form. A scheme-less or unfinished import draft made `form.checkValidity()` false, so pressing Create dispatched no submit even with valid voucher fields and no starter. `AddArticle.tsx` already uses `type="text"` and `inputMode="url"` deliberately to accept scheme-less addresses.

The import test checked its hyperlink and Enter handler; the create tests left the import box empty. The new regression filled `example.test/essay`, checked the generated import link, then tried creating a voucher. It failed at `expected false to be true` on native form validity. The subagent independently reproduced zero submit events with `type=url`, and one with `type=text`.

## Lasting fix and countermeasures, ranked

1. **Submit with an unfinished auxiliary draft.** Done in `tests/admin-vouchers-page.test.tsx`, red before the fix; it checks actual validity and a voucher POST with `starterSlug: null`.
2. **Give separate actions separate validation contracts.** Done narrowly here by following AddArticle's text input and URL keyboard hint. URL admission remains the add page's responsibility. This is the lasting fix for this form.
3. **Disable validation for the whole form.** Rejected: email and article-count validation belong to Create and must remain intact.

A field need not be required, submitted, or relevant to the pressed button to prevent a native form submission. Test combinations of adjacent actions, not just each action in isolation.
