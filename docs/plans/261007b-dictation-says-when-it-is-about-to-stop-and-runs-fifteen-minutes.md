# Dictation says when it is about to stop, and runs fifteen minutes

Feedback report `spya-n8cuqq` (SPIDERYARN-READING2-E8), from Greg, proven an admin's by
`scripts/feedback-reporter.ts`. Overseer queue item `qi-yrmf2wcm`. Owner doc:
[dictation.md](../project/dictation.md).

> I was doing a really long, really kind of useful voice dictation here in the feedback dialogue,
> and it cut me off after five minutes. I mean, the first thing is, if you're ever going to cut me
> off like that, you should give me some kind of feedback of some kind. But more importantly, let's
> make sure if there is going to be a cap, let's make it at least 15 minutes.
>
> — Greg, 2026-10-06, filed from `/changelog`, build `1aaf3753`

## What is true today

- **The cap is one browser-side constant**: `MAX_MS = 5 * 60_000` in
  [`src/web/mic-recording.ts`](../../src/web/mic-recording.ts). A timer started with the tape fires
  `onCapped`; `useDictation` then sets one sentence, *"Dictation stops after five minutes, so it
  stopped there. What you said before that is kept. [mic-full]"*, and stops the ordinary way, so
  what was said is transcribed.
- **So there was a sign, and it was not one anybody talking would notice.** The sentence is a
  12-pixel line under the box (`.prof-box-error`), it appears only *after* the microphone has
  stopped, and nothing makes a sound. Somebody dictating a long thought is looking away from the
  box. Nothing warns beforehand either: the strip shows a count-up clock and no limit.
- **Five minutes was chosen for the box, not for any server or cost reason.** Plan 260929f, R7:
  five minutes of speech is about what Feedback's 4,000 characters hold. Since 2026-09-29 a
  dictation is cut into two-minute parts, each its own request, so no request grows with the cap.
- **It is not a listed defence.** Nothing in
  [security-map.md § Where the defences physically live](../project/security-map.md#where-the-defences-physically-live)
  names `MAX_MS`, `mic-recording.ts`, `dictation-limits.ts` or `/api/transcribe`. So the cap and
  its warning wait on nobody. One thing found along the way does go to Greg, and it is not the
  cap: § Questions for Greg.
- **Feedback's own limit would now be the thing that cuts him off.** `MAX_FEEDBACK_ANSWER_CHARS`
  is 4,000. Fifteen minutes at an ordinary 150 words a minute is about 13,000 characters. Over the
  limit the dialog says *"N characters — the limit is 4000"* and Send is refused: nothing is lost,
  but a fifteen-minute dictation that cannot be sent is the same complaint in a new place.
  The database already admits more: the `feedback_body_shape` CHECK is `length(body) <= 12072`
  (`MAX_FEEDBACK_BODY_CHARS`), kept wide for reports backfilled on 2026-09-02.

## What we will build

Two stages, both small.

### Stage 1 — the cap is fifteen minutes, and it cannot arrive unnoticed

1. **`MAX_MS` becomes fifteen minutes**, exported, with a second exported constant
   `CAP_WARNING_MS = 60_000` beside it. The cap sentence takes its number from the constant, so the
   two cannot disagree: *"Dictation stops after 15 minutes, so it stopped there. Everything you said
   up to then is kept. [mic-full]"*.
2. **The last minute is said, visibly.** The hook exposes when this dictation will be stopped
   (`endsAt`, the tape's own deadline, and null when nothing is recording). In the last `CAP_WARNING_MS` the strip's row takes its warning look (the warm colour
   and the triangle that "No sound detected yet" has) and its words become *"Dictation stops in
   0:45"*, counting down, in place of "Listening". The count-up clock stays. The screen-reader
   live region says it **once** (*"Dictation stops in one minute."*), not every second.
3. **And audibly, twice.** One soft chime when the last minute starts and a different one at the
   cap, through the hook's shared `AudioContext` like the quiet chime
   ([`quiet-chime.ts`](../../src/web/quiet-chime.ts), generalised to take its notes rather than
   copied). Each plays once per dictation, so a chime the microphone hears cannot start a loop.
   Somebody not looking at the screen hears that something happened. The cap's chime plays only
   after the recorders have drained and the track is off, so it is not on the tape. The
   last-minute one can be: two short quiet notes in fifteen minutes, accepted, as the quiet chime
   already is. A sound is best-effort (a suspended context plays nothing), so the strip has to be
   enough without it.
4. **One deadline** (review P5). A timer in a throttled tab, or on a laptop that slept, fires late.
   So the tape owns `endsAt`, the cap is decided against the clock on every arriving chunk as well
   as by the timer, and it happens once. The last-minute chime is dropped if its timer fires more
   than five seconds late. A machine that slept through the warning stops on waking and says why.
5. **A press on Stop just after the cap does nothing** (review P7). The countdown invites that
   press. It used to find a session already stopping, start a new dictation, and abort the uploads
   of the one just recorded. For 1.5 seconds after a cap the hook ignores a press. The cap does
   not open the double-press-to-send window: nobody pressed Stop, so nothing is sent for them.
6. **The cap sentence stays after the words arrive**, as it does today (the test asserts it only
   before the transcript; it will assert it after too).
7. **Every sentence that says "five minutes" about dictation is corrected**: the Help page
   ([`help-modes.tsx`](../../src/web/help/help-modes.tsx), *"a recording stops after five
   minutes"*), `dictation.md` § The sizes, and the comments in `mic-recording.ts` and
   `transcribe.ts` (whose "the recorder stops at five minutes" has been per-part since 260929f).
8. **The fleet dashboard** reuses `useDictation` and draws its own chrome
   ([dictation.md § The hook does not know which server](../project/dictation.md#the-hook-does-not-know-which-server-it-is-talking-to)).
   It gets the fifteen minutes and both chimes with no change, because they live in the hook. Its
   strip got the countdown too: twenty lines in `DictationControl.tsx` and a test.

**Tests, red first.** A fake-timer test that the ceiling callback is armed at fifteen minutes and
not five; a hook test that `endsAt` is set while recording and null after; a strip test that inside
the last minute the row has the warning class and the countdown words, and outside it does not; a
chime test that each chime plays exactly once per dictation; the existing `[mic-full]` test extended
to check the sentence survives the transcript. `tests/dictation-codes.test.ts` already checks one
code, one sentence.

### Stage 2 — the Feedback box holds what fifteen minutes says

`MAX_FEEDBACK_ANSWER_CHARS` goes from 4,000 to **12,000**, which the database's CHECK already
admits (12,072), so there is **no migration** and the most a report can put in the database, in
Sentry and in the notice email is what it was. The dialog, the route (`feedbackAnswer`) and the
request-size arithmetic (`MAX_FEEDBACK_BODY_BYTES`) read the one constant.

**A stale client's three answers keep the 4,000 they were written under**
(`MAX_LEGACY_FEEDBACK_ANSWER_CHARS`; review P2). The route folds `steps`, `expected` and `actual`
into one body under headings, and three at 12,000 would pass the route and fail the CHECK as a
database error with no sentence. At 4,000 each they still come to exactly 12,072.

12,000 characters is about 2,000 words: thirteen minutes at an even 150 words a minute, and more
than fifteen at the pace of somebody thinking aloud. A non-stop talker can still pass it, and then
sees the existing *"N characters — the limit is 12000"* line with every word still in the box.
**This is the part that does not fully meet the request**, and the review said so (P1). Closing it
means raising the database's own cap, which is the question below.

`/admin/feedback` (review P3) returns whole bodies, 200 reports a page by default. At 12,072
characters each that is 2.4 MB, under Vercel's 4.5 MB, and it is the same worst case as before
because the column's cap has not moved. Big reports will be commoner now. An explicit
`?limit=500` could already pass 4.5 MB and still can; nothing in the app asks for it.

## Questions for Greg

### Should Feedback take a full fifteen minutes of non-stop speech?

**What this is about.** You can now dictate for fifteen minutes. The Feedback box takes 12,000
characters, which is about thirteen minutes of speaking without a pause. If you go past it,
nothing is lost: the words are all in the box, a line says *"13,400 characters — the limit is
12000"*, and Send is off until you trim. That is the one place the old complaint can still come
back.

**Why it was not simply raised.** 12,072 is the most the database will store in a report, and the
code says what that number is for: it *"stops one paste of an entire article becoming an attachment
on its way to Sentry"* (`src/db/schema.ts`, `feedback_body_shape`). That is a limit on what can
leave for a third party, and loosening one of those is yours to decide, not an unattended run's.
It is not one of the defences listed in security-map.md; this is caution, not a rule that applied.

**The options.**

- **A. Leave it at 12,000** (what is on `dev` now). Covers thirteen minutes non-stop and any
  ordinary fifteen. Costs nothing. Gives up: a very long, fast report has to be trimmed or sent in
  two.
- **B. Raise both to 20,000.** Covers fifteen minutes at 200 words a minute. A one-line migration
  that widens the CHECK (every existing row stays legal), the constant, and one more change that
  has to go with it: `/admin/feedback` must page by size rather than by count, because 200 reports
  of 20,000 characters is 4 MB and too close to the 4.5 MB a response may be. About two hours with
  review. Gives up: a 20,000-character paste (a short article) can go to Sentry in one report.
- **C. Raise only for a dictated report.** Not recommended: the server cannot tell dictated text
  from pasted text, so it would be a limit the browser enforces and a script ignores.

**What a real run did.** The soak below was fifteen minutes of speech with no pauses at all, and it
came to 15,108 characters: over the limit, Send off, every word in the box. That is the worst case,
and it is the case option B is for.

**What would decide it.** If you expect to dictate long reports without pausing, B. If thirteen
minutes non-stop is already more than you would say in one go, A. Recommended: **B**. You file
most of the reports, you dictate them, and what reaches Sentry is your own words in your own
account. It waits on your yes, in `awaiting-approval.md` and under its own queue entry.

## What we passed over

- **No cap at all.** Greg allowed for one ("if there is going to be a cap"). A dictation left
  running by mistake records, uploads and bills until the tab closes; fifteen minutes bounds that.
- **A cap sized from each box's own limit** (600 characters for the smallest), which 260929f named
  as the later refinement. Not now: it makes the cap *shorter* in most boxes, which is the opposite
  of the request, and the warning added here is what makes any cap tolerable.
- **A migration raising the CHECK past 12,072** in this run. GPT Sol's plan review asked for it
  (P1). Not taken, for the reason in § Questions for Greg; it has its own queue entry.
- **"15-minute maximum" shown from the start and no warning minute** (review P12). Simpler, and it
  would not have helped: Greg was not looking at the box. The warning minute and the sounds are
  the part that answers "give me some kind of feedback".
- **A banner or a modal at the cap.** Louder than the problem needs once there is a minute's
  warning and two sounds.

## Costs and risks, named

- **Spend.** Transcription is billed by seconds of audio, so the most one dictation can cost
  triples (roughly 3p to 9p at `gpt-transcribe`'s rate; the exact price is not recorded, queue item
  `qi-pn7rvh73`). There is no per-reader limiter on `/api/transcribe` today and this plan does not
  add or change one.
- **Memory and the device copy.** Fifteen minutes is about 13 MB in the page and in IndexedDB at
  Chrome's AAC rate, eight parts instead of three. Each part's size is unchanged.
- **Unverified, as before**: nobody has dictated for fifteen minutes into a real browser; Safari and
  the AAC seam are unmeasured (dictation.md § What is not verified). More seams per dictation means
  more chances for a seam to garble a word.
- **The other boxes.** Chat, comments, quiz and the rest keep their own character limits. A
  fifteen-minute dictation into a 600-character box overflows it, as a five-minute one already did.

## Stages and status

- [x] GPT Sol plan review (`--sandbox review`): **rework**, twelve findings, in
  [the review](261007b-dictation-says-when-it-is-about-to-stop-plan-review-sol.md). What each
  became is in § The plan review, below.
- [x] Stage 1: cap, warning, chimes, sentences, docs
- [x] Stage 2: Feedback's limit
- [x] A real fifteen-minute dictation in Chrome on the box (review P10): § The soak
- [x] GPT Sol code review: **approve with fixes**, six should-fix and a note on the tests, in
  [the review](261007b-dictation-says-when-it-is-about-to-stop-code-review-sol.md). § The code
  review, below. It ran read-only and the session made the edits, because the soak was running
  against this tree's dev server and an edit under `src/web/` would have reloaded the page under it.
- [x] Gates, push to `dev`
- [x] Feedback note, `feedback-endings.ts`, queue `done`

## Decisions and assumptions (unattended run)

- Assumed Greg wants the same fifteen minutes in every dictating box, not only Feedback. The cap is
  one constant and he said "if there is going to be a cap".
- Assumed a soft chime is welcome: he asked for one for the quiet-microphone warning
  (2026-10-01, *"both visually, and perhaps with a subtle auditory warning too"*).

## The plan review, finding by finding

| | Finding | What happened |
|---|---|---|
| P1 | 12,000 characters is thirteen minutes, not fifteen; migrate to 20,000 | Not built. The database cap is described in code as a limit on what reaches Sentry, so it is put to Greg (§ Questions for Greg) |
| P2 | Three legacy answers at the new cap fail the CHECK as a 500 | Fixed: the legacy three keep 4,000 each, with a test |
| P3 | `/admin/feedback` loses its size bound | Unchanged at 12,072 a row, so the default page is 2.4 MB as before. Paging by size is part of option B |
| P4 | The other Feedback consumers are fine | Agreed |
| P5 | Three timers are not one deadline | Fixed: the tape owns `endsAt`, the cap is also decided on each chunk, once; a late warning chime is dropped. Tests for each |
| P6 | The chimes can land on the tape | The cap chime now plays after the track is off. The last-minute one is accepted |
| P7 | A press just after the cap starts a new dictation and aborts the uploads | Fixed: ignored for 1.5 s, with a test seen red |
| P8 | Test that the live region does not change each second | Done |
| P9 | The cap itself is mechanically safe | Agreed |
| P10 | Fake timers are not a fifteen-minute dictation | A real run in Chrome on the box; result under § The soak |
| P11 | `MAX_MS` is not a listed defence; Stage 2 touches `routes.ts` and a cap that guards Sentry | Stage 2 was cut back to what the database already admitted, so that guard has not moved |
| P12 | Drop the warning minute; show the maximum from the start | Not taken (§ What we passed over) |


## The soak

One real dictation to the cap, in the Feedback dialog, in headless Chrome 152 on the box, against
this worktree's dev server, with a fake microphone looping 87 seconds of the speech clips in
`evals/dictation/clips/`. Run by a Sonnet subagent on 2026-10-07; nobody had run one past two
minutes before.

- **The countdown.** The row first wore `ending` at 14:01 on its own clock, reading *"Dictation
  stops in 0:59"*, and was last seen at *"0:04"* at 14:56. Shot:
  [14:20](261007b-shot-1420-countdown.png).
- **The cap.** At the 900-second mark the row read *"Turning that into text…"* and the sentence was
  *"Dictation stops after 15 minutes, so it stopped there. Everything you said up to then is kept.
  [mic-full]"*. The joined transcript was in the box within eight seconds.
- **The parts.** Eight requests to `/api/transcribe`, about every 120 seconds, all 200, seven of
  about 605 KB and a 277 KB tail, each answered in 2.4 to 5.8 seconds.
- **Afterwards.** 15,108 characters in the box, *"15108 characters — the limit is 12000."* shown,
  Send disabled. No console errors. The device copy in IndexedDB was empty.

**Not shown by it:** Safari or AAC (this was WebM/Opus); whether a word is garbled where two parts
join (the clip loops, so a seam cannot be told from a repeat); the chimes (nothing listened); the
late-timer and stale-press paths, which the unit tests cover. It ran before the code review's
fixes; those touch the edges of the cap, not the recording, and the suites were run again after.

## The code review, finding by finding

| | Finding | What happened |
|---|---|---|
| C1 | A stale Stop press after the cap still opens the field's double-press window | Fixed in `useDictationField`: a press at or past `endsAt` is ignored there too. Test through the field |
| C2 | A chunk delivered inside `rec.start()` could cap before the part is in `parts` | Fixed: a part still being opened does not cap; its next chunk does |
| C3 | The timer was armed for a fresh `MAX_MS`, not for `endsAt` | Fixed |
| C4 | "less than a minute" beside `1:00`, and `0:00` over a live microphone | Fixed: "within a minute", and "Stopping dictation…" at and past zero, in both strips |
| C5 | The cap chime played for a superseded or unmounted session, and not on the fallback path | Fixed: one helper, behind `stillOurs()`, on both paths |
| C6 | Docs claimed a shared zero and that 12,000 "holds what the cap lets in" | Corrected in dictation.md and the admin type's comment |
| C7 | Four tests would pass a broken implementation | Each strengthened. Five guards were then removed one at a time and each test seen to fail |
