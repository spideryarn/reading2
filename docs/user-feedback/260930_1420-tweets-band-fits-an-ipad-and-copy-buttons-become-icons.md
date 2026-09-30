# Tweets: a band that suits an iPad both ways up, and copy buttons that are icons

[SPIDERYARN-READING2-6G](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6G) and
[SPIDERYARN-READING2-6H](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-6H), two
suggestions from Greg (admin, verified by `scripts/feedback-reporter.ts`, exit 0), both sent from
Tweets on `dongetal25-spya-vfmvmm`. One batched note for both. The time in the file name is when
this session picked them up; it had no Sentry access and the report text came in the brief. **No
`reports:` header**, because the feedback row ids were not in the brief. The next sweep adds them.

> The tweet thread column perhaps could be slightly wider when I'm looking at it on my iPad in
> portrait mode, and slightly narrower when I'm looking at it on my iPad in landscape mode.

— 6G

> In tweet thread mode, we have a button to copy each tweet item. Let's just have the icon. I don't
> think we need the text copy. Maybe there's a tooltip. Perhaps the same for copy the thread. This is
> part of our sort of general principle of trying to use icons and reduce the amount of text labels
> because there's just so much text already on the page.

— 6H

**Ending: Shipped, both.** On `dev`, not deployed. Resolve 6G and 6H; the next feedback sweep does
the Sentry status write.

What we did:

- **6G: the Tweets column now takes a share of the width** (about two fifths) rather than whatever
  the article leaves. Before, it took all the leftover width: stuck at its narrowest in portrait
  and its widest in landscape. Measured in WebKit with an iPad user agent and touch:
  **portrait 288 → 345px** (a 277-character post goes from 10 lines to 8), **landscape 544 →
  496px** (5 lines to 6). On a laptop 1440px or wider it is unchanged. Only Tweets moves; every
  other mode's column is as it was.
- **6H: both copy buttons are icons** with a tooltip. The per-post one says *Copy this post's
  text*. *Copy the thread* says what it adds: each post numbered, the title and link at the top.
  A copy that worked shows a tick. A copy the browser refused still says *Couldn't copy* in words,
  because a glyph change alone is easy to miss. On an iPad a tap copies straight away and the card
  closes with it, and the buttons are 40px targets under a finger.

Plan, measurements and screenshots:
[260930h](../plans/260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md).
