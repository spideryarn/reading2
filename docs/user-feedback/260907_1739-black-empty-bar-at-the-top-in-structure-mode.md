# A black empty bar at the top, in Structure mode

**[SPIDERYARN-READING2-2E](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2E)** · reported
2026-09-07 17:39 UTC · kind: suggestion · *shipped*

## What the reader said

> There seems to be some kind of black empty horizontal bar at the top of the screen, for example in
> the structure mode. I wonder if that's a hangover from the bar at the top of the hierarchy mode, or
> if it's something else. But can we get rid of it?

## What we did

Yes to both halves of the guess. It was the controls bar — Hierarchy's granularity pills and nothing
else — still rendered as `<div class="controls"></div>` on every other reading view, 44px tall, with
the whole page pinned under it by `--bar-bottom`. In a band mode it could not even slide away, because
a guard holds the bar down whenever a mode is open so that a phone reader keeps the way out.

Reproduced in Chrome before anything was changed, then fixed as **stage 3 of
[260905g](../plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md)**, which had
specified it and not built it. `Reader` now draws the bar only when it has something in it, and the
band starts at the top of the screen. Hierarchy is unchanged.

The comment-transport error that used to live in that bar moved to the Dock's Comments button, or a
refused delete would have summoned the strip back mid-read.

[The plan](../plans/260908a-the-top-bar-stops-being-drawn-when-it-has-nothing-in-it.md) has the
measurements, the two GPT Sol reviews, and one thing left for Greg: the sanitiser lets an article
forge a `class="controls"` of its own, which this change made worth closing properly and which is a
defence an unattended run does not edit.

## `-2F` is a separate bug, and was left alone

[SPIDERYARN-READING2-2F](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2F), filed two
minutes later, says the Dock is always visible on an iPhone in landscape. Both were reproduced here
and they are **not one cause**: this one is a bar with nothing in it, and that one is the Dock's own
guard, which Greg asked for on 2026-08-31 and which is doing exactly what it was asked to do.
Nothing in this change touches `--dock-bottom`. The measurements are in the plan, under
§ `-2F` is a different bug, so that report's session can start from them.
