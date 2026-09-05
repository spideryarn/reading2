# Add a /contact page

**[SPIDERYARN-READING2-1H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1H)** · reported
2026-09-05 07:31 UTC · *shipped*

## What the reader said

> Add a /contact page and link to it appropriately. For now it can be really brief. Mostly just
> saying Spideryarn is in beta, but we'd really love your feedback or suggestions. The best way to
> do it is with the Feedback button in the top right. You can also contact us at
> hello@spideryarn.com.

## What we did

Built it, in Greg's own three sentences and in that order —
[`src/web/ContactPage.tsx`](../../src/web/ContactPage.tsx) at `/contact`, shaped like
`/privacy` rather than like the marketing pages, and reachable signed out for the same reason the
policy is.

Linked from **one** place: `LINKS` in [`SiteFooter.tsx`](../../src/web/SiteFooter.tsx), which is what
that array exists for, so it appears on all eight pages that carry the footer row and nowhere under
`/read/`.

The reasoning, and the two judgment calls Greg can overrule in a line each — the footer keeps its raw
`mailto:` beside the new link, and `SiteNav` did not gain one — are in
[the plan](../plans/260905c-contact-page-and-a-warmer-feedback-thank-you.md).
[website-text.md § The contact page](../project/website-text.md) is the doc.
