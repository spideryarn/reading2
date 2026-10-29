---
id: q-mpq9dp
report: spya-e23tee
status: open
asked: 2026-10-29
title: Should your place in an article follow you to your other devices?
refs: SPIDERYARN-READING2-Q3 · docs/plans/261029f-your-place-in-an-article-follows-you-to-another-device.md · docs/plans/261029f-plan-review-sol.md · docs/postmortems/261029a-a-place-kept-per-browser-read-as-the-readers-own.md · docs/user-feedback/261029_0019-reopened-at-the-top-on-a-browser-that-had-never-seen-the-article.md
---
Your place in an article is remembered only by the browser you read it in, and the one you reopened Consciousness in AI in had no record of it. Should the place be kept on the server too, so any of your devices can pick it up?

A. Yes, the paragraph only (recommended). The server keeps the paragraph you last read in each of your articles, sent with the reading-time update that already goes every minute. A browser that has never seen the article opens there instead of at the top, and no longer greets you with the new-article guide. The browser you were reading on keeps using its own memory, which is at least as fresh. Costs: a small new table, one line on the privacy page, and on a new device the page may jump to your paragraph a moment after it draws. Gives up: the mode you were in does not travel, only the paragraph; and once a device has its own memory it trusts that, so laptop, then iPad, then laptop again takes the laptop back to the laptop's last place, not the iPad's.

B. Yes, and full sync. As A, but the newest place wins on every device, mode included. Fixes the laptop-iPad-laptop case. Noticeably more machinery (tracking which device moved last, without trusting their clocks). I would do A first and only do this if A proves too narrow.

C. No, keep it per browser. Only stop the new-article guide appearing on an article the server knows you have read; it would open plain at the top. Cheapest, but leaves what you reported.

Also useful, if you remember: was the reopen on a different device or browser from the one you had been reading in that evening (for example the iPad's home-screen app rather than Safari)? Nothing I could find makes the same browser forget, and an answer either way would confirm it.

Details

What you reported (spya-e23tee, 29 Oct, 00:19): you reopened Consciousness in AI, which you were about halfway through, and it opened at the top.

What I found. Your other reports on that article that evening were sent from addresses that named your place, the last at 00:12 in the section on other theories of consciousness. This one was sent from the exact address the app uses the very first time a browser opens an article: Chat with the guide, and no place. The app only does that when the browser has no memory of the article at all. Same build all evening, so no deploy in between.

I tried to make the same browser forget, on my own copy, in a real browser: reloading mid-article (with and without Chat open), reopening in the same tab and a new tab, Structure with the margin, going to the shelf and back, the details page and back, two tabs, signing out and back in, an expired sign-in. Every one kept the place. GPT Sol read the code for any other way and found none in ordinary use. The memory lives in each browser's own storage, and on an iPad the home-screen app's storage is separate from Safari's, so the likeliest story is the place you had reached was in a different browser from the one you reopened in. Cleared site data would look the same. I can't tell which from production.

Why this is a question and not a fix. When you first asked for this (5 September) you said "It's fine for this to be local to the device/browser, or whatever is simplest", and the other-device half was deferred. It was offered again on 19 October and not taken up. Doing it means storing a little more about you on the server, so it is your call.

How A works. The reading-time update that already goes to the server every minute (and when you switch away or close the tab) also carries the paragraph you are on. When you open one of your articles in a browser that has never seen it, the server's paragraph is used, unless the link you followed named a place of its own or you have already started scrolling. Only you, on your own articles; someone reading a shared article keeps today's per-browser memory. It is deleted with the article, deleted if the article changes owner, and included in the export.

What would decide it. If you mostly finish an article on one device, A is plenty. If you regularly move back and forth between devices mid-article, B is what you actually want, and A is the first half of it.
