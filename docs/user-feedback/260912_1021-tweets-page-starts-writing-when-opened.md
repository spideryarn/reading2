# The Tweets page writes the thread when it is opened

**[SPIDERYARN-READING2-3J](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3J)** · reported
2026-09-12 10:21 UTC · kind: suggestion · from an admin (Greg) · *shipped*

## What the reader said

> The Tweets mode should automatically start generating (if it hasn't already generated) when opened
> (without having to click a button to kick it off)

Build `d358f773`, on `temporal-context-reinstatement-spya-dhqkf9`.

## What we found

It already did, but only on a **press**. Since 2026-09-06, pressing Tweets in the bottom bar or
taking its row in the command bar started the thread. Arriving any other way — a reload, a pasted or
bookmarked link, Back or Forward, or a second visit after the one automatic try — showed *"Nobody
has written a thread for this one yet."* and a **Write the thread** button, which is what Greg met.
A browser pass on dev confirmed both halves: presses at 1400px, 390px and from the command bar each
started a job; 21 direct loads started none. At phone width the Tweets link sits past the right edge
of the bar and has to be scrolled to.

## What we did

The page now writes the thread on **any** arrival by the article's owner that finds none — one
automatic try per article per page load, the same request the button makes, and one re-read if the
first read fails. The press-only machinery for Tweets was removed rather than left beside it. The
other modes are unchanged: they still start on a press only, because their `?mode=` survives
navigation in a way a page's own path does not.
[260915e](../plans/260915e-tweets-page-starts-writing-when-opened.md) has the reasoning and both
GPT Sol reviews.

## Two decisions left with Greg

1. **Opening now spends even when nobody chose Tweets just then.** Two cases: going Back or Forward
   onto the thread page after a full reload (or in a restored tab), and signing in while already on
   a thread page's address. Each is at most one run per article per page load, on the owner's own
   article. If you would rather those didn't spend, going back to press-only is a small change —
   say so and it is a one-line revert in `Tweets.tsx` plus re-arming the two links.
2. **Re-runs have no per-owner spend cap on the server, and never have.** Billing slots cover new
   articles only; `POST /api/jobs` for a step like Tweets is deliberately outside them. This change
   bypasses nothing, but it does make a paid re-run happen without a press, which makes the
   missing cap more worth deciding. Nothing was built — a cap would be a billing defence, which is
   yours ([billing.md](../project/billing.md)).
