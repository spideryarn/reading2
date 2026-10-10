# Feedback: Send never silently does nothing after dictation, and the draft survives a reload

Up: [plans.md](../project/plans.md) · reports `spya-t9qu3v` (#538, SPIDERYARN-READING2-GK, problem)
and `spya-exhqqr` (#536, SPIDERYARN-READING2-GH, suggestion), both Greg's
(`feedback-reporter.ts` exit 0), queue item `qi-mzvstkdy`, session `fbt9qu3v-feedback-dialog-hang`.

> Dialogue hung again. It was after I'd done a couple of voice messages, and I think there was, I
> could see the send button, but when I tried to press it, nothing happened. I tried switching away
> and back. Yeah, there was definitely something going on.
>
> — Greg, 2026-10-09 23:55 UTC (`spya-t9qu3v`)

> Feedback dialog just somehow the whole page got hung. I guess I wonder if it's worth auto-saving
> the feedback dialog every few seconds after a debounce, so that if it, if the page does get lost
> or blocked, it can reload. I don't know, that might then make it complicated if you try and open a
> feedback dialog in multiple tabs. So I don't know, it might be overcomplicated and overreacting.
>
> — Greg, 2026-10-09 23:53 UTC (`spya-exhqqr`)

## What we know

- **Device**: an iPad (Safari 17 with a desktop UA, 834×1112 at 2×), on the home page, so dictation
  runs with no live recogniser: record, stop, upload, words land.
- **The hung session left no trace.** Both reports were filed from a fresh page load afterwards: the
  diagnostics' request log starts with a page-load burst, then one `/api/transcribe` (1.3 s and
  2.6 s) and the report. No console errors in either.
- **Not reproduced.** A browser run (system Chrome, fake microphone, `/api/transcribe` stubbed,
  834×1112 with touch and desktop) tried two dictations then Send, a double press on Stop, synthetic
  hide/show/pagehide/blur mid-dictation and mid-transcription, Escape and reopen, a 500 and a 10 s
  hang from `/api/transcribe`, and the microphone's hover card. Send worked every time, nothing
  covered it, and no long task exceeded 0.8 s. Real iOS backgrounding was not reproducible here.
- **A static trace (Opus) found no way to freeze the whole page** — no effect loop, no lingering
  `inert`, every dictation wait has a deadline (3 s flush, 120 s upload, 3 s IndexedDB) — **but three
  ways for Send to look live and do nothing:**
  1. **The microphone is on and Send says "Send".** `disabled` includes `dictationBusy`
     (`readOnly || armed`), but the label changes only while transcribing; while the microphone is
     armed the button reads "Send", greyed only by 45% opacity, and pressing it (or ⌘+Enter) is
     silently refused. Ways to land there unawares: iPadOS muting the capture when the reader
     switches away (no dictation code listens for `visibilitychange` or track `mute`), a
     `getUserMedia` still pending, or (2).
  2. **The second tap of a double press on Stop can start a new recording.** `again` is offered only
     while transcribing; if the ending reaches idle inside the 600 ms window (an empty recording, a
     fast `[mic-empty]`), the second tap goes to `toggle` and starts the microphone again — quietly,
     which is (1).
  3. **The feedback POST has no deadline.** A request suspended with the app can stay unsettled; the
     `sending` latch then refuses every press until the dialog is reopened. (The button would read
     "Sending" here, so this fits the words less well.)

So the honest position is: **the hang is not reproduced, and the fix is to make each of these
states impossible to be stuck in silently**, rather than to claim the cause.

## The change

Revised after GPT Sol's plan review (REWORK, F1–F7:
[its answer](261010f-feedback-dialog-send-after-dictation-plan-review-sol.md)); each finding's
outcome is named inline.

### Stage 1 — Send always does something

1. **Pressing Send while the microphone is involved stops it and sends once the words arrive.**
   It is the double press on Stop, reached from the Send button (and ⌘/Ctrl+Enter). A new
   `useDictationField` verb, `finishThenDone()`: record the same wish `again` records (`wantSend`,
   `sendingAfter`) **before** stopping, because on Safari a stop can end the session synchronously;
   then stop if armed, unless the cap has already stopped it (never take the start branch). It sends
   only if a real transcript landed, the same rule as the double press; otherwise nothing is sent and
   Send is pressable again with whatever the strip says.
   - **Send's `disabled`** becomes `(!somethingSaid && !dictationBusy) || over || sending ||
     preparing` (F1: on Safari the box is empty until the words land, so "something said" cannot
     gate a busy press). **`send()` refuses in this order**: not on Write, the latch, over length,
     preparing; then `dictationBusy` → `finishThenDone()` and return; then nothing said.
   - The two existing tests "will not send while the microphone is still listening / transcript is
     on its way" are rewritten, not deleted: still no POST with rough or empty words, and now the
     wish is asked for.
   - This replaces a deliberate refusal (GPT Sol, 2026-09-02: ⌘+Enter mid-sentence sent rough words
     and left the microphone on). Both harms stay avoided: the microphone stops and the report waits
     for the real transcript.
   - **A wish never crosses into a new session** (F6): it is withdrawn whenever the hook enters
     `opening`, which covers the device-change restart that ends a session without `onEnd`.
   - A stop while still `opening` ends with no audio and no message; Send is then simply live again.
     Not surfaced further (F6's third point): nothing was recorded, so there is nothing to lose.
2. **A second press inside the double-press window still means "send", even after a fast ending**
   (F5, the preferred form rather than a blanket suppression). Only on a box with `onDone`: a press
   within `DOUBLE_PRESS_MS` of the Stop press, arriving after the ending has already reached idle,
   runs `onDone` if that ending delivered words for the same `doneKey`. If it delivered nothing (a
   failure, an empty recording) the press stays an ordinary press and starts a dictation, because
   trying again straight away after a failure is what the reader wants
   (`tests/dictation-double-stop-sends.test.tsx`, "a press after the dictation has ended is an
   ordinary press"); a microphone restarted that way is visible, and one Send press from sent under
   item 1. Boxes without `onDone` are unchanged.
3. **The feedback POST gives up after 60 s** (a timer and an `AbortController`, which fake timers
   can drive and older Safari has), with the existing "couldn't send" panel. 60 s rather than 30 s because a consented report can carry a screenshot over a slow
   link. The test mock observes `init.signal` (F7) and checks the latch is released, a retry uses
   the same id, and a late timeout cannot overwrite a newer attempt.
4. **An edited retry is a new report** (F2's second half, and the defect `FeedbackDialog.tsx`
   already names as deliberately unfixed): the body and kind of the newest attempt are recorded at
   Send; if they differ at the next Send, a fresh id is minted first. The server answers `duplicate`
   to a reused id with the *old* row, so a timeout followed by an edit would otherwise thank the
   reader and drop the edit. The worst case is now two rows for one report, never lost words.

Tests first, each red before its fix.

### Stage 2 — the draft survives a reload (the suggestion, simplest version)

The words and the kind are saved to `localStorage` under `spya.feedbackDraft.<reader>`
([auth.md § Browser storage that is a reader's is keyed by that
reader](../project/auth.md#browser-storage-that-is-a-readers-is-keyed-by-that-reader)), 1 s after
the last change, with the time and the tab's report id. They are read back once, in the lazy state
initialiser, when the dialog mounts for that reader (once a page load), so a prefill then appends
to the recovered words as it does to any draft (Sol's note on the prefill). A spoken draft is
already kept on the device until its words land (`keepDictation("feedback")`), so this covers typed
and transcribed words, which were the part lost to a reload. Every storage call is wrapped: a full
or blocked `localStorage` costs the copy, never the dialog.

- **A restored draft gets a fresh report id, not the saved one** (F2's first half, declined with a
  reason). Saving the id would make a reload after a landed-but-unanswered send file once, but two
  tabs that both restore one draft would share an id, and the second tab's send would be answered
  `duplicate` and its words dropped. A possible duplicate row is cheaper than lost words.
- **Removal is only ever of a snapshot this tab read or wrote** (F3): the id, body and kind must all
  still match, so a restored id cannot erase newer words its original tab wrote later. Success and
  clearing both the words and the kind checks every snapshot this draft has used, including the saved
  id behind a restored draft and an id rotated for an edited retry. Anything changed after Send stays
  in the form and its words and kind are saved synchronously under the next id, before the one-second
  debounce.
- **Multiple tabs, Greg's worry:** one draft per reader, last write wins. A tab reads it only when it
  loads, so two open tabs never fight over a box on screen; the cost is that a reload brings back
  whichever tab wrote last.
- **Gone** when the report is filed, when the reader presses Sign out (beside
  `forgetDictationsOf` in `AccountSection.tsx`), and when read after a week, the same three as the
  dictation copy.
- **Not saved:** the screenshot (too big for `localStorage`), and the diagnostics tick-box, which is
  consent for one report and should be given again.
- **The privacy page says so** (F4). `/privacy`'s paragraph on what the browser keeps lists its
  contents exhaustively, so it gets one clause in the dictation copy's pattern, and
  [privacy.md](../project/privacy.md) and [auth.md](../project/auth.md) a line each. Precedent: the
  dictation copy's clause was added the same way under Greg's report 5M (privacy.md § On the
  reader's own device). The before and after go in the note for Greg.

## Passed over

- **Stopping the microphone when the page is hidden.** It would close cause (1)'s likeliest iPad
  route, but it changes dictation in every box, and on a phone a reader may switch apps mid-thought
  on purpose. With stage 1, a microphone left on is one Send press from sent, so it is not worth the
  product change without evidence. Named here, not queued.
- **A per-tab draft** (`sessionStorage`, or a key per tab): exact, but a reloaded or crashed tab is
  a new tab, which is the case the suggestion is for.
- **Saving every few seconds on a timer**, as the report put it: a debounce on change does the same
  with no timer running while nothing changes.

## Done when

Stage 1 and 2 tests red then green; `npm test`, `npm run typecheck`; GPT Sol on the plan and the
code; [feedback.md](../project/feedback.md) and [dictation.md](../project/dictation.md) say what
changed; pushed to `dev`; note in `docs/user-feedback/` naming both reports.

## What landed

- **Stage 1** as planned: `finishThenDone()` and the fast-ending second press in
  `useDictationField.ts` (`tests/dictation-finish-then-done.test.tsx`, seven tests, red first; the
  fast-ending one reproduced the quiet restart in jsdom); Send's new `disabled` and refusal order,
  the 60 s deadline and the edited-retry id in `FeedbackDialog.tsx` (`tests/feedback-dialog.test.tsx`,
  two tests rewritten and three added, red first). The withdrawal-on-`opening` effect was checked by
  removing it: its test goes red.
- **Stage 2** as planned: `src/web/feedback-draft.ts`, the dialog's restore, save and removal,
  `FeedbackHost` passing `readerId`, and **Sign out** removing it. Nine tests; the two race guards
  (removal of a filed draft with a save pending, removal only when the saved snapshot still matches)
  each go red when
  taken out. The first version of the pending-save test passed with its guard removed, because no
  save had landed before Send; it now saves first.
- **Code review added the transitions the first tests stopped short of:** a failed dictation retry
  cannot turn the next microphone press into Send; a restored or edited-retry draft is removed after
  filing without erasing a newer tab's words; changes made while Send is in flight are durable
  immediately; a kind chosen without words survives; malformed storage is removed; and an older
  timeout cannot overwrite a newer success. Each reproduced the defect before its fix.
- **Words on screen**: `/privacy`'s paragraph on what the browser keeps gained one sentence, after
  the dictation copy's: *"A Feedback report you have started and not sent is kept the same way, so a
  page that reloads doesn’t lose it; it is deleted once you send it or sign out, and is not offered
  back after a week."* `LAST_UPDATED` was already today's date.
- An accident on the way, for the record: a scripted edit to this file replaced an empty slice and
  wrote the paragraph between every character (8.5 MB). `tests/docs-size-cap.test.ts` caught it, and
  the text was recovered exactly by deleting every copy of the inserted paragraph.

## Code review and browser check

- **GPT Sol's code review**: APPROVE WITH CHANGES, seven fixes made by the reviewer and read before
  commit ([its answer](261010f-feedback-dialog-send-after-dictation-code-review-sol.md)). The ones
  that matter: removal is now of an exact snapshot (id, body and kind) rather than by id, so another
  tab's newer words under a restored id survive; a draft changed while a send was in flight is saved
  at once rather than a second later; a kind chosen during a send counts as unsent; a Stop press owns
  exactly one ending, so a later Try again cannot arm the fast second press.
- **Browser** (system Chrome, fake microphone, stubbed transcription, iPad viewport with taps and
  desktop): Send while listening, Send just after Stop, a fast double tap with a 100 ms
  transcription, the draft across a reload and gone after sending, and the `/privacy` sentence all
  passed; one POST each time, no console errors. The thank-you toast's text was not confirmed. Not
  tried on a real iPad, which is where the hang happened.
