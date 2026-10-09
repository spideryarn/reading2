---
reports: spya-mdmqqq
ending: shipped
comment: You were right, there were two. While an article loads, the centred animated wordmark is now the only one; the corner logo is gone from that screen, before the 600ms threshold and after it.
---
# One wordmark while an article loads

Report `spya-mdmqqq` (#499), [SPIDERYARN-READING2-FA](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-FA/),
a suggestion from Greg (admin, proven by `scripts/feedback-reporter.ts` exit 0), filed 2026-10-09
00:54 UTC from `https://www.spideryarn.com/changelog`.

> When we open an article, we show the Spideryarn logo animating in the center of the page. That's
> great. I think it also seemed to show the Spideryarn logo in the top left. If so, that doesn't feel
> necessary - we don't need both.

**Ending: shipped**, on `dev`, not deployed. Plan:
[261009b](../plans/261009b-one-wordmark-while-an-article-loads.md).

## What we did

It was there: the article page's loading branch drew the corner `HomeLogo` from the first frame and
the centred `LogoLoader` after 600ms. That branch no longer draws the corner mark, and keeps only the
Feedback trigger. Reproduced first with
[`tests/article-loading-one-wordmark.test.tsx`](../../tests/article-loading-one-wordmark.test.tsx)
(red with one `.logo-home`, green after). A browser check against the dev server, with the article
fetch held for 15s, found one `.logo-loader` and no `.logo-home` at 1280px and at 390px, and the
dock's wordmark once it loaded ([shot](../plans/261009b-shot-1-loading.png),
[narrow](../plans/261009b-shot-2-loading-narrow.png)).

**The one cost:** a load that hangs forever now has no in-page way home until it errors (the error
page keeps the corner mark). If that ever matters, the centred wordmark can become the home link.
The record is in [loading-spinner.md](../project/loading-spinner.md#the-wordmark-loader).
