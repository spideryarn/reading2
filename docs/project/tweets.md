# The thread — Summary's Thread view

Up: [reading-view-overview.md](reading-view-overview.md)

The article as a numbered thread, in a wide band beside the prose, each post linked to the passages
it came from. **One of [Summary](summaries.md)'s three views since 2026-10-03** — Brief | Fuller |
Thread — and a mode of its own, Tweets, before that. **The one view that writes on arrival** rather
than on a press.

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

> I was thinking about putting the tweet thread as a submode of summary, because they kind of serve
> related purposes. … keep all of the tweet thread. Functionality and UI, just put it within as a
> submode within summary.
>
> — Greg, 2026-10-03 (spya-thpsnd), in
> [261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md)

Open this doc to find your way in; the plans below are still where the design and its reasoning
live.

## How it got here

A page of its own at `/read/<slug>/tweets` until 2026-09-29, then the mode `?mode=tweets` until
2026-10-03, and now `?mode=summary&summary=thread`. **Both old addresses land there** — on a cold
load, on a link inside the app, and on Back or Forward
([url-state.md](url-state.md)). **The one view that writes on arrival** rather than on a
press, on Greg's 2026-09-12 word, with a last-view restore excluded. The plans
are the reference: [260825g](../plans/260825g-tweet-thread-page.md) (why it exists, and what it
refuses to look like) and
[260929f](../plans/260929f-tweets-become-a-mode-with-a-wide-band-and-block-links.md) (the mode, the
wide band, the links) and
[260930h](../plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md) (the band as a
share of the room, and icon-only copy buttons) and
[261003l](../plans/261003l-fewer-top-level-modes-tweets-become-summary-s-thread.md) (the move under
Summary, and why writing on arrival was kept). The rule that writing on arrival breaks is in
[reading-view-overview.md § True across the whole view](reading-view-overview.md#true-across-the-whole-view);
[260915e](../plans/260915e-tweets-page-starts-writing-when-opened.md) is the exception.

## What moving under Summary changed, and what it did not

- **Unchanged**: the panel — copy buttons, block links, the (i) with its counts, the profile badge,
  the stale banner, the visitor's twin — and the `tweets` step, its artefact and its route.
- **Above it** is Summary's control row, in the same place as over the paragraphs.
- **The band's (i)** opens with Summary's words and goes on to the thread's counts and who made it.
- **A press that lands on the thread arms nothing.** The band writes on arrival, so a token would
  be the plain-words run's, with nothing mounted to claim it, waiting for Back to spend it.
- **Words that still find it**: typing `tweets`, `thread` or `twitter` in the command bar opens the
  Thread view, not Summary at Brief; `rerun tweets` still writes the thread again, and `rerun
  summary` never does.
- **Sharing**: the owner's *make public* list names the thread once one is stored. A visitor reads
  a stored thread, or is told under the control that nobody has built one.
- **An import** still queues the thread with the main modes
  ([ingest-queue.md § The add page](ingest-queue.md#the-add-page)).

## Where the code is

Each file's header comment says what it owns.

- [`src/tweets.ts`](../../src/tweets.ts) — the pipeline stage that writes the thread. It has no
  command line; its header says how to re-run it for one article.
- [`src/web/useTweets.ts`](../../src/web/useTweets.ts) — the thread's read and its job, and where
  opening it starts the job.
- [`src/web/modes/summary/TweetsMode.tsx`](../../src/web/modes/summary/TweetsMode.tsx) — the thread's band, for
  the owner and for a visitor; [`src/web/Tweets.tsx`](../../src/web/Tweets.tsx) draws the thread.
  [`SummaryMode.tsx`](../../src/web/modes/summary/SummaryMode.tsx) mounts it and owns the control.

---

Up: [reading-view-overview.md](reading-view-overview.md)
