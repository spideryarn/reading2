# Dictation records from the first word, and a preview on every browser

Up: [plans.md](../project/plans.md) · area: [dictation.md](../project/dictation.md)

Two admin reports, both Greg's (`feedback-reporter.ts` exit 0), queue item `qi-4v6sx4rw`:

> A user said the Dictation was high-quality, BUT it kept missing the very beginning of what he said
> - is there anything we can do about that? If not, can we make it clearer in the UI when it has/not
> started recording yet.
>
> — Greg, 2026-10-19, spya-za4bxk (SPIDERYARN-READING2-M9)

> Wherever there's a voice Dictation button, can we try and provide a preview of what's being said?
>
> — Greg, 2026-10-19, spya-evtsag (SPIDERYARN-READING2-M2)

## What is actually happening

**The beginning is lost on Chrome and Edge, by design, and the design was wrong.** The recording
(`armTape` in [`useDictation.ts`](../../src/web/useDictation.ts)) starts only once the browser's
speech recogniser fires `audiostart`, which measures **1.1 seconds** after the microphone track is
already open and delivering audio. Everything said in that second is in the track, and goes nowhere:
the tape is not running yet, and the recogniser is not listening yet. The CSS already admits it
(`profile.css` § `.prof-mic.opening`: *"anything said into it is gone"*). The button is outlined and
pulsing for that second rather than filled, but that difference is too quiet to stop people talking. On top of that, every time the
recogniser restarts after a pause (`onend`), the phase drops back to `opening` while the recording
is in fact still running, which is a false "not listening".

Safari and Firefox do not have this problem: they arm the tape the moment the track arrives.

What cannot be fixed here: the time `getUserMedia` itself takes (a permission prompt, or a
Bluetooth headset switching profile, which can deliver silence for a second after the track is
live). That is what the "clearer UI" half is for.

**The preview already exists on Chrome and Edge** (the recogniser's interim words in the strip,
confirmed phrases in the box), and **does not exist at all on Safari, the iPad or Firefox**, where
the strip says *"Listening — the words appear when you stop"*. So "wherever there's a Dictation
button" is, in practice, "on the browsers that have none".

## Stage 1: the tape starts when the track does, and the strip says when to speak

- `start()` arms the tape, sets `audioAt` and the timer, and sets `listening` as soon as it owns
  the track, **on every browser**, rather than only on the browsers with no recogniser.
  `onaudiostart` no longer arms anything. It just does nothing if the session is already
  listening. The live words still start ~1.1 s late on Chrome, but they are decoration and the
  transcript replaces them, and the transcript is made from the tape.
- A recogniser restart (`onend` → `r.start(t)`) no longer sets `opening`: the tape is still
  recording, so the microphone **is** listening. Only the live words pause.
- The pre-`audiostart` death path (`liveGaveUp` before `audiostart`) no longer has to arm the tape
  itself. It keeps its `armTape` call, which is idempotent, so a reordering can never leave a session
  without a tape.
- `opening` therefore now means exactly *"the device is not open yet"*: the permission prompt, the
  microphone lock, `getUserMedia`. The strip's words for it change from *"Opening the microphone…"*
  to *"Wait — opening the microphone…"*, so the reader is told not to speak yet as well as shown.
  The button's two looks (outlined and pulsing, then filled) stay as they are; they are now true.
- Tests: `dictation-phases.test.ts` gets a red-first test that, on the shared-track (Chromium) path,
  a tape is recording **before** `audiostart` fires, and that a recogniser restart leaves the phase
  `listening`. The existing tests that assert the tape waits for `audiostart` are updated, with the
  reason.

## After GPT Sol's plan review: Stage 1 is built, Stage 2 goes to Greg

[The review](261019m-dictation-plan-review-sol.md) passed Stage 1 with two corrections, both taken.
**F3:** Safari and Firefox were not always immediate either. A remembered microphone that did not
open by id awaits `listInputs()` before the tape arms, so all track-dependent setup moves to the
line that takes ownership of the track, before any await. **F4:** a late `audiostart` after Stop
could put `transcribing` back to `listening`, so `onaudiostart` no longer sets the phase at all.

Stage 2 is **not built**, and is put to Greg as a question
([../user-feedback/questions/](../user-feedback/questions/)), for four reasons the review found:

- **F2, the real risk.** On Safari and the iPad a second encoder would run beside the recording, and
  three or four at a tape rotation. Whether WebKit keeps the authoritative file whole under that has
  not been measured, and it cannot be measured from the box. A preview that costs an iPhone its
  transcript is far worse than no preview.
- **F1.** The fleet's transcribe route allows ten calls per context per minute, so 5-second previews
  would use up the final call's allowance and lose the transcript.
- **F5.** Previews have to be told apart from the final call, both to keep their 5xx out of Sentry
  and to cost them. `ai_calls.purpose` already exists, so that is plumbing, not a new field.
- **F7.** Audio sent repeatedly while the reader talks, rather than once after Stop, is a new
  transmission schedule even if the recipient is the same. `privacy.md` would have to say so.
  The brief says a new data flow is Greg's to decide. Corrected cost (F8): about $0.0045 per recorded
  minute for the preview on top of the same again for the final.

What Stage 2 would be, if Greg says yes, is the design below, gated on an iPhone spike first.

## Stage 2 (not built): a rough preview on Safari, the iPad and Firefox

While the microphone is on and there are no live words (`!s.live`, which includes a Chromium whose
recogniser gave up), a **second, short recorder** runs on the same track alongside the tape, in
back-to-back **5-second segments**. Each closed segment is sent through the hook's existing
`transcribe` seam, the same call, the same endpoint and the same vocabulary context as the real
transcript. The strip then shows the **latest segment's words**, in the place and style of
Chrome's interim words (`.prof-interim`, `aria-hidden`).

- **It never touches the box.** The box gets only the final transcript, as now, so a slow or
  out-of-order preview cannot leave words behind. A result older than the one on show is dropped.
- **It never touches the real recording.** Its own `MediaRecorder` on the same track (one capture,
  so the WebKit one-source rule is kept). Any failure — a recorder that will not start, a refused
  upload, an empty segment — stops the preview **silently** for the rest of that dictation and is not
  reported to Sentry. The real transcript is the product, and a preview failure is not a dictation
  failure.
- At most one preview request is in flight at a time; a segment that closes while one is in flight
  is skipped, not queued. Stop aborts any request in flight and clears the preview.
- The strip's sentence changes from *"Listening — the words appear when you stop"* to *"Listening —
  rough words below, the real ones when you stop"* while a preview is running, and goes back to the
  old sentence if the preview stopped.
- The fleet dashboard's microphone uses the same hook, so it gets the same preview through its own
  `transcribe`. Nothing there changes.

**Is this a new data flow?** The plan said no; F7 says yes, in schedule though not in recipient, and that is right. It is the same audio, to the same provider, through the same
endpoint and the same promise: `DICTATION_PROMISE` (*"Your voice goes to OpenRouter and OpenAI to
be transcribed. We don't save it on our servers"*) stays true word for word, and
[dictation.md § The audio leaves the machine](../project/dictation.md#the-audio-leaves-the-machine-now)
(*"held in memory for one request"*) does too. What changes is *when* audio is sent (while talking,
not only at Stop) and *how much*. On these browsers each second is now transcribed twice, which
at the repository's $0.0045 a minute (`src/ai-call.ts`) is about that much again per recorded minute (corrected after F8). Each segment writes its own spend
row, under the same attribution as the dictation's own call.

## The simpler options passed over

- **Stage 1 alone, with the preview declined.** That fixes the bug, but leaves Greg's suggestion
  undone. The preview is decoration, though, and Greg asked for it on every button. Segments of the
  existing call are the cheapest version that works on Safari.
- **Re-transcribe the whole tape so far every few seconds.** No segment-boundary garbling, but
  each call is bigger than the last, so the cost grows with the square of the length, and the
  latency grows with it.
- **Hand Safari's microphone to its own speech recogniser.** That gives up the recording, which is
  the whole reason the vocabulary works ([dictation.md § One capture](../project/dictation.md#one-capture-and-it-is-always-ours)).
- **A streaming transcriber** (OpenAI Realtime transcription, Deepgram) would give a better preview
  and could even replace the two-pass design. It is a new outside service, and so Greg's call. It is
  named under Deferred, not built.

## Deferred

- A streaming transcriber for the preview, if the 5-second segments are not good enough. That is
  Greg's call (a new outside service).
- Detecting a Bluetooth headset's silent first second (the track is live, the samples are zero), and
  holding `opening` until the first non-zero sample.
- Untested on a real iPhone: whether WebKit runs two `MediaRecorder`s on one track. The preview is
  built to fail silently if it does not.
