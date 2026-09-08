# The dock is there the whole time, on a landscape iPhone

**[SPIDERYARN-READING2-2F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2F)** · reported
2026-09-07 17:41 UTC · kind: problem · *shipped*

## What the reader said

> The dock used to disappear on iPhone and only reappear when I scroll. That was good because then I
> mostly had a full screen, but if I wanted the bar all I had to do was scroll. But now it seems to
> be there the whole time. I'm in landscape mode on an iPhone.

## What we did

It was a real regression, and not in the dock. A guard that pins the bottom bar whenever a mode is
open — Greg asked for it on 2026-08-31, so a reader could not get trapped in a full-screen panel —
was written as *"a band is open"* when what it meant was *"the band is the whole screen"*. On the
day it was written those were the same sentence on every iPhone. **2026-09-06 split them**, so that
a landscape iPhone could show a mode and the article side by side, and the guard went on answering
the old question. Structure mode shipping on 2026-09-07 is why it became noticeable: it is a mode
you read in rather than dip into.

Three rules now say `:where(.reader.band-covers) .mode-band`, the condition they always meant, which
`App.tsx` already writes. Measured at 844 × 390 in every band mode, the dock goes from held to gone
on scrolling down and comes back on scrolling up; at 390 × 844, where the band covers the article
and there is no other gesture, it stays exactly as it was.

Two more things came out of it, both fixed rather than filed. The **top bar had the identical bug for
signed-out visitors** — `barHasContent` renders the read-only chip for a non-owner, so a visitor has
a controls bar where an owner has none, and `shell.css`'s twin guard pinned it in every band mode.
And letting the dock go would have left the mode band stopping 56px above the bottom of the screen
on an uninstalled iPhone, reserving room for an install hint that had slid away with the bar — worse
than the bug being fixed, found by GPT Sol reviewing the built code, and invisible to every check we
have because that hint renders on no machine here.

[The plan](../plans/260908e-the-dock-hides-on-scroll-in-a-mode-unless-the-band-is-the-whole-screen.md)
has the measurement tables, three GPT Sol reviews, and the guard arm that was written and then
measured out. Nothing is left deferred: the bar, the install hint and the room the hint reserves are
now three declarations in two rules rather than three rules with three conditions, so whatever moves
one moves all of them.

## `-2E` was a separate bug

[SPIDERYARN-READING2-2E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2E), filed two
minutes earlier, was the empty strip at the top and shipped separately in
[260908a](../plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md). That
session measured this one before leaving it alone, and its table matched ours independently — two
measurements agreeing rather than one repeated.
