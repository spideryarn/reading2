# Dictation: a short recording is heard, and a double press on Stop that lands

Up: [dictation.md](../project/dictation.md)

Two admin reports from Greg (provenance proven by `feedback-reporter.ts`, exit 0), batched as
Overseer queue item `qi-23mq9een`, session `fbaz6puq-dictation-short-and-double-click`. Both were
filed from Chat on `rhizome-1000-plateaus-introduction-lambert-says-spya-jc9azw`.

> When I try and use the voice dictation mode, it looks like there's some kind of cutoff for less
> than a few seconds that it treats as being basically empty. The problem is that's not much help in
> something like Command Bar, where I might want to give a really brief instruction by voice.
>
> — Greg, spya-az6puq (SPIDERYARN-READING2-HQ), 2026-10-11 09:27 UTC

> … as soon as I click the first of the two double-click clicks, it automatically kind of changes
> the UI, and so it's very hard to click the second time. So I think probably what we need is a very
> short delay, maybe 300 milliseconds at most, that after the first click, before, I guess, it gets
> sent, so that it waits for a second double-click. Or maybe it—well, maybe you can see a better
> way. It's not worth a huge amount of complexity. … I suppose we could replace it with a long
> click. That's simpler.
>
> — Greg, spya-j5h3cb (SPIDERYARN-READING2-HN), 2026-10-11 09:24 UTC

## Prior work

- [261005a](261005a-dictation-double-press-on-stop-also-sends.md) built the double press: for
  600 ms after Stop (`DOUBLE_PRESS_MS`), a second press on the same button means "send when the
  words arrive".
- [261008d](261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md) found that in
  Chat the button dropped 28.7 px at Stop, and held the strip still so it no longer moves.
- [261010f](261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md) added
  `finishThenDone()` — the box's own Send, pressed mid-dictation, stops and sends once the words
  land — and the "fast ending" path for a second press after the words are already back.

## Part 1: anything under two seconds was thrown away

**Cause.** `MIN_MS = 2000` in [`mic-recording.ts`](../../src/web/mic-recording.ts). The tape's
`collect()` returns `null` for a dictation shorter than that, and a `null` ending is "nothing worth
keeping": nothing is uploaded, and the reader is told *"We didn't catch that … [mic-empty]"*. The
floor was written (GPT Sol's plan review of 260827k, item 5) so that a press followed at once by a
second press would not be **offered back as evidence** — but the same `null` also decides whether
the words are transcribed at all, so it became a two-second minimum on what anyone may say. "Quotes"
into the command bar is about a second, press to press.

**Fix.** `MIN_MS = 600`. An accidental start-and-stop is two presses a few hundred ms apart, so it
is still caught; a one-second instruction goes to the transcriber. Test first:
`tests/mic-recording.test.ts` — *"keeps a one-second dictation"* was red at 2000 and is green at
600; the existing *"too short"* case now stops at 300 ms.

**What it gives up.** Room tone between 0.6 and 2 s now reaches the model, which could in principle
invent a word from it. Two things already stand there: an empty transcript is a success that says
`[mic-silent]` and offers the audio back, and the server refuses anything under
`MIN_AUDIO_BASE64`. Not measured against the real model; if an invented "Thank you." turns up from
a short press, the next step is a level check (the quiet meter already measures), not a longer
floor.

**The fleet dashboard had a second floor** (GPT Sol's plan review, F1): `MIN_AUDIO_BASE64 = 37_000`
in [`tools/fleet/transcribe.ts`](../../tools/fleet/transcribe.ts), two seconds of AAC, so a
one-second dictation there was answered as silence on the server. It is now the product's 2,000;
`tests/fleet-transcribe.test.ts` *"sends a one-second recording"* was red first. Its rate limit
(one paid request per 3 s) is unchanged, so two brief dictations back to back there can still be
refused; that was already true of longer ones.

**Passed over:** a lower floor only in the command bar. Every box has the same problem at a smaller
scale ("Yes." as a quiz answer), and one number is simpler than a per-box one.

## Part 2: the second press does not land

### What is happening (measured)

A Sonnet browser check (Playwright, system Chrome, fake microphone, `/api/transcribe` stubbed,
this branch before any Part 2 change) sampled the button every frame for 800 ms after Stop:

| | Chat 1440 | Chat 390 | Command bar 1440 |
|---|---|---|---|
| displacement in the 600 ms, transcript 2 s | 0.6 px | 0.6 px | 0 px |
| double click (~320 and ~490 ms gaps), transcript 2 s | sent | sent | pressed Enter |
| double click ~490 ms, transcript 250 ms | **missed**: button dropped ~59 px at +394 ms | — | **missed**: button was idle "Dictate" again at +506 ms |

So 261008d's fix holds, and a double press works **when the words are slow**. Two things still
defeat it:

1. **A fast transcript wins the race.** The words land inside the 600 ms, the box goes idle, and
   everything 261008d held still is let go: in Chat the strip lines leave and the button drops
   ~59 px; in the command bar the button turns back into a Start button. 261010f's "fast ending"
   path accepts a second press after idle, but only if the press can still find the button, and
   only until 600 ms. A few seconds of speech, which is what a double press is for, is exactly a
   fast transcript.
2. **The first press makes the button look finished.** The orange Stop square becomes a faint
   spinner and Chat's Live button dims. The button is live for 600 ms, but nothing says so.

Both are what Greg described: *"as soon as I click the first … it automatically kind of changes the
UI"*.

### Fix: Stop waits a moment for the second press (Greg's first suggestion)

On a box with `onDone`, **a Stop press holds for `DOUBLE_PRESS_MS` (300 ms) before it stops**.
Nothing changes on screen while it holds; the microphone stays on and the button is still Stop.

- A second press inside the hold cancels it and calls the existing `finishThenDone()`: stop now,
  and run the done action once the real transcript is in the box, under all its existing rules
  (real words only, same `doneKey`, refusals of the box's own).
- No second press: the hold expires and stops exactly as a Stop press does today.
- A box without `onDone` (the profile boxes, the Illustrated note, the fleet dashboard) stops at
  once, as now.

**Because nothing has stopped yet, nothing can race.** The second press always lands on the same
Stop button in the same place, however fast the transcriber is. And the after-Stop machinery goes:
the 600 ms window (`againOpen`, `againTimer`), `again` and the button's `pressable` state, the
"fast ending" path (`stoppedAt`, `endedWith`, `stopAwaitingEnd`), and `DONE_WORDS[…].again`. That
is the larger part of what 261005a and 261010f added to the field, and every rule they wrote about
the second press is now the first rule of `finishThenDone`.

**Edges, each with a test:** the cap arriving during the hold (the expiry finds the session no
longer armed, or past `endsAt`, and does nothing; the existing cap guard in `toggle` still stops a
press at or after the cap from opening a hold); the box's own Send pressed during the hold (it is
`finishThenDone`, which clears the hold); an unmount clears the hold; a `doneKey` change during the
hold still stops (the reader pressed Stop), and the wish to send stays tied to the key.

**Changed by GPT Sol's plan review** ([review](261011y-dictation-plan-review-sol.md)):

- F2: the hold is **not** cleared when the phase returns to `opening`. Chromium's recogniser does
  that after an ordinary pause inside one session, and clearing the hold there would leave the
  microphone on after the reader pressed Stop. The expiry reads the latest render's hook and stops
  whatever is still armed; a session the reader did not start cannot exist inside 300 ms, because
  starting one is a press, and a press during the hold is the second press.
- F3: **the focus stays on the button during the hold.** Every press used to send the focus back to
  the box at once, so Enter twice on the button was Enter on Stop and then Enter in the box. Now
  the box gets the focus when the hold ends or the second press is taken.
- F4: a `doneKey` change does not clear the hold (it clears only the wish, as before).
- F5, the 300 ms window against the measured ~320 and ~490 ms gaps: those gaps were the test
  script's, inflated by a screenshot between the clicks. Kept at Greg's ceiling; if he finds it too
  tight, it is one number.
- F6, accepted as a residual risk: on Chromium a live recogniser phrase can land during the hold
  and grow the box by a line, moving the button. It could do the same before this change, and the
  hold is a third of the old window. Not buffered; if it shows up, the fix is to hold live phrases
  back until the hold ends.

**What it costs.** A single Stop on a box that sends is 300 ms later. The last 300 ms of audio is
also recorded, which is harmless. Greg named this trade: *"a very short delay, maybe 300
milliseconds at most"*.

**Why 300 ms and not 600.** Greg's ceiling. Platform double-click intervals default to around
500 ms, but a deliberate double click is typically 100–250 ms between presses, and every
millisecond here is added to every single Stop.

### Passed over

- **A long press on Stop.** Greg offered it as simpler. It is not simpler here: a long press on
  iOS raises the text callout unless suppressed, the click that follows a long press has to be
  swallowed, and a held press gives no feedback until it fires. It would also be a second gesture
  to teach, beside the double press already named on the button's card and in `/help`.
- **Keep the 600 ms window and also freeze the layout until it closes.** Holding the strip and the
  button's look still for 600 ms after the words land would fix the race too, but it means
  delaying the arrival of the words in the box' layout, and it keeps all of the after-Stop
  machinery. The hold removes that machinery.
- **Keep the button looking like Stop after the first press, but still stop at once.** Fixes the
  look, not the race.

## Docs and help

- [dictation.md § A double press on Stop also sends](../project/dictation.md#a-double-press-on-stop-also-sends):
  rewrite the window bullets as the hold.
- `/help` (`keyboard.md`, `modes/chat.md`) already say "Press Stop twice quickly" — still true.
- The button's card (`DICTATION_DOUBLE_STOP`) — check its wording still holds.
