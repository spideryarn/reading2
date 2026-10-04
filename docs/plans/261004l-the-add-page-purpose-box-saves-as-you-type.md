# The add page's purpose box saves as you type

Status: built and on `dev` 2026-10-05, not deployed. No migration. Parent: [plans.md](../project/plans.md). Follows
[261004h](261004h-post-import-modes-decided-on-the-server-for-every-import-path.md) § The purpose
box, whose [Q-purpose-first-modes] this answers.

> B with a small debounce of some kind
>
> — Greg, 2026-10-04

**B**, as it was put to him: save the purpose as it is typed, once the article exists, so it is
usually in before the import ends; the box becomes autosave, not a decision; someone still typing at
the end still misses.

## Why

Since 261004h stage 1 the server queues the first Summary, Glossary, Quotes and Ideas in the
transaction that publishes the import, and each job carries the reader's profile as it stands then
(`src/store/pg-revisions.ts`, `renderProfile({ profile, purpose: article.purpose })`). The add page
saves the purpose only on **Save and open**, which is after publication. So a purpose typed on the
add page never reaches the first modes. Saving it while the import runs puts it in the `articles`
row before publication reads it.

## What exists, and is reused

- `PATCH /api/library/:slug { purpose }` (`patchShelf`), through `savePurpose` and `leavePurpose` in
  [`src/web/purpose.ts`](../../src/web/purpose.ts). Unchanged.
- [`useAutosavedText`](../../src/web/useAutosavedText.ts): one save at a time with the newest text
  queued behind it (so an older text cannot land after a newer one while the page is alive), a save on
  `visibilitychange → hidden`, a `keepalive` write on `pagehide` and on unmount. Metadata's box, the
  first-open prompt and the profile panel already save the purpose through it.
- [`ProfileBox`](../../src/web/ProfileBox.tsx) has the idle timer, the *leave with unsaved words*
  warning and the status line (*Saves as you type* / *Unsaved changes* / *Saving…* / *Saved* /
  *Not saved — reason*).
- `GET /api/reader?slug=` answers `{ purpose, purposeFailed }`. `purposeFailed` is true when the
  article row cannot be read, which includes *does not exist yet*.
- The add page knows the slug before the row exists (`job.slug`, as High-powered AI uses it:
  `src/web/add-high-power.ts`). The row is created when the job's claim opens its draft, normally a
  second or two in.

## The design

**1. A save session, bound to one article.** `AddPurposeSession` in a new `src/web/add-purpose.ts`:
a small framework-free class with its requests injected, the shape `HighPowerIntent`
(`src/web/add-high-power.ts`) already has on this page, tested without React. One instance per
`(source, slug)`, where `slug` is `job?.slug ?? completion?.slug` (never one derived from the
address). The page holds the current one in a ref, reads it with `useSyncExternalStore`, and the
textarea stays in the page.

It holds, synchronously: the text, what the server holds (`null` until read), whether a write is in
flight, whether another is wanted behind it, and the last refusal. Its `save` is
`async (text) => (await savePurpose(slug, text === "" ? null : text)) ?? ""` and its `leave` is
`leavePurpose(slug, text)`, as the other purpose boxes' are. It reports a `SaveState`
(`useAutosavedText`'s type) for the status line.

**Why a class and not `useAutosavedText` in the page** (the first draft of this plan, then a keyed
renderless child holding the hook). Two review rounds found the same thing from both sides: the save
has to be bound to a slug that can change under one mounted page (a new address, or a Retry that
comes back with another article: `slugForRetry`), and every fact the page decides on, at completion
and at *Open*, has to be true in the tick it is read. A hook in the page cannot be re-bound without
a `reset()` that drops the old article's correction (Sol's F3, F4); a hook in a keyed child puts the
text in the parent and the draft in the child, with an effect between them (F11). The class has one
copy of the text and no render between a keystroke and a decision. The cost is a second copy of the
hook's *one in flight, newest queued behind* rule, about forty lines, with its own ordering test.

**Retiring a session.** A new address, or a slug change within one address, calls `retire()` on the
old session and makes a new one. `retire()` stops the probe, lets a write in flight finish, then
sends the old session's latest text to the old slug if the server does not have it, and resolves
`retired` when that has settled. Nothing a retired session does can reach the page: it has no
listeners left.

**Two sessions for one article never overlap** (Sol's F9: `/add/https://example.com/paper` and the
same with a trailing slash are two addresses and one slug). A new session is handed the previous
session's `retired` promise when their slugs match, and does not read or write until it resolves.

**What carries across.** A new address starts with an empty box. A slug change within one address
(Retry) carries only words the reader typed: a box still showing a stored purpose the reader never
edited is emptied, so one article's purpose is never written to another.

**2. Held until the article exists, then seeded with what is stored.** The session saves nothing until
it is seeded. It reads `GET /api/reader?slug=<slug>`:

- one request at a time, each with a 10 s deadline, a second apart, at most 300 tries a run;
- it runs while the session is unseeded and the add is alive (a job queued or running, or a
  completion); a job that has stopped gets one last try; a Retry starts a fresh run;
- a response counts only if it is fresh (not `x-spideryarn-offline: copy`, Sol's F5), says
  `purposeFailed: false` explicitly, and the session is still mounted. It is consumed once.

That answer seeds the session with the stored purpose (`""` for none). Then:

- the reader has typed something non-blank: their text is put back over the seed and committed at
  once ("save it the moment it does"). On a re-add this replaces the stored purpose with the words
  they typed;
- the box is blank: it takes the stored value. For a new article that is empty. For a re-add of an
  article that already has a purpose, **the box now shows that purpose**.

That is what makes clearing safe. Until now the box started empty over a sentence the reader could
not see, so an empty box could never be sent (260930e F1). Once the box shows what is stored for
this target, an emptied box means *clear it*, sent as `null` like every other purpose box. A box
blank before the seed erases nothing: it adopts the stored text instead.

**3. Saved after a short pause, on blur, and on the way out.**

- 700 ms after the last keystroke (`ADD_PURPOSE_IDLE_MS`). The other boxes stay at 2 s.
- on blur, and on ⌘/Ctrl+Enter while the import runs;
- `visibilitychange → hidden` commits; `pagehide` sends the `keepalive` write at once; unmount
  retires the session (ordered, since the page lives on);
- overlapping saves: one PATCH in flight, the newest text sent when it answers.

`AddPurposeSession` owns the add page's 700 ms timer, so saving goes on while React is rendering a
replacement it has not committed (the code review's F14). `ProfileBox`'s own timer and its
unsaved-words warning are lifted out as two small exported hooks (`useIdleCommit`,
`useUnsavedWarning`) and its status line is exported (`SaveStatus`); the add page uses the warning
and the status line. Both timers keep the same two rules:

- **the idle timer also re-arms when a write lands** (Sol's F2, a bug the three shipped boxes have
  today). Load S, type A, its PATCH goes, type back to S: the box says *clean* and no timer is
  armed; A lands, the box is now dirty against A, and nothing sends S until a blur. The timer is
  keyed on the text **and on `inFlight`**, and armed only when the state is `dirty`: never on
  `error`, so a refusal is not retried without a new keystroke or a blur (F12; a keystroke clears
  the error to `dirty`). `ProfileBox` takes an optional `inFlight` and its three callers pass it.
- **the warning covers words with nowhere to go yet** (Sol's F6): typed, non-blank and unseeded
  counts as unsaved, as does any write in flight.

The add page keeps its own plain textarea: `ProfileBox` whole would bring dictation.

**4. What happens at the end of the import.** The choice mostly goes away.

| When the import finishes | The page |
|---|---|
| box not focused and nothing unsaved (never typed, or typed and saved, no write in flight) | opens the article by itself |
| box focused, or words not yet saved, or a save refused | waits, with one button: **Open the article** |

**Open the article** (and ⌘/Ctrl+Enter once the import is in) commits and opens once
`!inFlight && (clean | saved)`, the latch `PurposePrompt`'s *Done* uses. The existing synchronous
once-guard (`claimed`) and the source and completion fences stay: the latch decides *when*, they
decide *whether* and *once*. A refused save lets go of the latch, the reason shows in the status
line, the words stay in the box, and a second button appears: **Open without saving**, which
abandons the draft (`abandon()`, so retiring does not send it behind the reader's back) and opens.
The same second button shows when the read of the stored purpose gave up, since the words then
cannot be saved from here.

*Save and open* and *Open without it* are deleted. `Phase` loses `saving`; `ready` gains
`opening: boolean`. Blur while waiting saves but does not open.

**5. The first-open prompt's mark** (`markAskPurpose`) is written as now: only when the page opens
the article by itself and the reader never touched the box.

**6. The words on the page** (Sol's F8: each must be true with automatic modes off, on a re-add,
and when the import failed after its row was made).

- Hint: *Optional. Saves by itself after a short pause, once the article exists. If first modes are
  generated automatically, they use the reason saved when the import finishes. For this article
  only. Never what the article says. You can change it later on the article's Metadata page.*
- Words in the box, session unseeded, add alive: *Not saved yet. It saves once the article exists,
  if you stay on this page.*
- Unseeded and the add stopped: *Not saved. The import stopped before this article's saved reason
  could be read.* The read gave up: *Not saved. Could not read this article's saved reason.* (F13:
  an unseeded session does not prove there is no article.)
- After that, `ProfileBox`'s own words.
- Waiting at the end: *Ready. Any first modes that were queued use the reason saved when the import
  finished. Changes saved after that reach chat and anything you generate later.*

## What this does not fix, said plainly

- A reader still typing when the server publishes the import misses the first modes with whatever
  was typed after the last save. That is option C in 261004h, not chosen.
- **Ordering is guaranteed while the page is alive, and best effort while it is torn down.**
  `pagehide` sends a `keepalive` write without waiting for a write in flight, so the older one can
  in principle be applied second. This is the limit `useAutosavedText` documents for the three
  shipped boxes, kept here. Closing it needs the server to order writes (a `purpose_at` the PATCH carries
  and the `UPDATE` checks), for all four boxes. See § Review record for how that was decided.
- Words typed and the page left before the article row exists are not saved: there is nothing to
  save them to. As today. The browser's own *leave site?* question is asked; a click on *Back to
  the shelf* is not stopped.
- A purpose typed during a re-add's import overwrites the stored one as it is typed, not at a
  button.

## The simpler option passed over

Blind autosave with no read: seed the hook with `""` as soon as a PATCH stops answering 404, and
never send an empty box. No `GET`, but it keeps the hidden-sentence problem, so an emptied box would
leave a stale purpose (the brief asks that clearing clears), and it needs a 404-retry loop inside
the save, where the hook would show each *not yet* as a refusal. The read is one request a second
for the second or two before the row exists.

Also passed over: using `ProfileBox` whole. It would add dictation to the add page, and a
microphone running while the page opens the article by itself is a new way to lose words.

## Tests (red first)

`tests/add-purpose.test.ts` drives the class directly (ordering, deferral, the probe's lifecycle, an
offline copy, retiring and the same-slug hand-off, F9's C-then-A-then-B). `tests/add-page-purpose.test.tsx`
is rewritten to what is now true of the page, fake timers for the pause:

- typed while the import runs and the article exists: no PATCH before 700 ms, one after, carrying
  the text; a second keystroke inside the pause restarts it;
- blur saves at once; `pagehide` sends the keepalive write; unmount with unsaved words sends it;
- **deferred until the article exists**: typed while `GET /api/reader?slug=` answers
  `purposeFailed: true` sends no PATCH however long the pause; the first good answer is followed by
  one PATCH with the text typed;
- **ordering**: type A, pause (PATCH A held open), type B, pause: no second PATCH until A answers,
  then exactly one PATCH with B; the last PATCH is always the last text;
- a box blank at the seed over a stored purpose shows it and sends nothing; emptied after that, it
  sends `null`; a box emptied before the seed sends nothing (F1 kept);
- at completion: untouched opens by itself and writes the mark; typed-and-saved, blurred, opens by
  itself with no further PATCH; focused waits; **Open the article** with unsaved words PATCHes and
  then navigates, once, under StrictMode and a double press; a refused save stays, shows the reason,
  keeps the words and offers **Open without saving**, which navigates with no PATCH after it;
- a new address: the old draft is flushed to the old slug (after any write in flight), the new box
  is empty, an old save answering late does not touch it;
- the page posts no mode job on any path (kept), each of the three ways an add finishes (kept);
- the High-powered AI cases in the same file are untouched.

`tests/profile-box-autosave.test.tsx`: stays green, plus F2's case red first: S, A in flight, back
to S, no blur; when A lands the timer sends S.

More cases for the page, from the plan review: a Retry that returns a different slug retires the
session (the old slug gets the old words, the new box does not carry an unedited stored purpose, a
clear cannot reach the new article before its purpose has been read); an offline-copy answer does
not seed; a probe answer arriving after the target changed does not seed; `beforeunload` is
questioned over typed words before the article exists.

Mutation at the end: drop the queue-behind-in-flight in the page's wiring (call `savePurpose`
directly), drop the wait-for-seed, set the idle to 0; each must go red.

Browser, in a Sonnet subagent, 1280 px and 390 px, local stack: import a page while typing a
purpose; confirm in Postgres that the first mode jobs' profile contains it; clear the box and
confirm the column is null; re-add and see the stored purpose in the box.

## Docs

- 261004h § The purpose box: Greg's answer, quoted, and a pointer here.
- [reader-profile.md](../project/reader-profile.md): the add page's box autosaves; the sentence
  "not saved until Save and open" goes.
- `/help` (`src/web/help/help-topics.tsx`) if its sentence about the add page's question says
  otherwise.

## Review record

**GPT Sol on the plan, round 1** (read-only, exit 0, answer file fresh):
[plan-review-sol](261004l-purpose-autosave-plan-review-sol.md). Verdict *do not build*, eight
findings. Taken as written above: F2 (the idle timer misses a write landing over a box moved back),
F3 and F4 (a `reset()` that drops the old article's correction, and a Retry that changes the slug:
both closed by keying a session to the slug, which replaced `reset()`), F5 (an offline copy is not
evidence the article exists), F6's first half (the leave warning covers words with nowhere to go
yet), F7 (the probe's whole lifecycle), F8 (the sentences).

**Sol still objects to two; overruled, with Opus arbitrating both** (2026-10-04):

- **F1** (P0 as graded): `pagehide`'s keepalive write can be applied before an older write in
  flight. Overruled for this plan: it is the hook's existing, documented limit in three shipped
  boxes, and the fix is a migration and a PATCH protocol change for all four, which is not the
  small option Greg chose. The guarantee is stated at its true strength in § What this does not
  fix. Opus added that the 700 ms pause puts a write in flight more often than 2 s does, so the
  exposure rises slightly, and that aborting the older write at `pagehide` would only narrow the
  window. Reported to Greg as [Q-purpose-write-order].
- **F6's second half** (P1): *Back to the shelf* is not stopped over unsaved words. Overruled:
  once the row exists, unmount waits for a write in flight and then sends the newest text, in
  order; blocking app navigation is a mechanism no other box has. Before the row exists the words
  are lost, as today, and Opus's point was that the status line must not promise otherwise, hence
  *if you stay on this page*.

**GPT Sol on the plan, round 2** (read-only, exit 0, answer file fresh):
[plan-review-2-sol](261004l-purpose-autosave-plan-review-2-sol.md). Verdict *do not build*, F9 to
F13, against the keyed-child design. Discovery closed after it, as the house rule says; settled as:
F9 (two sessions for one slug overlapping) by the `retired` hand-off; F10 (the save callback's
type) as written; F11 (text in the parent, draft in the child) by dropping the child for a class
with one copy of the text; F12 (a refusal re-arming the timer) by arming only on `dirty`; F13 (the
stopped sentence) reworded. F9's fix was not in the round-two snapshot, so the code review is asked
to check it specifically.

**GPT Sol on the code** (commit 57fa1e553, `workspace-write`, exit 0, answer file fresh):
[code-review-sol](261004l-purpose-autosave-code-review-sol.md). Four findings fixed in its own
diff, each red first, read and committed after it: F14 (P0: the session was replaced during render,
so a render React suspended and never committed retired the session still on screen; replacement
and retirement now happen at layout commit, and the session owns its pause), F15 (a new address
cleared the focus flag while the reused textarea kept focus, so the page could open by itself under
a reader typing), F16 (`completed()` after the read had given up allowed one more try, not five),
F17 (a suspended render overwrote the navigation fences). It confirmed F9's hand-off holds across a
replacement, an unmount followed by a later mount, and three quick sessions, with tests that go red
when the barrier is bypassed.

**F18, reported and left open** (P1, reasoned, older than this plan): High-powered AI's intent is
still disposed during render (`highPowerRef` in `AddPage.tsx`), so a suspended address change could
leave the visible tick box calling a disposed intent. The fix is the one F14 got: publish the
replacement and dispose the old one at layout commit.

**Found by the builder and fixed before review:** a read that gave up while the job sat queued for
more than five minutes never restarted at completion (`completed()`), and `useAutosavedText` showed
a refusal over words that were no longer the refused ones, which with the timer armed only on
`dirty` would have left them unsent until the next keystroke.

**Browser check, first run** (Sonnet subagent, Playwright on the box, local stack, sha 75cd1531a
at start and end). It found the bug the unit tests could not: on four of four fresh imports the
first PATCH wrote `articles.purpose` and was answered 404, because `ShelfStore.patch` builds its
answer from the shelf list and an article mid-import is not on it. The box said *Not saved* over
saved words. Fixed in the store (`patch` answers `null` for *written, not on the shelf yet*), red
first in `tests/store-shelf-pg.test.ts`; written up as
[261005a](../postmortems/261005a-a-write-that-answers-with-a-view-fails-where-the-view-is-empty.md).
What that run did establish: on two fresh imports every first-mode job's profile carried the typed
purpose (saved 77 s before the jobs were created on one); a focused box held the page at *Ready*
and **Open the article** saved and opened; a re-add showed the stored purpose and sent nothing;
nothing scrolled sideways at 390 px.

## Stages

One stage: one page and one small class. Plan review (GPT Sol, read-only), build, code review
(GPT Sol, fixing), browser check, push.
