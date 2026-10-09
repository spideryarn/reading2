# A dictation's transcript can land in the next comment's or quiz question's box

Queue item `qi-cfrv4spd`. Found by GPT Sol's plan review of
[261005a](261005a-dictation-double-press-on-stop-also-sends.md) (F1), older than that plan, which
fixed the *send* half (`doneKey`) and recorded this half as a known gap.

Authority: Greg, 2026-10-09, on the Overseer's list naming this item:

> Those three bugs that you mentioned all look good to fix

> You are definitely authorised to fix bugs any time you notice them.

## The bug

The comment dialog and the quiz panel keep one mounted `useDictationField` (so one `useDictation`)
while the reader moves from comment to comment, or question to question, and clear the box on the
move. On a browser with no live words (Safari, Firefox; Chromium when the recogniser hears nothing)
the field has no span, so nothing proves the box still belongs to the dictation. A transcript that
arrives after the reader has moved on is put into the new comment's or question's box, at its caret:
the reader's words, attached to something they were not said about (vision principle 6 is the other
side of this — do not lose what the reader gave us, so the fix cannot just drop them either).

The same is true of **Try again**. A failure row is deliberately left on screen across a box change
(useDictation.ts, the recovery effect's note), so a reader who moves on and then presses Try again
puts comment A's words into comment B's box.

## The fix

**A dictation is bound to the box it was spoken into, and is delivered only there.**

"Which box" already has a name: the keeper's `box` (`comment:<id>`, `quiz:<slug>:<question>`,
`chat:<slug>`, …), which is per comment and per question precisely so a recording is never offered
back under the wrong one. The session already snapshots its keeper at the press (`Session.keeper`).
So, in `useDictation`:

1. Every delivery — the session's own ending and a retry — first asks whether the box has moved:
   the box the dictation belongs to (the session's keeper's box; for a retry, the box recorded on
   the offer) is non-null, and the hook's current keeper box is non-null and different.
2. If it has, `onTranscript` is **not called**. The words are offered back instead, exactly like a
   failed upload's: the recording stays on the strip with a sentence saying why
   (`[mic-moved]`), Try again stays available with the transcribed text cached (no second
   transcription charge), and the device copy is held. Try again in the wrong box is refused the
   same way and changes nothing; back in the right box it lands.
3. A recovered tape's offer records the box it was recovered into, for the same check.

**Why a current box of `null` delivers.** Feedback and the command bar drop their keeper while shut
and deliberately keep receiving a transcript that arrives after closing (261005a, F2). Null means
"not on screen", not "somewhere else"; only a *different* box refuses. A box with no keeper at all
is null on both sides and unchanged.

## Passed over

- **Bind in the field, by `doneKey`.** Simpler to write, but `doneKey` for Feedback, the command bar
  and Feedback's reply box encodes *visibility*, so delivery there would be refused on close — a
  behaviour change 261005a chose against. It would also need a second parameter, and the field
  cannot keep the recording on the strip; the hook can.
- **Refuse and rely on the keeper** (release the tape; it is offered back when comment A is next on
  screen). One line, but silent: the reader sees their words vanish, and on a device that cannot
  keep (no IndexedDB, no Web Locks) they are gone.

## Limits

- On Chromium, the live words already landed in A's box before the move. If that box's text comes
  back when the reader returns (the quiz keeps answers per question), Try again puts the transcript
  beside them: a duplicate the reader can see and delete, chosen over a loss.

## GPT Sol's plan review, and what was taken

[The review](261009a-dictation-transcript-lands-in-the-next-box-plan-review-sol.md), five findings:

- **F1, taken.** Feedback's reply box is reused by Previous and Next under one keeper name, so the
  binding did not see a move. Its keeper is now `feedback-reply:<question id>`.
- **F2, half taken.** Annotate's keeper left out the quote that `annotateKey` includes; now it uses
  `annotateKey`. Chat's keeper is per article, not per conversation, so a recovered tape can be
  offered in another conversation of the same article. That is the recovery partition, not this
  bug (a chat composer is remounted per conversation, so delivery is safe), and is left for a
  separate item.
- **F3 (P0), taken.** A new press clears the offer, which before this change would have landed. A
  press is refused (`[mic-moved-held]`) while a moved offer has no verified device copy.
- **F4, taken.** A Chromium live phrase confirmed after the move went into the new box. Live
  phrases are bound the same way and are not counted when refused.
- **F5 (P0), taken.** Recovery could publish the new box's old tape while the moved transcript was
  still on its way, then lose it to a later `forgetHeld`. Recovery now waits for an idle hook with
  no retry in flight, and lets the claim go.

Also from its notes: a wrong-box Try again is refused before any request, so it pays for nothing.

## Tests (red first)

`tests/dictation-lands-in-its-own-box.test.tsx`, over the real hook on the no-recogniser path:

1. Start in box A, stop, move to box B (keeper box changes, value cleared), answer the transcript:
   B is empty, the strip has the recording and `[mic-moved]`, canRetry is true.
2. Try again in B: still empty, still offered. Move back to A, Try again: the words land in A,
   with no second transcription call.
3. A failure in A, move to B, Try again with a good answer: B stays empty.
4. Shut (keeper null) before the transcript: it still lands (Feedback's case, unchanged).
5. A failure's Try again in flight when the box moves: offered back, not delivered.
6. A new press over a moved offer with no device copy: refused, the offer kept.
7. Chromium: a final phrase after the move does not reach B.
8. B's left-behind tape is not recovered while A's words are on their way.

Each was seen red with its guard disabled.

## Browser check

A Sonnet subagent, Playwright on the box with Chrome's fake microphone, Quiz on
`fowler-phrenology`, at 1440, 820 and 390 wide. The fake microphone only beeps, so
`/api/transcribe` was intercepted to return a fixed sentence 6 s late: the client side is what
was exercised, not the model. The ordinary path landed in the same question's box. Dictating on
question 4, stopping and pressing Next straight away left question 5's box empty and showed the
`[mic-moved]` row with Try again, Save and Discard; back on question 4, Try again put the words
there. Nothing overflowed. Not checked in the browser: `[mic-moved-held]`, and a comment's
follow-up box (the tests cover both). Shots: `261009a-shot-1-desktop.png`,
`261009a-shot-2-ipad.png`, `261009a-shot-3-phone.png`.
