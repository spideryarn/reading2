# `[mic-offline]` in the Feedback dialog

**[SPIDERYARN-READING2-1K](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-1K)** · reported
2026-09-05 07:37 UTC · **shipped** on `dev` 2026-09-05 · *the on-device fallback is deferred*

## What the reader said

> I tried using the microphone input in Feedback and got a [mic-offline] error. If it's offline
> before, we should disable the mic input button. If the error appears afterwards, we should add a
> Retry button. And/or any other improvements you can think of, including perhaps offering a
> fallback to on-device models if available (eg Apple Speech)

## What we did

The report has an "if" in front of each half because it was impossible to tell which had happened —
and that turned out to be the finding. **`[mic-offline]` was two different sentences under one
code**: the browser's speech recogniser losing its connection *while you were still talking*, and
the upload failing *after you stopped*. Two more codes were in the same state. All three are split,
and a test now reads every `[mic-…]` sentence out of the tree and fails on a collision.

Four things shipped:

- **A recogniser that dies no longer ends the dictation.** It is decoration — the words that get
  saved come from the recording — so it now takes the live preview with it and nothing else. That
  was almost certainly what you hit, and it was stopping the recording mid-sentence.
- **The button is disabled when the browser says there is no network**, and says why. Not while a
  dictation is running, because the same button is Stop.
- **Try again**, on the audio we kept, when the transcription failed and sending the same bytes
  again could plausibly work.
- **The audio is kept on every failed transcription**, not only when the box was empty.

**Deferred: the on-device fallback (Apple Speech / Web Speech).** It is a second transcription path
with its own permission and its own failure modes, and it cannot be given this app's vocabulary —
which is the measured reason the current design beats nineteen dedicated transcribers. The plan doc
says what it would cost and what the cheaper first step is.

Handled together with [-1J](260905_0734-dictation-includes-ums-and-ahs.md).

→ [260905c-dictation-filler-words-and-mic-offline.md](../plans/260905c-dictation-filler-words-and-mic-offline.md)
