---
reports: spya-m5gxk9
ending: shipped
comment: On dev. While you scroll, Structure now redraws at most once a second (a click or link still moves it at once), and its rows no longer change when the bottom bar slides away and back.
---
# Structure updates calmly while you scroll

Report `spya-m5gxk9` (#705, SPIDERYARN-READING2-P4), a suggestion from Greg (`feedback-reporter.ts`
exit 0, no addenda when re-read before acting and again before this note), on a portrait iPad in
Structure's Fisheye on `arxiv-2308-08708-spya-xax6v4`. Session `fbtj0vqa-structure-ipad`, done with
`spya-tj0vqa` (the gap) as one job:
[plan 261025e](../plans/261025e-structure-on-an-ipad-updates-calmly-and-uses-its-width.md).

> I'm noticing that as I scroll around on an iPad in structure fish-eye mode, that there seems to be
> some flickering in the structure mode. So the very top area that shows the submodes, fish-eye,
> expanded and hover, occasionally disappears, and then the structure mode itself flickers. It's not
> the worst thing in the world. So if it's going to add a lot of complexity to try and fix or
> improve it, then it's not worth it. But I'm hoping there might be a way that actually simplifies
> the code and makes it work better. I think it's nice that the structure mode updates as we
> scroll. It probably only needs to update every second or two. It doesn't need to update—well,
> yeah, maybe every second might be fine, or sub-second, I suppose. If we were scrolling fast, would
> be good, but not—yeah, I don't know. We don't want to use too much CPU. We don't want to distract
> the reader too much. But I suppose it'd be nice to know where we are if we were scrolling fast.
> So yeah, it's tricky. I'm not sure what the best approach is. Perhaps this is worth doing some
> web searching to see how other implementations and guides and best practices handle it. The goal
> is to try and get to a robust, clean implementation that works generally in most situations
> pretty well. Get input from GPT Sol.

**Shipped.** Reproduced in WebKit at your iPad's size (725 × 967) on the local copy of the same
paper. There were two causes:

1. **Every section you crossed redrew the list at once.** Each redraw rebuilds the list and lays
   out five hidden copies to measure which depth fits, inside a fixed band. iOS is known to flicker
   a fixed panel whose contents change mid-scroll.
2. **The list changed when a bar moved.** At your width the bottom bar slides away as you scroll
   down and comes back as you scroll up. The band grew and shrank with it, so the list redrew at a
   different depth with no change of section (rung 4 to 3 in the trace, the moment the bar came
   back).

What changed:

- **Structure follows a scroll at most once a second.** The first change after a quiet second
  shows at once, so reading slowly feels as before. During a fast scroll it updates about once a
  second and always ends on the section you stopped in. A click on a row, a link or a Hover glance
  is never held. During the wait it reads nothing from the page, so a fast scroll costs less CPU
  too. This is the usual approach: table-of-contents "scroll spies" throttle their updates (100 to
  300ms in the libraries looked at). Ours redraws a whole fitted tree rather than moving a
  highlight, which is why a second suits it.
- **The band keeps its height when a bar slides.** It still reaches the bottom bar, but what it
  fits its rows into stays the resting height. A visitor's top bar is held while Structure is open,
  for the same reason.

After the change, the same scroll redrew 5 times, every one a change of section, with the room
steady. One small trade: keyboard ← / → is a plain scroll, so a second press within the same second
shows in Structure up to a second later. The article itself moves at once.

GPT Sol reviewed the plan and then the code. It agreed with one second and with updating at once
after a pause, and its fixes are in the plan. The disappearing sub-mode row itself cannot be shown
in a headless browser, which does not drop frames the way an iPad does under a finger. It is worth
a look on your iPad after the next deploy.
