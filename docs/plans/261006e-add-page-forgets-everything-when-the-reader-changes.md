# The add page forgets everything when the reader changes

Queue item `qi-bag2d33y`, 2026-10-06. Up: [plans.md](../project/plans.md).

## The bug

Reader A opens `/add/<url>`, types into *Why are you reading this?* and ticks *High-powered AI*.
In another tab somebody signs in as reader B. This tab's session changes and `AddPage` stays
mounted (`src/web/App.tsx` gives it no `key`). GPT Sol found it reviewing
[261005l](261005l-permalink-and-share-while-an-article-is-importing.md) § What landed in stage 2,
which scoped the held job and the two sharing controllers to the reader and left the rest.

What B then gets, read from `src/web/AddPage.tsx`:

- **A's typed purpose, in the box.** `purposeFor` keys the session on the address only, and with no
  job it keeps the session it has, **with A's article slug**. So an autosave, a blur, or the
  session's retirement sends A's words to `PATCH /api/library/<slug>` with B's token. If B has an
  article under that slug, A's sentence is written onto it.
- **A's High-powered tick**, ticked. `highPowerRef` is keyed on the address only. A waiting intent
  retries `PUT /api/article/<slug>/high-power` each second, now as B: a spend B never chose.
- A page that says *the text has been sent* and *Queueing it…* for ever, because `started` is
  inert for B and `posted` still names this address.
- `focusedRef`, `purposeTouchedRef`, `phase`, `claimed`, `articleAnswer`, `failure`, `attempt`:
  all A's.

The class: **state made for one reader that outlives a change of reader**, in two forms. What is
on screen, and a write still owed that is sent later with whoever's token is current.

## The fix

**The first draft of this section was reviewed by GPT Sol on 2026-10-06
([its answer](261006e-plan-review-sol.md), six findings) and is replaced by what follows.** The
draft had a gate inside `AddPage` with an *Add it to this account* button, and fenced only the
purpose and High-powered writes. What changed, by finding, is at the end.

### 1. A change of reader stops the add visit, for good

A visit is one stay at one `/add/` address. `App` keeps who it belongs to, in a ref that outlives
the signed-out render, worked out by a pure function in a new `src/web/add-visit.ts`:

| route | reader | what happens |
|---|---|---|
| not an add address | any | the visit is forgotten |
| an add address | nobody signed in | the visit is kept as it is |
| an add address, no visit or another address | X | a new visit, X's, running |
| the visit's address | its own reader | unchanged |
| the visit's address | another reader | **stopped**, and it stays stopped until the address is left |

- **Running**: `<AddPage key={reader} …>`, so the instance, and every piece of state in the list
  above, goes when the reader does. `<Library key={user.id}>` does this for the same reason.
- **Stopped**: a short page and nothing else. The heading, one sentence saying this page was
  adding an article for another account and nothing has been added to this one, and *Back to the
  shelf*. No address, no filename, no button, and it posts nothing. It sets its own generic tab
  title, so an upload's filename does not stay in `document.title` or the title's live region.
  The reader adds the article from the shelf, which is their own gesture.

A first arrival signed out (a bookmarklet, a share sheet) and then a sign-in is a new visit for
whoever signs in, and posts as it always has. Only a visit that already ran for somebody else is
stopped.

### 2. A request made for A is never sent as B

Resetting the screen does not stop a write. The purpose session's retirement still sends its last
words, by design. The High-powered intent deliberately outlives the page. And a request already
waiting for its token, or being retried after a 401, picks up whoever is signed in by then. So the
check is where the credential is attached, in `src/web/lib/api.ts`, which already carries the
reader with the token (`Credential`):

- **`apiFetchAs(reader, input, init)`**: as `apiFetch`, but if the credential about to be used is
  not `reader`'s, nothing is sent and it rejects with a named error that has no HTTP status.
  Checked on the first send and on the retry after a 401. `reader === null` is unfenced (a test
  with no session).
- **`leavingFetchAs(reader, …)`**: as `leavingFetch`, sends nothing unless
  `lastKnownUser() === reader`.
- **Everywhere, with no caller changed**: the retry after a 401 is not sent if the refreshed
  session belongs to a different reader from the first attempt's. The first 401 is the answer.

Who uses `apiFetchAs`, each with the reader it was made for:

- the add page's purpose io (`read`, `save`, `leave`) and High-powered `put`, built per page
  instance from `readerId`; `savePurpose` and `leavePurpose` take the optional reader;
- the sharing io (`sharingIo(readerId)` already exists per reader) and the upload-arrival poll;
- `jobEngine`'s one `request` helper, `uploadEngine` and `batchUpload`, each with the session key
  `start()` gave it, **read when the call is made**. That covers the add POST, Retry and
  `/advance`;
- the add page's *generate the main modes* write, if it can take the reader without reshaping
  `auto-modes-setting.ts`; reported if not.

A refused send ends quietly: the purpose session's `flush` swallows a failure, and
`HighPowerIntent` only retries a 404, so a status-less rejection stops it.

And `retiringPurposes` in `AddPage.tsx` is keyed by reader and slug, not slug alone, so B's
session for an article never waits behind A's unanswered save.

### What is not promised

**A's own High-powered tick can still reach A's own article** after A to B to A inside one retry
second, sent as A. The intent is A's standing request and nothing of B's is touched. Sol's F5
called this a breach of the draft's "nothing starts until somebody presses"; that sentence was
about the import and is now kept by the stopped page. My decision, not Greg's.

**An ordinary `apiFetch` begun under A whose first token lookup straddles the change** is still
sent as B, on every page in the app that is not listed above. Closing it everywhere means
`apiFetch` comparing its credential with `lastKnownUser()` read at call time. That is one small
change to all 120 call sites at once, and production has the higher bar, so it is reported to the
Overseer as its own piece of work and not slipped in here.

## The simpler options passed over

**Only `key={user.id}` in `App.tsx`.** One line, and it resets the screen. But the remounted page
posts on mount, so B would start A's import without a gesture, and the unmount would still send
A's purpose as B.

**Retire the purpose and the intent in `retireAddSharing()`**, beside the sharing controllers. It
is an effect cleanup: it runs after the commit, in an order relative to the page's own unmount
that nothing pins, and after any timer that fired first. The send-time check has no ordering to
get wrong.

**A button on the stopped page** (*Add it to this account*), the first draft. It needs the gate to
re-authorise, a rule for uploads, and a rule for changing back. Sol pointed out that sending the
reader to the shelf gives the same guarantee with none of that. Taken.

## What the plan review changed

- **F1, F2 (requests in flight are sent as B)**: taken. Part 2 now covers the add POST, Retry,
  advances, uploads and the sharing io, and the 401 retry everywhere.
- **F3 (signing out and in as B at the address)**: taken. The visit is kept in `App`, above the
  signed-out branch.
- **F4 (B's purpose session waits behind A's save)**: taken.
- **F5 (A to B to A revives A's intent)**: not taken as written; see *What is not promised*.
- **F6 (the filename stays in the tab title)**: taken.
- **Its simpler design (no button)**: taken.

## Stages

One stage.

**Tests, each seen red first:**

- `tests/add-visit.test.ts` (new): the table above, row by row, and that stopped is sticky through
  A to B to A and through a signed-out render.
- `tests/add-page-reader-change.test.tsx` (new), through the real `App` mounting path where the
  case needs it, with the real `AddPurposeSession` and `HighPowerIntent`:
  - A types a purpose and ticks High-powered; change to B. A's words are nowhere in the document,
    nor is the address, a filename, the box or the tick. The tab title is the generic one.
  - No add POST is made as B: directly, after A to nobody to B, and after A to B to A.
  - Somebody who arrives signed out and signs in gets a running page that posts once.
  - A's seeded, unsaved purpose: after the change no `PATCH` leaves, including after the idle
    timer and after retirement.
  - A's waiting High-powered intent: after the change no `PUT` leaves while B is signed in.
  - B's purpose read for a slug proceeds while A's `PATCH` for that slug is unanswered.
- `tests/api-fetch.test.ts`: the matching reader sends; another reader sends nothing and rejects;
  a token lookup unanswered across A to B sends nothing; a 401 whose refresh comes back as another
  reader is not retried, for `apiFetchAs` and for plain `apiFetch`; `leavingFetchAs` against
  `lastKnownUser()`.
- One case each for `jobEngine`, `uploadEngine` and `batchUpload`: a request made under A whose
  credential comes back B's is not sent.
- The existing F1 cases in `tests/add-page-sharing-section.test.tsx` still describe `AddPage` with
  a changed `readerId` prop, which `App` no longer does; kept as they are, since the reader tags
  inside the page stay.

**Then:** mutate the fence, the visit rule and the key, and check the suite notices; `npm test`,
`npm run typecheck`, lint on touched files; GPT Sol code review; a browser check at desktop, iPad
and phone widths of the stopped page; a postmortem naming the class; docs (`auth.md`,
`high-powered-ai.md`, and wherever the add page's purpose box is owned).

## What landed

2026-10-06, built by an Opus subagent, red first. Where this differs from *The fix* above, this
is what the code does.

- **The fence is a third argument, not a second function**: `apiFetch(input, init, madeFor)`, and
  the same on `apiFetchOwned` and `leavingFetch`. Over a hundred test files replace `apiFetch` in
  `lib/api.js` and leave the rest real; a sibling `apiFetchAs` would have gone round every one of
  those mocks to the network. The refusal is `NotThisReader`.
- **It compares `tokenOwner`, not `Credential.owner`.** `owner` falls back to `lastKnownUser()`,
  which can be a reader behind the token; the first version used it and refused a job engine its
  own poll (`tests/public-network-trace.test.tsx`). `tokenOwner` is the id from the session object
  the token came out of. When nobody can say whose a token is, or there is no token, the request
  is sent: the fence refuses only when both readers are known and differ.
- **The stopped page** is `src/web/AddStopped.tsx`, headed *This page has stopped*. Its sentence
  does not say nothing was added, because after A to B to A the reader is A, whose import may be
  running.
- Upload grants are fenced as well as queue, cancel and retry. `batchUpload` names its own reader
  and no longer goes through `jobEngine`'s `send`. The *generate the main modes* write took the
  reader (`auto-modes-setting.ts`).
- **Sol's F6 did not reproduce before the fix**: the existing reader tag already made A's job
  inert, so the title went generic. The stopped page still has to own the title, and a test that
  removes its hook goes red.
- **`key={user.id}` on `AddPage` is caught by no test**: the visit rule stops the page first. It
  stays as the second lock.
- `purposeFor` still keys on the address only, so a mounted `AddPage` whose `readerId` prop
  changed would keep A's box. `App` no longer does that, and the session's writes are fenced.
- `tests/dock-corner-controls.test.tsx` › *signed in at /add/https://example.com/a* was already
  red before this work (its stub answers the add POST with `{jobs: []}`).

### What the code review changed

GPT Sol, 2026-10-06 ([its answer](261006e-code-review-sol.md)), on `4fc001a6d`. Three established
P1s, each fixed by the reviewer red first; its own write-up is
[postmortem 261006h](../postmortems/261006h-a-current-service-reader-is-not-an-operations-reader.md).

- **F7: the add POST at boot was unfenced.** The page's posting effect ran before `App`'s
  `useJobSession` effect had bound the engine, so the engine's reader was still `null`. The
  session is now bound in a layout effect, which runs before any child's passive effect.
- **F8: a batch grant's late cleanup went out as B.** `cancelUpload` now takes the reader the
  operation captured when it started.
- **F9: a batch queued its job after teardown**, in the microtask after the PUT. It now checks
  `live()` again after `sendIt`.

F5 stays as *What is not promised* has it; the review raised no objection to that.

## Done looks like

After a change of account on an open add page, direct or through signing out, B sees none of A's
words or choices; no request the add page, the job engine or the upload engines made for A is
sent with B's token; and no import starts for B from that page.
