# The wordmark's animations were not showing

**[SPIDERYARN-READING2-3P](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-3P)** · reported
2026-09-12 10:32 UTC · kind: suggestion, handled as a bug · from an admin (Greg) · *shipped*

## What the reader said

> The playful animations for the Spideryarn logo/wordmark animation don't seem to be showing. Our at
> least I'm not finding them. Ideally they should show up on hover or movie-tooltip click tried
> anther the logo is present

Dictated; the last sentence read as *"on hover, or on a tap, wherever the logo is present"*. On the
reading view (`temporal-context-reinstatement-spya-dhqkf9`), build `d358f773`, most likely the
home-screen iPad he filed `-3Y` from shortly afterwards.

## What we did

**Nothing was broken. More than half of the animations were moving letters that were not on the
screen.** The reading view's bottom bar hides the word "Spideryarn" first of anything when it runs
short of room. Measured, that is every window up to 1920px wide, and an iPad, leaving only the
spider. Seven of the thirteen animations move only the letters. So seven hovers in thirteen did
nothing visible, and on a touch screen the only trigger is holding the logo down, which nobody would
guess.

**Shipped on `dev`:**
- The animations now draw only from the ones that can be seen. Where the word is hidden, that is
  the six that move the spider.
- The spider beside the heading on your shelf now plays them too: on hover, and on a tap, because a
  tap there does nothing else.
- The sweep of light round the spider fits it properly now. It was drawn about 5% short.

GPT Sol reviewed the plan and the code. Plan:
[260915c-logo-animations-draw-only-what-can-be-seen.md](../plans/260915c-logo-animations-draw-only-what-can-be-seen.md);
why it hid for a week:
[the postmortem](../postmortems/260915c-logo-animations-drew-into-hidden-letters.md).

**Not changed, and yours to decide:** on the reading view a tap on the logo still takes you home, so
on the iPad you get an animation there only by holding it down. It could work like the link cards
now do: the first tap plays one and the second goes home. That doubles the cost of the way home for
everyone, so it wasn't done unasked. Say if you want it.

**Also worth knowing:** with Reduce Motion on, most of these finish instantly by design, so they
will look like nothing happened. And the hold has not been tried on a real iPad, only in an
emulated one.
