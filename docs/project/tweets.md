# Tweets mode

Up: [reading-view-overview.md](reading-view-overview.md)

The article as a numbered thread, in a wide band beside the prose, each post linked to the passages
it came from. **The one mode that writes on arrival** rather than on a press.

## What it is for

> - The Tweet Thread view (which also needs its own `/read/[slug]/tweets/` url)
>
> — Greg, 2026-08-25, in [260825g](../plans/260825g-tweet-thread-page.md)

> The Tweets mode should automatically start generating (if it hasn't already generated) when opened
> (without having to click a button to kick it off)
>
> — Greg, 2026-09-12 (Sentry SPIDERYARN-READING2-3J), in
> [260915e](../plans/260915e-tweets-page-starts-writing-when-opened.md)

> In the past, we'd set up the tweet thread mode as kind of its own page, but actually I'm realizing
> that it would work to have it as a normal mode with its own left-hand column alongside the text.
> So let's do that. So instead of it having its own page, it's just going to be a normal mode with a
> left-hand column. It could be quite a wide left-hand column if that will help to make it be
> readable. And let's also add block links for each tweet item to relevant place in the text for
> that tweet item, so that if I'm reading the tweet item, I can see where in the text it came from.
> And if you can see any other minor ways to improve the interface, feel free to, yeah, make small
> further improvements.
>
> — Greg, 2026-09-29, in [260929f](../plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md)

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## How it got here

A page of its own at `/read/<slug>/tweets` until 2026-09-29; that
address now redirects to `?mode=tweets`. **The one mode that writes on arrival** rather than on a
press, on Greg's 2026-09-12 word, with a last-view restore excluded. The plans
are the reference: [260825g](../plans/260825g-tweet-thread-page.md) (why it exists, and what it
refuses to look like) and
[260929f](../plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md) (the mode, the
wide band, the links) and
[260930h](../plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md) (the band as a
share of the room, and icon-only copy buttons). The rule that writing on arrival breaks is in
[reading-view-overview.md § True across the whole view](reading-view-overview.md#true-across-the-whole-view);
[260915e](../plans/260915e-tweets-page-starts-writing-when-opened.md) is the exception.

## Where the code is

Each file's header comment says what it owns.

- [`src/tweets.ts`](../../src/tweets.ts) — the pipeline stage that writes the thread. It has no
  command line; its header says how to re-run it for one article.
- [`src/web/useTweets.ts`](../../src/web/useTweets.ts) — the thread's read and its job, and where
  opening it starts the job.
- [`src/web/modes/tweets/`](../../src/web/modes/tweets/TweetsMode.tsx) — the mode controller, for
  the owner and for a visitor; [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) draws the thread.

---

Up: [reading-view-overview.md](reading-view-overview.md)
