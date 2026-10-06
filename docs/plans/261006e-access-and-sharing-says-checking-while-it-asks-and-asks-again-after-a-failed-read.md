# Access & sharing says "checking" while it asks, and asks again after a failed read

Queue items **qi-kynm6gzc** (Metadata's Access & sharing says *We could not check who can read
this…* for minutes after an import finishes, right after a reload) and **qi-jpqg6r3b** (the same
sentence flashing while the page loads). They share one cause, in two halves.

## What is wrong

The Metadata page reads `GET /api/metadata/:slug` once per article (`src/web/Metadata.tsx` §
`readProvenance`) and hands the parsed `sharing` block to the card (`src/web/AccessSharing.tsx`).
The card has one state for "no sharing block": `UNREAD`, which draws `SHARING_UNKNOWN`, *"We could
not check who can read this, so nothing is offered here — reload the page to try again."*

1. **Still asking is drawn as failed.** `provenance` is `null` both before the request lands and
   after it fails, and the card cannot tell them apart. So every load draws *"We could not check"*
   for as long as the request is out. That is qi-jpqg6r3b, and it is a false sentence: we have not
   failed to check, we are checking.
2. **One failed read is final.** `reload()` runs when the slug changes and at no other time. A
   single non-200, or a dropped connection, leaves `provenance` null for the life of the page, and
   the sentence stays until the reader reloads. That is qi-kynm6gzc.

## What was reproduced, and what was not

A Sonnet browser run on the box, 2026-10-06, Playwright with every `/api/metadata` response logged:

- **The flash: reproduced.** A cold load showed the sentence for about 1.5 s, the whole time the
  request was out; with the response held 3 s by `page.route`, for 3 s.
- **Stuck until reload: reproduced with an injected failure**, not with a real one. Failing only
  the first `/api/metadata` call (a 404, then a 503) left the sentence up for 50 s with no second
  request.
- **A real failing read during a real import: not seen.** One real import, opened on Metadata about
  5 s in, got a 200. The original sighting was four articles "while the box was also running the
  full suite". What was seen in the real import is that `/api/metadata/<slug>` answers 404 (*No
  article artefacts*) before the job has written anything, so a Metadata page mounted in that
  window, or a request that fails under load, would stick the same way. Which of those the four
  articles hit is not known. The queue's guess (the read fails on a stand-in tree) was not borne
  out: the read on a stand-in tree answered 200.

So the fix is for the class, a read whose one failure is terminal and whose loading state borrows
the failure's words, rather than for one identified failing request.

## What we build: browser only

1. **A `checking` state on the card.** `SharingSection`/`SharingCard`/`AccessSharing` take
   `checking: boolean`, true when `provenance === null && !provenanceError`. The card's state union
   gains `{ kind: "checking" }`, drawn as a new faint line, `SHARING_CHECKING` =
   *"Checking who can read this…"*. No switch is offered, as for unknown. `acted` still wins.
2. **A failed first read asks again.** In `Metadata.tsx`, while `provenance === null` and
   `provenanceError` is set, a timer calls `reload()` again after 2 s, 5 s, 15 s and 30 s, then
   stops (four more tries, about 50 s). The schedule resets with the slug. During the retries the
   card keeps saying *"We could not check…"*, which is true, and becomes the real switch the moment
   a read lands. A failed *refresh* over data we already have is left alone, as now.
   Each wait starts when the read before it failed: the page counts failed reads, and the timer is
   keyed on the count, not on the error text, which is the same string twice running.

Nothing on the server changes.

## The simpler options passed over

- **Only the `checking` state.** Fixes the flash and leaves the stuck sentence.
- **Only a "Try again" button in the sentence.** Simpler than a timer, but the reader who saw this
  did not know anything had failed until they looked, and the page can fix it without them.
- **Re-read when an import job finishes.** Aimed at the guessed cause, which was not reproduced,
  and Metadata has no handle on the job. The timer covers the same window.
- **Retry for ever.** A slug that is truly gone would be polled for the life of the tab.

## Tests, red first

In `tests/metadata-sharing-card.test.tsx`:

- the metadata response held open: the card says *Checking who can read this* and not *could not
  check* (red today);
- the first read fails and the second succeeds: after the first delay the card shows the switch
  with no reload (red today), with fake timers;
- every read fails: the card says *could not check* and the fetch count stops at five.

## Done looks like

Both tests red before and green after; `npm test`, `npm run typecheck`; a Sonnet browser check at
desktop, iPad and phone widths of the delayed load and of an injected first failure; GPT Sol's
review of the code.

## What the plan review changed

GPT Sol, 2026-10-06, approve with changes
([261006e-access-and-sharing-checking-plan-review-sol.md](261006e-access-and-sharing-checking-plan-review-sol.md)):

- **Retry progression.** Two failures set the same error string, so an effect keyed on the error
  would stop after one retry. Taken: the page counts failed reads and keys the timer on the count;
  the timer is cleared on success, slug change and unmount, with a test for the last.
- **Asking again when the tab becomes visible is dropped.** It was a second trigger with its own
  listener to cancel, and nothing showed it was needed. The simpler version first.
- **A 200 whose `sharing` does not parse still sticks, and that is left alone on purpose.** The
  server sends the block on every 200 (`articleMetadata`, `src/store/pg.ts`), so this path needs an
  app copy and a server that disagree about the shape, and asking the same server again would get
  the same body. The sentence's *reload the page* is the right advice there.
- **The private link's own read** (`GET …/share-link`) is a separate request with its own unknown
  state; it does not recover through this retry. Not seen failing; not in scope.
- **"Five fetches" is five reads.** `apiFetch` may add one request of its own to a 401.

## What landed

- `SHARING_CHECKING` in `src/messages.ts`; a `checking` kind on the card (`AccessSharing.tsx`); the
  private link draws no *"We could not work out what a shared link would carry"* while the read is
  out (`PrivateLink.tsx`) — the same false sentence, found when the first test went red.
- `READ_AGAIN_AFTER_MS` and the retry effect in `Metadata.tsx`.
- Four tests in `tests/metadata-sharing-card.test.tsx`. Red first, 2026-10-06, before any change
  to `src/`: *checking* → `expected '…We could not check who can read this…' to contain 'Checking
  who can read this'`; *asks again* → `expected 1 to be 2`; *gives up* → `expected 1 to be 5`.

## The code review, and the browser check

**GPT Sol, 2026-10-06** ([261006e-access-and-sharing-checking-code-review-sol.md](261006e-access-and-sharing-checking-code-review-sol.md)): approve, no P1
or P2, production code unchanged. One P3, fixed by the reviewer: the recovery test said the switch
came back and asserted only the sentence beside it, over a fixture that correctly withholds the
button. It now asserts the button. It also added tests for a slug change, a late failure and
`acted` over `checking`, and mutated the code under all four original tests: each went red,
including the unmount test, which counted two reads with the cleanup removed. Its write-up of the
test gap is
[261006e-review-state-prose-can-pass…](../postmortems/261006e-review-state-prose-can-pass-with-the-promised-control-missing.md).

**Browser, 2026-10-06**, Playwright on the box, at 1440, 820 and 390 wide, on an existing article
with `/api/metadata` shaped by `page.route`:

- **Read held 3 s**: *Checking who can read this…* and neither "could not" sentence; then the real
  controls. All three widths.
- **First read 503, then let through**: the failure sentence, a second request 2.2 s later, then
  the real controls with no reload. All three widths.
- **Every read 503**: five requests, gaps of 2.3, 5.2, 15.2 and 30.2 s, then none (watched for 54 s
  at 390 and 22 s at 1440).
- No horizontal scroll at 390, nothing clipped. The section grows by about 90 px when the controls
  arrive, which moves what is below it. No console errors beyond the injected 503s.
- Shots: `261006e-shot-checking-1440.png`, `-820.png`, `-390.png`.

The postmortem for the bug itself is
[261006g](../postmortems/261006g-a-read-still-out-drawn-in-the-words-of-a-read-that-failed-and-one-failure-final.md).
