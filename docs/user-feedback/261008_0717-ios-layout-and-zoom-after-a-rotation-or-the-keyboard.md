---
reports: spya-gxbwug
ending: shipped
comment: Rotation fixed: the page can no longer be wider than the screen mid-turn, which is what made Safari zoom out. The keyboard case is queued; if it recurs, open the article with ?probe=1 and send the trace.
---

# The layout and zoom after an iPad or iPhone rotates, or the keyboard goes away

A bug report from Greg (admin; `feedback-reporter.ts` exited 0 on the report's production row),
2026-10-08 07:17 UTC, build `760f70a2`, on `2608-13566v1-spya-yurten`. Queue item `qi-sd74q8t8`.

`spya-gxbwug` ([SPIDERYARN-READING2-EP](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-EP)):

> On iPhone and iPad, sometimes the layout and zoom gets a little bit messed up after, for example,
> switching from portrait to landscape, or if the keyboard has appeared and then been dismissed. For
> example, on iPad, afterwards sometimes the bottom bar will be appearing, you know, partway up the
> screen, or the article text won't take up all of the horizontal space...

## What we did

**Both symptoms are one state: Safari has zoomed the page out.** At a zoom of 0.7 the page is
drawn at 70% of the screen's width and height, so the article stops short of the right edge and
the bottom bar sits 30% of the way up.

**Our part was the reason Safari had to zoom out.** The reading view's widths are pixels worked out
for the window as it was. On a turn from landscape to portrait, the page stayed sized for
landscape until our code heard about the rotation. In WebKit with iPad emulation that was 360px
too wide for up to 650ms, and 266px on an iPhone. iOS Safari picks the new zoom during exactly that
gap, before any of our code can run, and a page wider than the screen gets zoomed out to fit.
GPT Sol read this in WebKit's own source. WebKit is meant to zoom back in once the page fits;
"sometimes" is when it does not.

**The fix:** the reading view now clips anything sideways that is wider than the screen, and its
minimum width is capped at the page. Once the page has settled, neither changes anything. During
the turn, the page is never wider than the screen, so Safari has nothing to shrink. A new browser
test lays the page out at landscape size and narrows it without letting the code catch up, in
Chrome and WebKit. It was red before the fix (1194px against 834) and is green after.

**What we could not check here:** this box's WebKit does not do iOS's zoom-to-fit at all, so the
zoom itself is reasoned from WebKit's source rather than watched. The over-wide page that
triggers it is measured.

## The keyboard half

Not reproduced, so not built. Focusing and dismissing the chat composer and the Feedback box in
emulation changed nothing, and nothing in the app depends on the keyboard for its width. The likely
cause is a known WebKit bug (254861, 297779): after the keyboard closes, iOS can leave the visible
area scrolled down inside the page, so a bar pinned to the bottom is drawn above where the screen
ends, until you scroll. A workaround is specified in the plan but deliberately not shipped blind.
It is queued as `qi-hzramwrk`: if it still happens after this deploys, open the article with
`?probe=1`, dismiss the keyboard, and send the trace. That tells the two causes apart.

[The plan](../plans/261008b-ios-layout-and-zoom-after-a-rotation-or-the-keyboard.md) has the
measurements and both GPT Sol reviews;
[the postmortem](../postmortems/261008a-a-width-from-the-last-render-meets-the-browser-before-the-next-one.md)
names the class.
