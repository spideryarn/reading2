# Your place in an article follows you to another device

**Status: built, option A, on `dev` 2026-10-29; migration `20261029093800_reading_place` waits for the next deploy** (Greg's reply `spya-hfufq8` to
[q-mpq9dp](../user-feedback/questions/q-mpq9dp.md), 2026-10-29: *"A"*). See § As built, at the end. Report `spya-e23tee` (#732, problem, Greg, 2026-10-29 00:19 UTC, SPIDERYARN-READING2-Q3);
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

## As built (2026-10-29)

Three changes from the proposal, made while reading the code, each simpler than what it replaced.
GPT Sol reviewed them before the client was built
([261029f-build-review-sol.md](261029f-build-review-sol.md)).

1. **The decision is made when the article arrives, before the prose is drawn**, not as a late
   arrival afterwards. `useArticleAccess` hands the owned response's `readingPlace` to
   `settleSavedPlace` (last-view.ts) before it sets its answer, so the `?at=` is on the address
   before `Reader` first arrives (on Metadata→article, Reader's first render can precede it, and
   `notePlace` already allows for that ordering, Sol's Q2), and `useReadingPosition` reads it exactly
   as it reads a restore. With
   nothing drawn there is nothing the reader can have scrolled, so Sol's F8 arrival generation is
   not needed: what is checked at the decision is the same as `firstOpenHref` checks (the address
   still names this article's reading view and carries no article state) plus a fresh read of the
   key, in case another tab wrote one meanwhile. The answer is also kept for the tab's current
   article, so an arrival on Metadata that steps into the reading view decides at once from the
   response already fetched.
2. **The top of the article is a place too.** `block_id` is nullable: a row with `null` says *opened,
   at the top*. The flush starts each mount with the address's `?at=` as an unsent place (the spy's
   first note comes before it subscribes, Sol F3), so the first open on any device writes a row, and
   "first open" means no row anywhere. **And an article with stored reading time but no row** answers
   `{ block: null }`: read before, place unknown, so it opens plain rather than at the guide. One
   `exists` in the same query. A saved block today's body lacks (identities outlive re-extraction)
   is the top too, in access.ts (Sol F5).
3. **The add page's marked first open does not wait.** An article the add page has just made has no
   place anywhere, and that path's coordinator (first-open-purpose.ts) is left exactly as it is.

Until the article arrives with no key here, the save effect does not write the `""` marker (Sol F8),
so a reload in that moment asks the server again. Any answer that is not an owned article with a
place (a visitor, a failed read, an unread paper) is today's first open.

**Sol F4, decided: accepted, not flushed.** The window is a reload within 300ms of a scroll, in a tab
whose `guide=1` Chat has not yet turned into `thread=` (it does when its list answers, about a
second after arrival). The cost is one reopen at the guide rather than the paragraph. Flushing
nuqs's queue on `pagehide` would be a second writer of the address, for a case that needs a reader
to scroll and reload inside the first second of a first open.

The flush: the place is dirty separately from the seconds, sent with them or alone, numbered, and
marked sent only by a 2xx answer to that number's send; one place send at a time (pagehide's
keepalive excepted), so an older answer never marks a newer place sent and two cannot land out of
order (Sol F2). The route writes the place and the
seconds as two statements: a place is replaced, so a retry after a half-success costs nothing.

**The code review** ([261029f-code-review-sol.md](261029f-code-review-sol.md)) found nothing high and
fixed four smaller things itself: an answer settling in the moment after a navigation could save the
next page's address under this article; a newer place left unsent when the reading view closed with
an older one in flight; an opening `?at=` the article no longer has, sent as a place the store would
drop; and a route test that checked one half of "writes neither half". A two-browser check on local
dev (fresh storage each) saw device 2 open at device 1's paragraph and the same scroll position, and
device 1 keep its own copy.
