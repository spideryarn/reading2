# Your place in an article follows you to another device

**Status: awaiting Greg** ([q-mpq9dp](../user-feedback/questions/q-mpq9dp.md)). Nothing here is
built. Report `spya-e23tee` (#732, problem, Greg, 2026-10-29 00:19 UTC, SPIDERYARN-READING2-Q3);
note [261029_0019](../user-feedback/261029_0019-reopened-at-the-top-on-a-browser-that-had-never-seen-the-article.md);
postmortem [261029a](../postmortems/261029a-a-place-kept-per-browser-read-as-the-readers-own.md);
GPT Sol's plan review [261029f-plan-review-sol.md](261029f-plan-review-sol.md).

> I just reloaded this article, and even though I've read it before and I was like halfway through
> it, it hasn't seemed to remember where I was, and it's opened it again at the top, whereas it's
> supposed to scroll down to where I was last at.
>
> — Greg, 2026-10-29 (spya-e23tee)

## What happened

Read from production (feedback rows, read-only): Greg's reports on this article that evening were
filed from `?at=spya-baq5n8&mode=explanations` (23:26), `?at=spya-fu9t2e&margin=1` (23:32, 23:39),
`?at=spya-m5keyt&margin=1` (23:46), `?at=spya-n7zjq0&margin=1` (23:53) and
`?at=spya-uyn4sz&margin=1&mode=structure&structure=expanded` (00:12). All the same build,
a3d0f98e, so no deploy in between. **This one was filed from exactly `?mode=chat&guide=1`.**

That string is the first-open default (`GUIDE_FIRST_OPEN`,
[`first-open-purpose.ts`](../../src/web/first-open-purpose.ts)), which
[`last-view.ts`](../../src/web/last-view.ts) § `claimFirstOpen` appends to a bare address only when
the browser holds **no key** for this reader and article. A key holding `""` would have opened plain
at the top; a key holding a place would have restored it.

**One other path writes `guide=1`** (Sol F1): the command bar's *Guide* row (`openTheGuide`,
[`Reader.tsx`](../../src/web/reader/Reader.tsx)), and a reload while it is pending would suppress
the restore, because `mode` and `guide` count as article state. But that row adds to the address
rather than replacing it, so mid-article it gives `?at=…&margin=1&mode=chat&guide=1`. Greg's
address has neither `at` nor the `margin=1` he had on all evening. So the evidence supports the
narrower conclusion Sol asked for (F2, F5): **in the browser that opened it, there was no key for
Greg's account and this article.** That is consistent with a different browser (he reads on a laptop
and on an iPad, partly as a home-screen web app, whose storage on iOS is separate from Safari's:
his reply `spya-rrvwca`, 2026-10-28) or with cleared site data. Production cannot tell which: the
row carried no diagnostics, and the app's database role cannot read auth sessions.

**Ruled out in a real browser**, local dev, a 21-section article, desktop Chrome at 1400×900:
reload mid-article (with and without Chat open), a bare reopen in the same tab and in a new tab,
Structure expanded with the margin, the shelf and back, the Metadata page and back, two tabs on one
article, sign-out and back in, and a lapsed session. Each kept its place, and the key was never
removed or overwritten with an address lacking `?at=` while the page was mid-article. Sol found no
ordinary same-identity, same-origin path either (F5). It named three edge paths that need a second
account in the same browser, view-as, or auth that never settles (F3), none of which fits an evening
of one admin reading his own article. And it named a 300ms window (F4): a reload during `?at=`'s
debounce, in a tab whose `guide=1` is still pending, keeps the guide and loses the new `at`. That
window only exists in a tab that was itself a first open, so it does not explain this report; it is
noted under Stage 2.

So this is not a regression. It is the deferred half of
[260905d](260905d-remember-where-you-were-in-an-article-and-move-the-design-link-into-admin.md)
§ What is deferred (*"Any cross-device memory"*), offered to Greg in the note for `spya-qspg5a` on
2026-10-19 and not taken up then.

## The proposal (option A in the question): the simpler v1 Sol suggested

**The server keeps the owner's paragraph in each article, and a browser with no memory of its own
uses it.**

1. **Stored.** A new table, `reading_place`: `article_id` (primary key, cascade on delete),
   `block_id` (validated as a block id of the article, like `reading_time`'s join), and `saved_at`
   (*Store when it happened*). Only the paragraph, not the mode or band, and no device id (Sol
   F11). Owner-only, like reading time; a visitor keeps today's per-browser memory only.
2. **Written with reading time's flush** (`useReadingTime.ts`: every 60s, on the tab going hidden,
   on `pagehide`). The `POST /api/reading-time/:slug` body gains an optional `place`, the paragraph
   `last-view.ts` already notes (`noteReadingPlace`). Per Sol F9: the place is tracked as dirty
   separately from the seconds, sent only when it changed, may be sent with no seconds, and is kept
   for the next flush if a send fails, because a place is replaced, not added. Last write wins on
   the server; with one reader moving one article, an out-of-order pair costs at most one flush's
   worth of staleness.
3. **Read with the owned article.** Not the reading-time GET: that runs inside `OwnedReader`, after
   the article has arrived (Sol F7). The owner's article response gains `readingPlace`, so it is
   known the moment ownership is.
4. **When it is used: only when this browser has no key for the article** (Sol F6). The device you
   have been reading on always trusts its own copy, which is at least as fresh, so the rule needs
   no clocks and nothing changes there. A browser with no key arrives at the server's paragraph
   (`?at=` by `replaceState`, then the existing `arriveAt`), unless the address carried article
   state (the link always wins, as now) or the reader has moved since arriving (Sol F8: an arrival
   generation, cancelled by any scroll, key, touch, query navigation, or change of reader or
   article).
5. **"First open" means no place anywhere.** With no key here, the guide default waits for the
   article response and applies only if the server has no place either. The save effect's mount
   write of `""` waits for that decision too (Sol F8), or it would mark the article opened before
   the server has been asked. If the article read fails, today's behaviour stands.
6. **Covered everywhere an owner's reading state is.** Deleted on ownership transfer with
   `reading_time` ([`pg-article-transfer.ts`](../../src/store/pg-article-transfer.ts), Sol F10), in
   the export ([export.md](../project/export.md)), and one sentence on `/privacy` beside reading
   time's (the paragraph you last read in each of your articles, and when).

### What it costs

- A migration (additive), a store method, two route changes, and an arrival that can move once
  after first paint on a device with no copy of its own. On the device you were reading on,
  nothing changes.
- On a genuinely new article, the guide default comes with the article rather than before it.
- One more thing about the reader kept on the server, so the privacy page changes.
- What it gives up: the mode and band you were in do not travel, only the paragraph. And once a
  device has its own copy it keeps trusting it, so reading on the laptop, then the iPad, then the
  laptop again returns the laptop to *its* last place, not the iPad's. Fixing that needs real sync
  (a server revision and per-device dirty state, Sol F6), which is the obvious next step if this
  one proves too narrow.

### The simpler options it passed over

- **B. Derive the place from reading time** (a timestamp on `reading_time`, arrive at the most
  recently read passage). No new table, but the flush stamps every block in a batch with the same
  time, so "most recent" names a minute's worth of passages, not one.
- **C. Keep it per browser, and say so.** Only the first-open fix (an article the server knows you
  have read is not a first open, so no guide; it opens at the top). Leaves the report's complaint
  standing.

## Stages, if A is chosen

1. Migration, store, routes, transfer, export: with route tests (owner only; a visitor's place is
   refused; a block id the article lacks is dropped; a place with no seconds; deleted on transfer
   and with the article).
2. Client: the dirty place in the flush; the arrival decision in `last-view.ts` as pure functions
   with tests. **The failing test first**: a reader whose browser has no key for an article, and
   whose server place names a mid-article paragraph, must arrive there, not at
   `?mode=chat&guide=1` at the top. Red today. Also Sol F4: a test that reloads during `?at=`'s
   debounce with `guide=1` pending, and a decision on whether the pending position is flushed on
   `pagehide`.
3. Browser check from two fresh contexts as two "devices": read in one, open in the other. Then
   docs (`url-state.md` § Reopening, `reading-time.md`, `privacy.md`) and the note.

Each stage gets GPT Sol's code review before it is pushed.
