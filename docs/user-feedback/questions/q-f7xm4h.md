---
id: q-f7xm4h
report: spya-k3g78t
status: open
asked: 2026-10-29
acted: spya-es54ka
title: Feedback without freezing the article: keep it looking as now, or make it a panel with the article usable behind it?
refs: SPIDERYARN-READING2-Q6 · SPIDERYARN-READING2-Q7 · qi-fgzhsspd · qi-qs3q794t · docs/plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md · docs/investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md · docs/user-feedback/261029_0859-feedback-dialog-scroll-leaks-while-the-page-is-restyled.md · docs/user-feedback/261029_0901-feedback-send-slow-on-an-ipad-was-the-page-not-the-button.md
---
You're right that I treated "modal" as a requirement when it isn't one, and I've dropped the 200-line custom dialog. The browser's dialog has a lighter, non-modal form that doesn't freeze the article, and switching to it is a small change, not a library. What's left is a product choice: while Feedback is open, should the article behind it be usable?

```
 A. looks as now                  B. a true panel
+----------------------------+    +----------------------------+
|// article, dimmed /////////|    | article, normal            |
|// a tap closes Feedback ///|    | scroll it, select text,    |
|// a swipe does nothing ////|    | follow links, open panels  |
|//+----------------+////////|    |  +----------------+        |
|//| Feedback       |////////|    |  | Feedback       |        |
|//| [text box]     |////////|    |  | [text box]     |        |
|//|       [Send]   |////////|    |  |       [Send]   |        |
|//+----------------+////////|    |  +----------------+        |
+----------------------------+    +----------------------------+
```

A. Looks and behaves exactly as now: dimmed article, a tap outside closes Feedback and keeps what you typed. Only the inside changes: the browser no longer freezes every element of the article on open and close (recommended, as a first step). Smallest change, fewest side effects. Cost: you still can't read the article while writing.

B. A true panel, like Comment and Chat: the article stays bright and usable behind it. Nicer if you want to scroll back to quote something while writing. Cost: more to get right. Following a link mid-report must not re-file the report against the new page, Feedback has to be stacked against the dock and other panels, and Tab and screen readers can wander into the article.

C. Leave it. Typing and Send already got about twice as fast in the fix that went to production on 29 October.

I recommend A now; if you then want to read while writing, B is a follow-up on top of it. Either way I'd test on your iPad before calling the scroll leak fixed.

Details

Your two reports (29 October, iPad, the arXiv paper 2308.08708): scrolling in Feedback sometimes scrolled the article instead, and after Send there was a pause of a couple of seconds, then a slow close. You asked if we were using the right abstraction or library. I proposed our own modal dialog, about 200 lines. You said opening isn't that slow, it's really a panel, and asked whether a library would help.

My diagnosis was too confident. The seconds I quoted came from Chrome slowed six times on a 250-page book with about 87,000 elements, not your iPad on that paper. That test does show a modal dialog doing work across the whole article on every open and close: on a modal, the browser "freezes" the page behind it by restyling every element. In that same test the non-modal form took about 0.8 s to open and too little to measure to close, against 10 to 16 s each for the modal one. Those are Chrome numbers, not your iPad's. The slow close after Send is plausibly this; it is not proven.

The scroll leak never happened in Chrome. My guess is that on the iPad a swipe landed while the page was busy freezing or unfreezing. A or B removes that suspect, but doesn't prove a swipe can't still pass through, so I'd test: a swipe right after opening, at the top and bottom of the box, in the text box, and with the keyboard up.

Libraries we have, briefly:
- shadcn / Radix (installed): its Dialog has a non-modal mode, which would work, but its defaults need undoing for us (tap outside closes, Tab loops inside, its own Escape handling to fit with ours). Its modal mode, which shadcn's Dialog and Sheet use, also does page-wide work (locks scrolling, changes the whole body's style); not measured here.
- Floating UI (installed, used by Search): helpers for focus and dismissing; a reasonable aid if B needs them.
- Drawer (vaul): not installed; a drag-up drawer, a different interaction.
- TanStack: only its table library is installed; nothing for dialogs.
None of them is needed for A: the browser's own non-modal dialog does it.

What A involves, so the size is honest: the open call changes, plus a handful of places that assume any open dialog is a modal one (Escape for Feedback itself, which currently defers to "the open dialog", i.e. to itself; the dim-screen setting, which would dim Feedback twice), and putting focus in and back by hand, because older iPad Safari is unreliable at it for non-modal dialogs.

Your reply, 2026-10-29 (to the earlier version of this question, which offered our own 200-line modal dialog or nothing):

"I'm not totally convinced by your diagnosis. It's not that slow to open, and it's not really a proper dialogue. It's like a panel, it's a UI. So I just feel like you're overcomplicating the system, or you're misdiagnosing it. Is there something in shadcn or Tanstack or whatever library were using or anything like that that would help?"
