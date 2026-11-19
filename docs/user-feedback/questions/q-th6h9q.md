---
id: q-th6h9q
report: spya-u0vb0a
status: open
asked: 2026-10-30
title: When the bottom bar floats on your iPad again, can you take a probe trace and a screenshot?
refs: SPIDERYARN-READING2-QB · qi-hzramwrk · docs/plans/261030e-the-bottom-bar-floats-on-an-ipad-after-a-rotation-and-the-probe-that-can-catch-it.md · docs/user-feedback/261030_1707-the-bottom-bar-floats-on-an-ipad-after-rotating.md · docs/postmortems/261030b-an-instrument-switched-on-by-reloading-cannot-catch-a-fault-that-reloading-clears.md
---
I could not find the cause of the bottom bar floating partway up your iPad, because it only happens on a real iPad. I have built a way to record it at the moment it happens. Which do you want?

A. Next time the bar floats, before you reload or do anything else, take a screenshot showing it. Then open the command bar, type probe, and press Enter. Tap the small black "probe" chip at the top left, then press mark, then copy. Send Feedback, pasting the copied text into it and attaching the screenshot. It costs you a minute, once. It narrows the three possible causes from what Safari reports, so I can fix the state the evidence supports instead of guessing. (Recommended.)

B. Ship a guess now: move the bar down to wherever the visible bottom of the screen seems to be. It might fix your iPad. But on iPhones with iOS 26, Safari deliberately keeps a bar like ours above its own floating toolbar, and this guess would push our bar underneath Safari's controls there. It also cannot fix one of the three causes at all.

C. Leave it. It is intermittent and only on an iPad.

Details

What you reported (30 Oct, from your iPad, with Search open): after rotating and resizing, the bottom bar comes back partway up the screen instead of at the very bottom. You reported the same thing on 8 Oct. That time I fixed one cause: the page could briefly be wider than the screen while it turned, which makes Safari zoom out. The build you were on today has that fix, so this is something else.

What I found: on this server, a copy of Safari's engine pretending to be an iPad never shows the bug, through any sequence of rotations and resizes. GPT Sol read Safari's source and bug reports, and three iPad Safari states give exactly your symptom: (1) Safari has zoomed the page out; (2) after the on-screen keyboard, Safari leaves the visible area slightly scrolled or with a stale height, so anything pinned to the bottom sits above the true bottom (Safari bug 218983 is almost your exact sequence, and Search puts the cursor in its box when it opens, which can bring the keyboard up); (3) Safari keeps an out-of-date screen height for pinned bars after a resize. Each needs a different fix, and from code alone I cannot tell which it is.

Why there has been no trace since 8 Oct: the recorder could only be switched on by adding ?probe=1 to the address, which reloads the page and very probably clears the bug. Now, on your account only, it records silently from the moment an article opens, keeping the last couple of hundred readings in memory, with nothing on screen. The "Viewport probe" command shows what it has recorded, without a reload. Ordinary readers who have not deliberately opened the ?probe=1 diagnostic get none of this.

Why the screenshot: Safari can draw the bar in the wrong place while every number it reports is right. If that is the case, the screenshot is the only evidence of it.

This needs the next deploy before A works. If you pick A, nothing else is needed from you until it happens again.
