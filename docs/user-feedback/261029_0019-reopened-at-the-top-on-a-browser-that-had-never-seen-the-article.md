---
reports: spya-e23tee
ending: awaiting
comment: The browser you reopened it in had no memory of the article (your place is kept per browser). Asking whether it should be kept on the server so other devices pick it up.
---
# Reopened at the top, on a browser that had never seen the article

Report #732, `spya-e23tee`, Greg (admin, `feedback-reporter.ts` exit 0), problem, filed
2026-10-29 00:19 UTC from
`/read/arxiv-2308-08708-spya-xax6v4?mode=chat&guide=1`, build a3d0f98e. Sentry
[SPIDERYARN-READING2-Q3](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-Q3). No addenda.

> I just reloaded this article, and even though I've read it before and I was like halfway through
> it, it hasn't seemed to remember where I was, and it's opened it again at the top, whereas it's
> supposed to scroll down to where I was last at.

**Ending: awaiting Greg**, question [q-mpq9dp](questions/q-mpq9dp.md). Nothing built.

- **What it was.** The address it was filed from is exactly the first-open default, which the app
  applies only when the browser holds no memory at all of this reader and article. His six earlier
  reports that evening, on the same build, all named a place (the last at 00:12, in Structure). The
  command bar's *Guide* row also writes `guide=1`, but it would have kept the place and the margin on
  the address, and this address had neither. So the browser that opened it had no key for his
  account and this article: most likely a different browser from the one he had been reading in (the
  iPad's home-screen app keeps its storage apart from Safari's), possibly cleared site data.
  Production cannot say which.
- **What was ruled out.** In a real browser on local dev: reload mid-article with and without Chat,
  a bare reopen in the same tab and a new one, Structure with the margin, the shelf and the details
  page and back, two tabs, sign-out and back, an expired session. All kept the place. GPT Sol read
  the code for any ordinary same-browser path and found none
  ([its review](../plans/261029f-plan-review-sol.md)).
- **Why it waits.** The place has been kept per browser since 2026-09-05, on Greg's *"local to the
  device/browser, or whatever is simplest"*; the other-device half was deferred, and offered again
  in the note for `spya-qspg5a`. Keeping it on the server stores more about the reader and changes
  `/privacy`, so it is his call. The recommended option, the paragraph kept beside reading time and
  used only by a browser with no memory of its own, is
  [plan 261029f](../plans/261029f-your-place-in-an-article-follows-you-to-another-device.md).
- **Postmortem** [261029a](../postmortems/261029a-a-place-kept-per-browser-read-as-the-readers-own.md):
  the class is a per-device memory answering a per-person question, made worse when "this browser
  does not know" became "first open" (815a2608e, 2026-10-05).
- **Waits on nothing else.** No model call was needed, so the box's OpenRouter limit (until
  1 November) held nothing up.
