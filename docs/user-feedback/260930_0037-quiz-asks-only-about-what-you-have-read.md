---
reports: spya-hhdj7f
ending: shipped
---
# The quiz asks only about what you have read, and says how much that is

**[SPIDERYARN-READING2-61](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-61)** · reported
2026-09-30 00:37 UTC · kind: suggestion · from an admin (Greg) · *shipped* · Sentry resolved by the building session, 2026-09-30

Build `6d09e3cc`, article `dongetal25-spya-vfmvmm`, in Quiz.

## What the reader said

> I would like to have a sense of which bits of the article the user has read. So what I'd like to do
> is roughly every second or so make note of which blocks are visible in the text on the page. You
> know, maybe get partial points if a block is partly visible. And if you do that every second or so,
> then even if, you know, then I guess if you're scrolling fast, you probably might pick up on a block
> very briefly. Or maybe even we could do it more than once a second, and then that would give us a
> really accurate read. And obviously we don't want to send that data up to the server many times a
> second. So perhaps we keep an internal sort of log or count of the amount of time spent for each
> block visible on the screen. And then once every so often, I don't know, every minute or something,
> and/or when we, you know, maybe we store it in the browser local storage or something, and then,
> you know, send it up to the server every minute or so. And we can do a lot with that data. The most
> obvious thing might be to give a visual indication of what you have and haven't read, perhaps in
> the spine and/or perhaps in the text as well. And I don't know how to do that subtly, but it would
> be great if we could. It could be the background color for the block or a vertical line to one side
> or something like that.
>
> (Okay, I just lost a bunch of voice recordings, so I might be repeating myself or missing things
> out.)
>
> I think what I went on to say was that if we have, that we can calculate how much you've read of
> the article and how far you've read. That second one is a bit more ambiguous, but anyway. And that
> if we know in, for example, the quiz mode, which blocks each question relates to or which sections
> it relates to, then we can filter. So we generate questions for the whole article, but we might
> filter, you know, if there's a tick box that defaults to only show me questions for stuff I've
> read, and then it would only show quiz questions for the stuff that the user has read.

## What we did

**The tracking already existed.** It was built on 2026-09-16 from your report 41
([260912_1227](260912_1227-where-you-have-spent-time-reading.md)), and it works the way you describe
here: a heartbeat every second, partial credit for partly visible passages, totals sent once a minute,
a thicker spine and a faint gutter line where you have read. It is behind **Experimental features**.
Nothing here builds a second tracker.

**New, on `dev`:** in Quiz, with Experimental features on —

- **An "Only what I've read" tick-box, on by default.** The questions are still written over the whole
  article, but you are only walked through the ones whose passages you have read. A passage counts as
  read once it has been on screen for about 70% of the time it takes to read it. A question counts
  only if **every** passage it is about counts.
- **How much of the piece you have read**, beside the tick-box: "about 40% of the piece read so far".
  Only the article's own text counts, not its footnotes or bibliography, so skipping those doesn't
  hold you under 100%.
- If you skip a step because you haven't read its passage, the next question shows the one-line
  reminder of the step before it, since you didn't just answer that step.

[The plan](../plans/260930e-quiz-only-asks-about-what-you-have-read.md). GPT Sol reviewed the plan
([six changes, all taken](../plans/260930e-quiz-only-asks-about-what-you-have-read-review-sol.md)) and
the code.

## The privacy wording

The /privacy bullet about reading time named the outline and margin as the only use, and the quiz now
used the totals too. Your answer (2026-10-01) was not to list which features use them, so the bullet
now reads *"Some of Spideryarn's features use it — to show you where you have been, for example"*,
and the page's date moved to 1 October. Nothing about what is kept changed. Shipped on `dev` in
COMMIT_SHA — [261001a](../plans/261001a-privacy-reading-time-wording.md).

## What we did not build

- **"How far you've read"** — the furthest point reached, or a button to go back to it. You called it
  ambiguous yourself, and it was already deferred in reading-time.md.
- **The figure anywhere but the quiz**, for example on the spine or the shelf.
- **Remembering the tick-box between visits.**
- **Keeping unsent seconds in browser storage.** A batch that fails to send is dropped rather than
  retried, because a retry could count the same minute twice. That loses at most a minute.
- **Tracking for readers with Experimental features off**, which is still deferred.
