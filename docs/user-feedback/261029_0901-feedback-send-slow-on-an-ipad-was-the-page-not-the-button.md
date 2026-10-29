---
reports: spya-bewb4q
ending: shipped
comment: The wait before Sending was the page re-checking the whole article after every change; fixed. Closing is still slow on a long article, because the dialog makes the page inert. That is question q-f7xm4h.
---
# Feedback's Send was slow on an iPad because of the page, not the button

`spya-bewb4q` (#736, problem, [SPIDERYARN-READING2-Q7](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Q7)), from Greg (admin; `feedback-reporter.ts` exit 0 on the production
row). Filed 2026-10-29 09:01 UTC from
`/read/arxiv-2308-08708-spya-xax6v4?at=spya-e8jmnr&margin=1`, build 8352c47a. No screenshot, no
diagnostics. Addenda: none.

> On an iPad, and it's quite an old iPad, with the feedback dialogue, after I've written the text in
> the box and then I click the send button, often there's a delay of a couple of seconds where
> nothing happens. And then if I carry on waiting, the send button changes to whatever it changes
> to, like I think the dot dot dot to show that it's sending, and then the dialogue disappears as
> it's supposed to. So everything works. It's just there's this delay between clicking send and any
> kind of UI acknowledgement that something is happening. And also it just takes a while. I wonder
> if it's because the iPad has a slower processor. Are we somehow doing a lot of work just to click
> the send button? It's not the end of the world, but I wonder if we can improve the experience.

**Ending: shipped**, on `dev`, not deployed, for the wait before *Sending*. The slow close after it is
not fixed: queue item `qi-qs3q794t`, waiting on question `q-f7xm4h`. Plan, evidence and reviews:
[261029k](../plans/261029k-feedback-dialog-slow-send-and-scroll-leak-on-a-long-article.md).

## What we found

- The third report of this, after [260905_1802](260905_1802-spinner-on-the-send-button.md) and
  [261018_2338](261018_2338-feedback-send-drawn-at-full-strength-while-it-works.md). Both looked at
  the button. This time we measured the page, in Chrome slowed six times to stand in for an old
  iPad, on long articles ([261029a](../investigations/261029a-feedback-dialog-cost-on-a-long-article-measured-at-six-times-throttle.md)).
- **Yes, we were doing a lot of work on the press, and it was not the Send code.** The server answers
  in a fifth of a second. The rest was the browser restyling the article, and the bigger the
  article, the longer. Two causes:
  1. About fifteen style rules asked "is there a bar / a band / a chip anywhere on the page?", and
     the browser answered by searching the whole article again after any change, including a
     keystroke or the press of Send. About 1.4 s before *Sending* showed, on a book.
  2. Opening and closing a modal dialog makes the rest of the page inert, and browsers do that by
     restyling every element: 13–15 s to close, on a book, at that speed. That is the *"it just
     takes a while"*.
- For an admin, the hidden Earlier tab (all 108 questions) was also redrawn on every keystroke and
  on the press.

## What we did

- Those style rules now read facts the app sets directly on the page, so a keystroke no longer
  searches the article. A test fails on any new rule of that shape
  ([postmortem 261029c](../postmortems/261029c-a-has-selector-anchored-above-the-article-walks-the-whole-document-on-every-change.md)).
- The hidden Earlier tab is not redrawn while hidden.
- **Measured afterwards**, same book, same 6× slowdown: press → *Sending* on screen went from about
  1.4 s to about 0.7 s, and each keystroke from 1.0–1.4 s to about 0.5 s. Half, not instant: what is
  left is the cost of drawing anything at all on a page that big at that speed, which the same test
  with every one of those rules deleted could not beat either.
- Not changed: the close. Fixing it means replacing the browser's own modal with one of ours that
  leaves the page alone, which is a trade, so it is asked as `q-f7xm4h`
  ([postmortem 261029d](../postmortems/261029d-a-modal-dialog-inerts-every-element-so-opening-and-closing-cost-the-whole-article.md)).
- Not proved on a real iPad.
