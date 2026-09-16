# The spine now shows where you have spent time reading

**[SPIDERYARN-READING2-41](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-41)** · reported
2026-09-12 12:27 UTC · kind: suggestion · from an admin (Greg) · *shipped*

This is the **first** of the two things in report 41. The second, making "back to X" reliable, is
[260912_1227-back-to-x-across-modes-and-after-a-rotation.md](260912_1227-back-to-x-across-modes-and-after-a-rotation.md),
and it shipped separately. With both notes written, the whole report is done, so the next sweep can
resolve the issue.

Build `d358f773`, article `temporal-context-reinstatement-spya-dhqkf9`.

## What the reader said

> I would love for there to be a way to indicate where I've spent time in the article, perhaps in the
> spine and or as a kind of subtle indicator in the vertical gutter next to the text. And so perhaps
> what we could do is a heartbeat every second that makes a note of which blocks are fully or
> partially, maybe you get partial points for being partially visible.
>
> And every so often, maybe not every second, maybe every minute, we send an update to the server
> with the latest data from this heartbeat. And so we'll effectively have a data structure that says
> how much time each block has spent visible. And then we would visually indicate this.
>
> So I don't know how we indicate it on the spine. You could use the horizontal space almost like
> it's sort of, imagine it's sort of filling up towards the right. So maybe the spine is narrower in
> places where we haven't spent much time reading and thicker in places where we have spent time
> reading.
>
> And then there's something in the vertical gutter in the text as well. I could use opacity or it
> could use thickness again. I don't want it to be too obtrusive. I think this would help in a bunch
> of ways.
>
> One of the ways it would help is just seeing how far through the article I've read because I'm
> still having issues where, you know, if I switch from portrait to landscape or if I click on
> things, it takes me to other bits of the article and I sort of lose my place.

## What we did

**Shipped on `dev`, behind Experimental features.** Almost exactly as you described it:

- **Every second** the page notes which passages are on screen, and **every minute** it sends the
  totals to the server, plus once more when you switch away or close the tab.
- **The spine gets wider, from the left, where you have spent longer**, in four steps. **The gutter
  beside each passage gets a faint vertical hairline** that darkens in the same four steps. It takes
  none of the gutter's icon slots.
- **A passage counts as fully read once it has been on screen for about as long as it takes to read
  it** (230 words a minute). A paragraph you scrolled past stays faint, a long one needs longer than a
  heading, and one paragraph you stared at does not make the rest look unread.

**One change from what you said, in how a second is split.** You described each block earning time
for as long as it is visible. Instead, **each second is shared between the passages on screen, in
proportion to how much of each is showing**. Otherwise a screen of eight paragraphs would count all
eight as read in the time it takes to read one, and the spine would be uniformly thick everywhere you
had been. GPT Sol and Fable both found this independently.

**It counts only when someone could be reading**: the tab is visible, you have done something in the
last five minutes (opening the article counts), and the text is on screen. So a mode panel covering
the whole article on a phone does not count.

**Yours only.** Nobody opening a link you shared sees it or adds to it. `/privacy` now says we keep
these totals. They are in the article's export, and they go when the article is deleted.

## What we did not build

- **Recording for readers with Experimental features off.** Fable argued for it, because reading time
  cannot be filled in afterwards. It is a one-line change once you have lived with it.
- **A "take me to the furthest I read" button**, and **weighting towards the line your eye is on**.
- **Retrying a batch that failed to send.** The server adds up what it receives, so a retry could
  count the same minute twice. A failure loses at most a minute.
- **Signed-in visitors' own reading time** on an article someone shared with them.

[The plan](../plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md), with
[GPT Sol's plan review](../plans/260916c-reading-time-review-sol.md) (seven changes before any code
was written), and [the code review](../plans/260916c-reading-time-code-review-sol.md).
