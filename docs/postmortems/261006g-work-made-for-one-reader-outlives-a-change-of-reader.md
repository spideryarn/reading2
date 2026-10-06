# Work made for one reader outlives a change of reader

Up: [postmortems.md](../project/postmortems.md)

Queue item `qi-bag2d33y`, 2026-10-06. Reader A has `/add/<url>` open, has typed into *Why are you
reading this?* and ticked *High-powered AI*. Another tab signs in as reader B. This tab's session
becomes B's and the add page stays mounted. B then saw A's sentence and A's tick, and the writes
the page still owed (the purpose autosave and its last flush, the High-powered retry each second)
went out with B's token: A's sentence onto B's article of the same slug, and a spend B never chose.

GPT Sol found it by reading, while reviewing
[261005l](../plans/261005l-permalink-and-share-while-an-article-is-importing.md) stage 2. **There is
no evidence it reached a reader**: it needs two accounts in one browser and an add page open across
the switch. The fix is `4fc001a6d`, and its plan is
[261006e](../plans/261006e-add-page-forgets-everything-when-the-reader-changes.md).

## The class: work made for one reader, held by something that outlives the reader

The work is A's. The thing holding it is not A's: a component instance that survives a session
change, a ref keyed on the address, a module-level map keyed on the slug, a timer, a promise
waiting for a token. None of them knows whose it is, so when the reader changes each carries on for
whoever is there now.

It has two forms, and fixing one does nothing for the other:

- **Shown.** State on screen: the typed words, the tick, *Queueing it…*. Removing the instance
  (`key={user.id}`) fixes this.
- **Owed.** A request not yet sent: a debounce, a retry, an unmount flush, a call still waiting
  for its token, a 401 about to be retried. The token is looked up when the request is sent, not
  when it was asked for, so it goes as whoever is signed in by then. Removing the instance does
  **not** fix this, and can cause it, because unmounting is what triggers the flush.

The root cause is that `apiFetch` had no idea who a request was for. "The current reader" was read
at the last moment, by the lowest layer, for every caller, so any gap between deciding to write and
writing was a gap in which the writer could change.

## Which commits introduced it

All found with `git log -S` on `src/web/AddPage.tsx` and `src/web/App.tsx`.

| Commit | Date | What it did |
|---|---|---|
| `c664eadb4` | 2026-09-03 | Keyed `<Library key={user.id}>` for exactly this reason, and left `<AddPage>` unkeyed ten lines below it. The class was met here and closed for one page. |
| `2313b3339` (260930e stage 1) | 2026-09-30 | The purpose box arrives, its draft held in `AddPage` state. The first of a reader's own words on a page that survives a change of reader: the *shown* form. |
| `1713c9d59` (261002k) | 2026-10-03 | `HighPowerIntent`, in a ref keyed on the address only, retrying its `PUT` each second and built to outlive the page: the *owed* form. |
| `57fa1e553` (261004l) | 2026-10-05 | `purposeFor` and `AddPurposeSession`, keyed on the address, with an autosave, a flush on retirement, and `retiringPurposes` keyed on the slug alone. |
| `dba7839f9` (261005l stage 2) | 2026-10-06 | Gave `AddPage` a `readerId` and scoped the held job and the two sharing controllers to it (Sol's F1 there). Left the purpose, the tick and everything else. This is the commit whose review found the rest. |

Each of the middle three was built to make a write more reliable: save as you type, keep trying,
send the last words on the way out. Each made the write live longer, and none asked whose it would
be by the time it left.

## It had been met before, several times

Every one of these was fixed where it was found, and the fix stayed there:

- **The shelf**, `c664eadb4`: `<Library key={user.id}>`, and `Credential` in `lib/api.ts` so a
  cached answer is filed under the reader whose token fetched it
  ([library.md](../project/library.md), *Who the reader is now has to be decided twice*).
- **The engines**: `useJobSession` in `src/web/useJobs.ts` starts and stops the job engine, the
  upload engine and the batch with the reader.
- **The experimental switch**: `src/web/experimental-store.ts` § `abortInFlight` aborts on a
  session change, and its comment describes the 401 retry going out as the next reader.
- **The main-modes tick box**, two days earlier:
  [261004j](261004j-a-page-mount-cannot-own-writes-to-a-reader-setting.md) is this same owed write,
  a queued save picking up B's token, fixed with a session signal for that one setting.
- **The article preload**: `apiFetchOwned` in `src/web/lib/prefetch-article.ts`.
- **261005l F1**: the sharing controllers and the held job, on this very page.

Six local fixes, four different mechanisms (a key, a start/stop, an abort signal, an owner returned
with the answer), and no shared one. That is the finding. Each new feature had to rediscover the
problem, and three in a row on the add page did not.

## Why nothing went red

- **Every add-page test mounts the page for one reader and keeps it there.** The only tests that
  changed the reader (`tests/add-page-sharing-section.test.tsx`) were written for F1 and asserted
  on the sharing section.
- **The API mocks do not have a reader.** Over a hundred suites replace `apiFetch` with a stub
  that answers by path. A stub cannot send A's write with B's token, so no assertion could see it.
  261004j says the same of its own tests.
- **The types allowed it.** `apiFetch(input, init)` had nowhere to say who a request was for.
- **261005l's first review asked the right question of the wrong list.** F1 named the controllers
  and the held job, they were fixed, and the page looked handled. It took a second review of the
  result to ask about the rest of the page.
- **My own first plan for this fix had the same hole.** It reset the screen and fenced two writes.
  Sol's [plan review](../plans/261006e-plan-review-sol.md) showed the add POST, Retry, advances,
  uploads and the sharing requests all still crossing, and that signing out and in again went
  round the gate altogether.

## What landed

1. **A change of reader stops the add visit.** `App` keeps whose visit an `/add/` address is, above
   its signed-out branch (`src/web/add-visit.ts`). Another reader at that address gets
   `AddStopped.tsx`, which posts nothing, until the address is left. A fresh page for B was not
   enough, because the add page starts an import when it mounts.
2. **A request can name its reader.** `apiFetch(input, init, madeFor)`, and the same on
   `apiFetchOwned` and `leavingFetch`: if the token about to be used is known to be another
   reader's, nothing is sent and the caller gets `NotThisReader`. Checked after the token lookup,
   so a lookup that waited across the change is caught. The add page's purpose, High-powered,
   sharing and upload-poll requests, the job and upload engines, the batch and the main-modes write
   all pass it.
3. **A 401 retry never goes out as a different reader**, for every caller, with no caller changed.

## What is still open

**Both items below were taken up on 2026-10-06 by
[261006f](../plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md).** The text is
kept as it was written. What that plan landed, and what it did not:

- **The first item is built**: every `apiFetch` is bound to the reader the tab held as it was
  made. Its first version could refuse a reader's own request, because the screen and the fence
  each asked the SDK who was signed in and could be told different readers; both now read one
  held session (`src/web/lib/session.ts`).
- **The reading view was looked at, and its leaks are fenced**: the writes it owes as it unmounts,
  the module-level stores, the Feedback dialog, and two things found outside it, `/profile` and
  the retry of a spoken exchange.
- **The built-code review found more delayed work**: comment PATCH queues and late deletions,
  search revisions and search/criteria colour queues, audio conversion/retries, and live startup
  and provider callbacks. They need
  the same original-reader fence. It also found two stale-session orderings: a late initial SDK
  snapshot, and a lookup overtaken by A → signed out → A. One subscription removes disagreement
  between subscribers; a revision fence is additionally needed to reject an overtaken lookup.
  The fixes and regression tests are recorded in [261006f](../plans/261006f-every-request-is-bound-to-the-reader-at-its-start.md).
- **Still open**: none of it has been checked in a browser; and `spya.lastView.<slug>` in
  browser storage carries no reader.

**A plain `apiFetch` that names nobody, begun under A, whose token lookup straddles the change, is
still sent as B.** That is every page not listed in 2 above: over a hundred call sites in
`src/web`. The window is small, a pending token lookup rather than a timer, but the hole is the class.

Closing it is one change in `lib/api.ts`: note, synchronously when the call is made, whose token
the tab holds, and refuse to send if the credential that comes back is known to be somebody
else's. The same rule as `madeFor` (refuse only when both readers are known and differ), with the
caller's reader taken from the moment of the call. It was not done here because it changes every
request in the app at once and production has the higher bar; it has been reported to the Overseer
as its own piece of work. Until it lands, items 2 and 3 below are what stand between a new feature
and this bug.

Not checked in this work: **the reading view** (`<ArticlePage readerId={user.id}>` in `App.tsx`)
is not keyed on the reader either. Whether it shows A's unsent comment draft or chat box to B has
not been looked at.

## What would catch the class, ranked by ease against value

1. **Tests that hold the credential open across A to B.** Cheap, and done:
   `tests/api-fetch.test.ts`, `tests/engines-send-as-their-reader.test.ts` and
   `tests/add-page-reader-change.test.tsx` each keep a token lookup or a 401 refresh unanswered
   while the reader changes, and were seen red first. A stub that answers by path cannot test
   this; the session has to be the thing that is faked.
2. **A rule, costing nothing: anything that sends after its page may have gone names its
   reader.** A timer, a retry, an unmount flush, a module-level service: pass `madeFor`. And
   anything that holds a reader's words is keyed on the reader, not on the address or the slug.
   The rule's home is
   [auth.md § A request made for one reader is never sent as another](../project/auth.md#a-request-made-for-one-reader-is-never-sent-as-another).
3. **Close it in `apiFetch` for every caller**, as above. The highest value on the list and about
   a day with its tests, since it replaces a rule people must remember with a check that cannot be
   skipped. Not done; reported.
4. **Key every signed-in page on the reader in one place**, in `SignedIn`. Cheap, and it closes
   the *shown* form for pages nobody has checked. Not done here, and not safe alone: a page that
   acts on mount starts that action again for B, which is why the add page needed a stopped page
   and not only a key. Worth doing after an audit of which pages act on mount.
5. **A lint rule requiring `madeFor` at every `apiFetch`** — rejected. Over a hundred sites of
   noise to do by hand what item 3 does once.
6. **Retire the owed writes in an effect cleanup when the session changes** — rejected, in the
   plan. A cleanup runs after the commit, in an order relative to the page's own unmount that
   nothing pins, and after any timer that already fired. A check at the moment the token goes on
   has no ordering to get wrong.

## The fix that is right for the long term

What landed is right for the add page and is a stopgap for the app. The long-term shape is item 3:
the reader is fixed when a request is made, by the layer that attaches the token, for everybody.
Then `madeFor` is only needed by the few callers whose request is made long after the reader's
gesture (a retry loop, a retirement flush), and the six local mechanisms above stop being the only
defence.

## The thing I would tell myself

I planned this as a screen bug: B can see A's words, so clear the page. The words on screen were
the harmless half. The half that wrote to B's article and spent B's money was in requests that had
not been sent yet, and my reset would have triggered one of them. When a reader changes, ask first
what is still owed, and only then what is still shown.
