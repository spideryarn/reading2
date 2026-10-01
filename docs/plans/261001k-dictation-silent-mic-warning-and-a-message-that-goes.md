# 261001k — Dictation: a quiet microphone you are warned about, and a message that goes away

Feedback report SPIDERYARN-READING2-7Z (spya-wu265m), from Greg, 2026-10-01; Overseer queue item
qi-brske4bm. His words, from the production feedback row:

> I got this message after trying to record voice in Feedback:
>
> "We didn't catch any words in that. The audio is below if you want it. [mic-silent"
>
> Two things:
> - Warn me (both visually, and perhaps with a subtle auditory warning too) while recording if it
>   looks like this is a problem
> - I submitted the feedback report by typing, then reopened the Feedback modal again later, and it
>   was still showing that same message every time!
>
> — Greg, 2026-10-01

Up: [plans.md](../project/plans.md). The area: [dictation.md](../project/dictation.md).

## What is wrong, traced

**The message that stays.** `FeedbackDialog` is mounted on every page whether it is open or not, so
its `useDictation` lives for the life of the page. A `[mic-silent]` ending calls
`setError(…)` and `setRecording(recorded)` (`useDictation.ts`, the `landed` path and the `retry`
path). The only things that clear `error` are starting a new dictation and pressing Retry. Sending
the report calls `discard(false)` in `FeedbackDialog.tsx`, which empties the form and touches
nothing in the dictation. So the sentence, and the audio row under it, outlive the report they
were about, and greet the reader on every later opening.

A second, smaller version of the same thing: the **×** on the audio row (`clearRecording`) throws
the audio away and leaves the error saying *"The audio is below if you want it"* over nothing.

**The warning while recording.** One exists already, and it is mild on purpose. `useAudioLevel`
sets `quiet` when nothing crosses −55 dBFS for ten seconds, and the strip's words change to
*"No sound detected yet"*, in the same faint grey as *"Listening"*. `audio-level.ts` records why
it is mild: an earlier draft said *"No sound reaching the microphone. Check your input device"* on
a four-second timer, and GPT Sol's review killed it because a reader thinking for five seconds, or
a headset with a noise gate, would be told their hardware was broken. That reasoning is about the
**wording** — an accusation on the strength of an inference — and stays. Greg is asking for the
observation to be **noticeable**, which the grey text is not.

**The `[mic-silent` with no closing bracket** is the source sentence's `[mic-silent]` cut short in
the copy, not a rendering fault — the string in `useDictation.ts` ends in `]`. The bracketed code
itself is house policy ([copy.md § The bracketed code](../project/copy.md#the-bracketed-code)): it
is the four characters a reader can quote, and it is what made this report traceable in one grep.
It stays; this plan does not touch the codes.

## What we will do

### Stage 1 — the message goes with the report (the bug)

1. `useDictation` gains **`artifact()`**, a number that names *what the line under the box is
   about*, and **`dismiss(artifact)`**. The number moves on whenever something new can appear
   there: a new dictation, a Retry, a recovered recording placed on the strip, a discard.
   `dismiss(n)` clears the error and everything kept (the recording, the Retry offer, the device
   copy) **only if the number is still `n` and nothing is running** — no live microphone, no
   transcript or retry on its way. Otherwise it does nothing.
2. `FeedbackDialog`'s `send` reads `artifact()` when Send is pressed and, when the report is filed
   and the box still holds what was sent (the `discard(false)` branch), calls `dismiss` with it.
   So a send that lands late — after the reader closed, reopened and tried another dictation, or
   pressed Try again — cannot wipe a message about something newer. Not on close: a draft survives
   being dismissed (`discard`'s header), and the dictation line belongs to the draft.
3. `clearRecording` (the **×**) also clears the error, so a sentence pointing at the audio row does
   not outlive the row.

Red first: a `feedback-dialog` test that a filed report dismisses the artifact read at Send, and a
failed one does not; `useDictation` tests that `dismiss` clears a `[mic-silent]`, and does nothing
while armed or once a newer dictation has started.

**Forgetting the device copy is a new deletion rule**, and it is stated rather than slipped in:
until now a kept recording lived until it was delivered or the reader discarded it. Filing the
report is now the third way out — the reader was offered Save, and chose to type instead.
`release()` instead would bring it back on the next opening as `[mic-recovered]`, which is the
reported bug again.

### Stage 2 — the warning, noticeable (the suggestion)

1. **Visual.** When `quiet` is true, the strip line takes a warm warning colour —
   `var(--highlight-ink, var(--highlight))`, the colour `.prof-mic-warn` already uses for *"a fact
   worth knowing, not a failure"* — and a small `MicOff`-free warning glyph (`TriangleAlert`, the
   one the error line wears, at the strip's size). The words stay *"No sound detected yet"*: the
   observation, not a diagnosis. The device name and **Change** already appear beside it in this
   state, which is the useful next step.
2. **Sound.** The first time `quiet` goes true in a dictation — **once per dictation**, not once per
   stretch of quiet — a short, soft two-note chime (`src/web/quiet-chime.ts`: two oscillator notes,
   about 300 ms, peak gain ≈ 0.04). No new dependency, no asset. It plays from `useDictation`
   through the page's one `AudioContext`, the one the press already created and resumed inside
   its gesture, rather than a second context made ten seconds later — Safari limits contexts per
   page, and a context made outside a gesture may start suspended. Every dictating box gets it.
   If there is no context, it does nothing: it is a nicety on top of the visual, not the warning.

   Once per dictation because the chime **may be picked up by the microphone** (through speakers,
   or a loopback input): that sound would end the quiet, and ten seconds later a per-stretch rule
   would chime again, forever. A short low tone is not speech, so it should not reach the
   transcript.

Red first: a strip test that `quiet` renders the warning class and glyph; a hook test that the chime
plays once when quiet arrives and not again after quiet → sound → quiet in the same dictation, and
again in the next dictation.

## The simpler option passed over

**Clear the dictation's message on every close.** One line in the close path, and it fixes what
Greg saw. Passed over because a draft deliberately survives a close (`discard`'s header, and the
failed-send accident behind it): a reader whose transcription failed with `[mic-upstream]`,
who closes by accident and reopens, should still find the Retry button and the audio. Clearing on
*send* is the moment the message stops being about anything.

## Deferred, named

- **A words-based warning on Chromium.** `[mic-silent]` means the transcriber heard no speech; a
  loud fan or the wrong microphone gives sound without speech, and the −55 dBFS `quiet` signal
  never fires for it. On Chromium the live recogniser offers a second signal — ten seconds of sound
  with no interim words. (Since Chromium 135 it is handed the same track as the tape —
  `r.start(track)` in `useDictation.ts` — so the two hear the same microphone.) Not built now: the
  recogniser is documented as decoration that dies without ending the dictation, so "no words"
  can mean a dead recogniser rather than a speechless room, and it exists on one engine only. It is
  the signal that would catch the case the −55 dBFS one cannot, so it is the next thing to build if
  this one proves not enough.
- **A shorter quiet timer.** Ten seconds is what `audio-level.ts` argues for; not moved.
- **A setting to mute the chime.** Add it if anybody asks.

## GPT Sol's plan review, and what changed

[The review](261001k-dictation-silent-mic-warning-and-a-message-that-goes-plan-review-sol.md):
"revise before build". Taken:

- **F1 (P1), a late send wiping a newer message** → the `artifact()` identity above.
- **F3 (P1), the chime causing its own next chime** → once per dictation; "is recorded" corrected
  to "may be picked up".
- **F4 (P2), a second AudioContext** → the chime uses the hook's own.
- **F5 (P2)** → the deletion rule is stated above; a recovery placed after Send moves the
  identity, so it is never dismissed by a send that did not see it.

**F2 (P1), Try again pressed during the send**, is answered by the identity rather than by its
suggested fix (aborting the retry and disabling the button): pressing Try again moves the number,
so the late `dismiss` does nothing and the retry carries on. If the report then lands, the form
empties and the retry's words arrive into the next, empty report — words the reader asked for,
in the box they are now looking at. Not lost, and not worth a second guard.

## Docs

`dictation.md` gets a line on `dismiss()` and on the warning's look and sound; the note under
`docs/user-feedback/`.
