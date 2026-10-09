# One wordmark while an article loads

Report spya-mdmqqq (#499), [SPIDERYARN-READING2-FA](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-FA/),
a suggestion from Greg (admin), 2026-10-09:

> When we open an article, we show the Spideryarn logo animating in the center of the page. That's
> great. I think it also seemed to show the Spideryarn logo in the top left. If so, that doesn't feel
> necessary - we don't need both.
>
> — Greg, 2026-10-09

## What is there now

He remembered right. The `loading` branch of
[`ArticlePage.tsx`](../../src/web/article/ArticlePage.tsx) draws the corner `HomeLogo` from the first
frame and, once [`useSlow`](../../src/web/useSlow.ts) says 600ms have passed, the
[`LogoLoader`](../../src/web/LogoLoader.tsx) in the middle. The corner one came first: the branch's
header comment keeps it because a reader arriving from a pasted link has no shelf behind them, and
because the mark is what says whose page this is. The loader added on 2026-10-01
([261001q](261001q-logo-loading-spinner.md)) didn't revisit that.

Reproduced with a test before changing anything:
[`tests/article-loading-one-wordmark.test.tsx`](../../tests/article-loading-one-wordmark.test.tsx)
renders the real `App` on `/read/…` with only the article's access held at `loading`, signed in and
signed out, and finds one `.logo-home` both before and after the threshold.

## The change

**The `loading` branch stops drawing `HomeLogo`.** It keeps the corner Feedback trigger, which only
draws for a signed-in reader, and which is the one thing a stuck wait still needs. Before 600ms the
page is empty; after that the centred wordmark is the only one on screen. The branch's header comment
and the comment above `loading` get updated to say three branches keep the corner mark, not four, and
why loading is the exception.

Its second reason (whose page is this) is now met by the centred wordmark itself. Its first (a way
home) is a real cost, and it is accepted rather than argued away: **a wait that never ends has no
in-page way home**, and a link opened in a new tab has no Back either. A fetch that fails becomes the
`error` branch, which still has the corner mark. GPT Sol's plan review (finding 2) caught an earlier
draft of this paragraph claiming Back covers it.

`tests/dock-corner-controls.test.tsx` pinned the old shape ("waiting for the article: the corner
pair"), so it now pins the new one: no dock, no way home, one Feedback trigger. The comments in
`HomeLogo.tsx` and `dock.css` that list loading among the corner mark's pages are corrected (review
finding 1), and the new test's fetch stub answers `/api/jobs` with a list (finding 3).
[The review](261009b-one-wordmark-while-an-article-loads-review-sol.md).

## What I passed over

- **Drop the corner mark only once the loader shows.** Then every load slower than 600ms would draw
  the corner mark and take it away again just as the big one arrived, which is a swap the reader
  sees. On fast loads the corner mark would be on screen for a few hundred milliseconds before the
  dock's own wordmark takes over, and nothing would be gained.
- **Make the centred wordmark a link home.** That keeps the way home, but it adds a control to a page
  whose only job is waiting, the loader is `aria-hidden` on purpose, and nobody has asked for it.
  It's easy to add later if a stuck load ever turns out to need it.

## Docs

[loading-spinner.md § The wordmark loader](../project/loading-spinner.md#the-wordmark-loader) gets a
line saying that the loader is the only wordmark on the page while it waits.
[web-client.md](../project/web-client.md)'s `HomeLogo` row lists where the corner mark is *not*
drawn, so the loading article page goes in that list.
