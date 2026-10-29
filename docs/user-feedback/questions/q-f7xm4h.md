---
id: q-f7xm4h
report: spya-k3g78t
status: open
asked: 2026-10-29
title: Should the Feedback dialog stop making the whole article inert, so it opens and closes at once on a long article?
refs: SPIDERYARN-READING2-Q6 · qi-qs3q794t · docs/plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md · docs/investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md · docs/user-feedback/261029_0859-feedback-dialog-scroll-leaks-while-the-page-is-restyled.md · docs/user-feedback/261029_0901-feedback-send-slow-on-an-ipad-was-the-page-not-the-button.md
---
On a long article, the Feedback dialog takes seconds to open and to close on an old iPad, because opening it makes the whole article "inert" (unclickable), and browsers do that by recalculating the style of every element on the page. Should we replace it with a dialog of our own that does not do that?

A. Yes, our own small dialog, Feedback first (recommended). Opening and closing then cost only the dialog, not the article: in the test, closing went from about 14 seconds to nothing on a book at old-iPad speed. It also lets us stop a swipe from ever reaching the article behind, which is the likeliest fix for the scroll leak. Cost: about 200 lines of our own code doing what the browser does for free today (keeping the keyboard inside the dialog, Escape to close), and screen readers are told "this is a dialog, ignore the rest" by a label rather than by the page actually being made inert, which older screen readers respect less well. If it works on your iPad, the six other dialogs that open the same way (the picture viewer, the command bar, and others) move to it after.

B. Not now. Keep the browser's dialog. The other fixes stay: typing and pressing Send take about half as long as before (measured: Send to "Sending" from about 1.4 s to 0.7 s at old-iPad speed), but opening and closing stay slow on a long article, 10 to 16 seconds each in the same test.

I recommend A. The slowness grows with the article, and long papers are exactly what Spideryarn is for.

Details

On 29 October you sent two reports from your iPad, a minute apart, while reading the 88-page arXiv paper 2308.08708. One: scrolling inside the Feedback dialog sometimes scrolled the article behind it instead, and waiting and trying again usually worked. You asked whether we were using the right abstraction or library for dialogs. Two: after pressing Send, a couple of seconds with no sign anything was happening, then Sending, then the dialog closed, slowly.

What we did. We measured it in Chrome slowed down six times, to stand in for an old iPad, on long articles. The server answers in a fifth of a second; all the time is the browser working on the page, and the bigger the article, the longer it takes. Three causes:

1. Some style rules asked "is there such-and-such anywhere on the page?", and the browser answered by searching the whole article again after every keystroke. Fixed: those facts are now set by the code directly. On dev now.
2. For you as an admin, the hidden Earlier tab (all 108 questions) was redrawn on every keystroke. Fixed: it is not redrawn while hidden. On dev now.
3. Opening and closing the dialog makes every other element on the page inert, and the browser recalculates every element's style to do it. That is this question.

Your question about the abstraction, answered plainly: the browser's own dialog is the standard, recommended tool, and it is not wrong. Its one weakness is exactly this cost, which is nothing on a short page and seconds on a book on an old iPad. A library would not have saved us: the usual one (Radix, which our other components come from) avoids "inert" but does something similar to the whole page instead, and fights a setting we use to stop the layout jumping. So the sturdier way is a small dialog of our own that leaves the page alone.

The scroll leak did not happen in Chrome in any test. On an iPad, scrolling is handled separately from the page's code, using the last version of the page that was ready, and while the page is still busy being restyled that version may not have the dialog in it yet. That would explain "wait and try again and it works". So the likeliest fix for it is A as well. That part is a hypothesis we could not test without your iPad.

What would decide it: whether seconds of waiting on long articles is worth 200 lines of our own code and a weaker screen-reader guarantee. If you rarely read long pieces on the iPad, B is fine for now.
