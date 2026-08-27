# Should a library do the microphone work?

Greg asked, on 2026-08-27, straight after the dictation feature was finished:

> Should we use a library for this? See third-party-library-selection doc.

A fair question to ask at that moment. The mic work had just cost three commits, two
GPT Sol reviews and two bugs that were nobody's fault and took a day to find. "Surely
somebody has packaged this" is the right instinct.

**The answer is no, in all four areas** — though the fourth, recording, only got there
after a review overturned the reasoning and a spike overturned the review. The reason is more
specific than "we already wrote it".

This doc records the survey so nobody has to run it again: the candidate that came close and
the number that killed it, the one that is still open and the three-step spike that would
settle it, and the correction GPT Sol forced on the section I was most confident about.

Follows [third-party-library-selection.md](../reusable/third-party-library-selection.md).
The code under discussion is [reader-profile.md § The microphone](../project/reader-profile.md);
the two bugs are in [microphone-device-and-recording.md](../plans/microphone-device-and-recording.md).

## What is actually here

The first thing the survey changed was the size of the question. Counted 2026-08-27:

| file | total | comment | **code** |
|---|---|---|---|
| [`mic-devices.ts`](../../src/web/mic-devices.ts) | 125 | 87 | **38** |
| [`audio-level.ts`](../../src/web/audio-level.ts) | 157 | 126 | **31** |
| [`dictation-errors.ts`](../../src/web/dictation-errors.ts) | 110 | 77 | **33** |
| [`MicLevel.tsx`](../../src/web/MicLevel.tsx) | 105 | 53 | **52** |
| [`mic-recording.ts`](../../src/web/mic-recording.ts) | 391 | 199 | **192** |
| [`useDictation.ts`](../../src/web/useDictation.ts) | 876 | 377 | **499** |
| | **1,764** | **919** | **845** |

Counted with `grep -cE '^\s*(\*|/\*|//|$)'`, which lumps blank lines in with comments;
`scc` splits them differently and gets roughly 703 code, 985 comment, 76 blank. Either way
the shape holds: **there is more explanation here than there is code.**

GPT Sol's review called the argument I built on that a rationalisation, and it is half
right, so here is the narrowed version. Two kinds of knowledge are mixed up in those 919
lines:

- **Product knowledge, which no library absorbs.** One capture and never two. The `exact`
  device constraint. The −70 dBFS floor and the room tone it was measured against. The
  caps, the minimum duration, the rule that nothing is offered unless it is really
  evidence. This survives any dependency and has to be written down somewhere regardless.
- **Implementation archaeology, which a library *should* absorb.** Recorder event ordering,
  chunk finalisation, codec negotiation, container behaviour. If something else owns that,
  this text should be **deleted**, not kept — comments are maintenance surface, not free
  knowledge, and stale ones are worse than none.

So "a library removes code but removes none of the knowledge" is too convenient. The
accurate version is that a library removes the second kind and leaves the first, and the
second kind is most of [`mic-recording.ts`](../../src/web/mic-recording.ts) and almost none
of the other five files. Which is exactly why recording is the one area below where the
answer changed.

## The four areas

**Dictation** — [`useDictation.ts`](../../src/web/useDictation.ts), 499 lines of code.
The only live candidate is `react-speech-recognition`, and it fails on the load-bearing
constraint rather than on quality: **it does not expose the `MediaStreamTrack`, and it
will not accept one.** This app's entire dictation design is *one capture and never two*,
because WebKit allows a single microphone source and a second `getUserMedia` for the
meter could be drawing bars from a different microphone than the one being transcribed.
The way out is the spec's `recognition.start(audioTrack)`. A wrapper that owns the
recogniser cannot express that, so we would be writing `useDictation.ts` *around* the
library and saving nothing. It also has no device selection, and maps every failure to
one boolean where we need `network`, `audio-capture`, `not-allowed` and
`service-not-allowed` to say four different things to a reader.

Two corrections Sol was right about, neither of which changes the verdict: it does expose
the underlying recogniser through `getRecognition()`, so "cannot express it" overstates the
case — what is true is that its own `startListening()` takes no track, so we would be
reaching around the library to do the one thing that matters. And its types are on
DefinitelyTyped (`@types/react-speech-recognition`) rather than absent; the table below
should be read as *bundled* types, not *no* types. **Keep.**

**Recording** — [`mic-recording.ts`](../../src/web/mic-recording.ts), 192 lines. The area
that took longest to settle. `extendable-media-recorder` is rejected on size;
`mediabunny` was rejected, then un-rejected on review, then **rejected on measurement** — it
fails at the identical configuration, because it drives the same encoder. See below.
**Keep.**

**Level metering** — [`audio-level.ts`](../../src/web/audio-level.ts), 31 lines of code.
`hark` does roughly this and was last published **2018-08-25**. `@ricky0123/vad-web` is
real ML voice-activity detection and ships ~10 MB of ONNX runtime plus a Silero model to
answer a harder question than the one we have; we need *is anything arriving*, not *is
this speech*. `wavesurfer.js`'s record plugin, `react-audio-visualize` and
`audiomotion-analyzer` all draw waveforms, which is a different picture. None of them
carries the measured floor or the fast-attack/slow-release curve, so adopting one means
writing the 31 lines anyway, on top of a dependency. **Keep.**

**Device selection** — [`mic-devices.ts`](../../src/web/mic-devices.ts), 38 lines of code.
**The survey found no credible package** — which is not the same as proving none exists,
but nobody appears to have packaged `enumerateDevices` plus a remembered choice plus an
`exact` constraint, and there is not much to package. Not close. **Keep.**

## The candidates, with numbers

Registry and downloads checked directly against `registry.npmjs.org` and
`api.npmjs.org/downloads` on 2026-08-27; the download week is 2026-08-19 to 08-25.

Weekly downloads are a weak proxy for the "long-lasting community" criterion — they measure
installs, not docs, contributors or answered questions. Read the dates beside them.

| package | latest | published | downloads/wk | bundled types | verdict |
|---|---|---|---|---|---|
| `mediabunny` | 1.55.3 | 2026-08-26 | 2,541,746 | yes | see below — the one to revisit |
| `recordrtc` | 5.6.2 | **2021-03-09** | 306,720 | no | frozen five years |
| `extendable-media-recorder` | 9.2.40 | 2026-08-22 | 284,653 | yes | the serious one; see below |
| `react-speech-recognition` | 4.0.1 | 2025-04-29 | 266,026 | no (DT) | cannot take our track |
| `react-media-recorder` | 1.7.2 | 2025-08-03 | 116,924 | yes | wants to own `getUserMedia` |
| `hark` | 1.2.3 | **2018-08-25** | 105,250 | no | abandoned |
| `mic-recorder-to-mp3` | 2.2.2 | 2020-07-16 | 27,501 | no | **archived** |
| `opus-media-recorder` | 0.8.0 | 2020-06-09 | 26,369 | no | Opus only |
| `vmsg` | 0.4.0 | 2021-04-09 | 17,220 | yes | abandoned |
| `@speechly/react-client` | 2.2.4 | 2023-05-09 | 214 | yes | company gone, repo archived |

`recordrtc` deserves a note, because it is the one that makes our own selection criteria
argue with each other. Our first criterion is *long-lasting community, lots of
docs/discussion/examples, so there will be lots of pretraining data*. By that measure
`recordrtc` is the strongest candidate on the list bar one — 306,720 downloads a week,
years of Stack Overflow. It was also last published **five years ago**, ships no types,
carries 442 open issues, and its WAV path is built on `ScriptProcessorNode`, which is
deprecated. Popularity and pretraining data are a proxy for a library being alive, and here
the proxy comes apart from the thing.

There is a trap inside the trap: the **repository** was last pushed 2024-05-13, so a glance
at GitHub shows recent activity. The **published package** is from 2021. The code moved and
the release did not, and `npm install` gets you the 2021 one.

## The one that came close, and the number that killed it

`extendable-media-recorder` with `extendable-media-recorder-wav-encoder` is a genuine
answer to the bug we hit. It replaces `MediaRecorder` and encodes real WAV through a Web
Audio pipeline rather than trusting the browser's encoder — so the whole three-attempt
ladder disappears, because there is nothing left to negotiate. It is maintained daily,
MIT, typed, and by the same author as the encoder half.

Checked 2026-08-27. **Two of these are measurements and one is arithmetic**, and the
earlier draft of this document called all three "measured", which GPT Sol was right to
object to — no WAV file was ever produced or inspected.

*Measured* (installed the packages; bundled with esbuild, minified, importing only
`MediaRecorder`, `register` and `connect`):

- **19 transitive packages**, including `standardized-audio-context` (a full Web Audio
  polyfill), `rxjs-interop`, `@babel/runtime` and six single-purpose packages by the same
  author. 25 MB on disk, 16 MB of it the polyfill.
- **43.7 KB gzipped.** That is a transfer-size proxy from a standalone entry point, not a
  production figure: it does not account for what a real Vite build shares or drops, for
  parse and compile cost, or for the code it would delete from our bundle. It is also a
  *static* import cost, and recording is only reachable after the reader arms the
  microphone — so a lazy chunk is available and was not evaluated.

*Arithmetic*, from the sample format, against the byte cap in
[`mic-recording.ts`](../../src/web/mic-recording.ts), which is **8 MiB** (`8 * 1024 * 1024`)
and not 8 MB:

| output | rate | 8 MiB cap reached | five minutes |
|---|---:|---:|---:|
| WAV, mono 16-bit @ 48 kHz | 96,000 B/s | **87 s** | 28.8 MB |
| WAV, mono 16-bit @ 16 kHz (resampled) | 32,000 B/s | 262 s | 9.6 MB |
| AAC @ ~128 kbps — the *preferred* path | ~16,000 B/s | ~9 min | ~4.8 MB |
| Opus @ 32 kbps — **measured**, 13,971 bytes in 2.5 s | 5,588 B/s | ~25 min | 1.68 MB |

The ratio is **17× against our measured Opus output** and about **6× against the AAC path
we actually prefer** — not the "24×" the earlier draft claimed, which compared WAV against
the nominal fallback rather than against what the feature normally produces.

The rejection still holds, but on narrower ground than before. Sol pointed out that
"27 MB or 87 seconds" is a false binary, and it is: resampling is the obvious third option.
So it was evaluated — and **16 kHz mono still breaches the 8 MiB cap at 4 minutes 22
seconds**, inside the five-minute limit the feature promises. Meeting both constraints
would mean changing them, and the constraints are the feature: this recording exists so a
dictation that transcribed nothing leaves the reader something to listen to, which means it
has to survive a full session and stay small enough to hand over.

**Rejected on size, not on quality.** Worth saying that plainly, because if the recording
cap ever changes shape — a much shorter clip, or a feature that needs guaranteed-openable
output more than it needs to be small — this becomes the right answer and should be
picked up rather than re-litigated.

## WebCodecs: what the spike actually found

This section has been wrong twice, in opposite directions, and then settled by running it.
Both wrong versions are kept, because the shape of the mistake is the useful part.

**Draft one** said `AudioEncoder.isConfigSupported()` was "argument validation, not
capability prediction" — that WebCodecs was no better than `MediaRecorder`. **GPT Sol
overturned that**, correctly: the WPT suite has a `validButUnsupportedConfigs` array I had
missed, and the spec is explicit —

> If the User Agent can provide a codec to support **all entries of the config**, including
> applicable default values for keys that are not included, return true.
> — [WebCodecs § Check Configuration Support](https://www.w3.org/TR/webcodecs/#check-configuration-support)

`bitrate` is an entry of `AudioEncoderConfig`, so the check is *required* to cover it, where
`isTypeSupported` takes a MIME string and cannot see a bitrate at all. **Draft two**
therefore said WebCodecs would most likely have caught our bug in advance, and marked
recording "not settled, spike required".

The spike ran on 2026-08-27. Chrome, synthetic mono track at 48 kHz:

```
isConfigSupported ch=1 @32000  -> supported=true          <- the probe says yes
MediaRecorder.isTypeSupported(AAC-in-MP4) -> true
mediabunny canEncodeAudio aac@32k mono -> true

CONTROL   MediaRecorder, AAC-in-MP4 + audioBitsPerSecond 32000
          ERROR EncodingError@382ms -> data(0)@382ms
          0 bytes  -> FAILED, the bug reproduces

TEST      mediabunny, same codec/rate/channels/bitrate
          encoder config: {codec:"mp4a.40.2", numberOfChannels:1,
                           sampleRate:48000, bitrate:32000}
          SOURCE ERROR EncodingError
          TIMED OUT in start() after 5000ms
          UNCAUGHT EncodingError
          TIMED OUT in finalize() after 8000ms
```

Three findings, none of them what either draft predicted.

**1. `isConfigSupported` is a false positive here.** It answered `supported: true` for the
exact configuration that then threw `EncodingError`. So the spec requires the check to
consider the bitrate and Chrome does not honour that — the *specification* is stronger than
`isTypeSupported`, and the *implementation*, measured, is not. Sol was right about the text
and the text is not what runs.

**2. WebCodecs does not rescue us, because it is the same encoder.** `mediabunny` hit the
identical wall at the identical configuration. There was never a second AAC encoder to move
to; there is one, reached through two APIs.

**3. It fails *worse* than what we have.** Our ladder sees zero bytes and moves to the next
container in **382 ms**. Mediabunny's `start()` never resolved, `finalize()` never resolved,
and an `EncodingError` escaped uncaught — a reader would have got a dictation that hung
rather than one that quietly recorded in a different container. That is not a criticism of
the library so much as of hanging one's error handling on somebody else's promise: our
fallback is *supposed* to fire here, and theirs has nothing to fall back to.

So **draft one's conclusion was right for the wrong reason**, and the reason it gave has to
be thrown away while the conclusion stands. The rule the code is built on —

> make the recorder prove itself, and fall back when it produces nothing

— is not a workaround for an old API. It is what remains true when the new API's better
probe turns out to be no more honest than the old one's.

### The variable was the channel count

Two earlier runs of the same control on a **stereo** synthetic track produced 37,816 and
38,223 bytes: no failure at all. Set the track to **mono** and it throws. That is why this
morning's bug looked device-independent — all three microphones tested were mono, and a
`getUserMedia` track normally is.

It also means the failure is narrower than
[`mic-recording.ts`](../../src/web/mic-recording.ts) originally described it. Not "AAC plus
a bitrate hint" but, as measured, **AAC at 32 kbps with one channel at 48 kHz**. The
`ATTEMPTS` ladder is unaffected — its first entry sends no bitrate hint at all, which is why
the current code works — but the explanation attached to it is now sharper than the one
written from the first day's evidence.

### Verdict for recording

**Keep it hand-rolled** — now on evidence rather than on the mistaken spec reading draft one
used to get to the same place. `mediabunny` remains a well-built library and this is not an
argument against it in general; it simply does not solve the problem it was being considered
for, and hangs where our code recovers.

What would reopen it: a *second* encoder implementation to fall back to (WebCodecs and
`MediaRecorder` currently share one), or a need for containers `MediaRecorder` cannot
produce. Neither is true today.

## What the field says we should be doing

The second half of the research asked a different question: never mind libraries, is the
way we are doing this the way it is supposed to be done? Sources are specs, MDN, the
WebKit and Chromium blogs, and practitioner writing where no spec covers it.

Mostly the answer is yes, and two of the confirmations are worth recording because they
are places where we deliberately went against general advice:

- **`exact` rather than `ideal` for the device constraint.** MDN and the WebRTC guidance
  both frame `ideal` as the normal choice, because it degrades gracefully. We use `exact`
  on purpose, because "degrades gracefully" here means *silently substitutes a different
  microphone*, which is precisely the failure that produced the Teams-loopback day. The
  general advice is right in general and wrong for our risk.
- **No prior art on the loopback failure at all.** The survey went looking for anyone —
  vendor, spec, blog — who names "the OS default input may be a virtual conferencing
  device that emits exact digital silence", and found nothing. That is
  evidence of absence only as far as one survey reaches — it does not prove the write-up in
  [`mic-devices.ts`](../../src/web/mic-devices.ts) is original — but it does mean there is
  no well-known fix sitting in plain sight that we skipped.

Three things came back as real:

1. **The button announced its state twice, in two vocabularies.** `aria-label` swapped
   between "Dictate" and "Stop dictating" *and* `aria-pressed` was set, which reads as
   "Stop dictating, toggle button, pressed" — a contradiction rather than emphasis. The
   APG's button pattern allows either a moving action name **or** a fixed name with the
   state in `aria-pressed`, and not both.

   My first fix took the wrong branch: I froze the name at "Dictate", kept `aria-pressed`,
   and kept `title` moving — on the reasoning that `aria-label` outranks `title`. It does
   for the accessible *name*, but Sol pointed out that an otherwise-unused `title` then
   becomes the accessible **description**, so the mixture was rebuilt one layer down.

   **Settled as an action button**: the name says what the press will do, `title` says the
   same words, there is no `aria-pressed`. That agrees with the glyph, which already
   switched to a filled square meaning *stop* in the previous round for exactly this
   reason. Pinned by
   [`tests/profile-mic-button.test.tsx`](../../tests/profile-mic-button.test.tsx).

   Worth recording that this makes the microphone deliberately unlike the shelf's view
   buttons, the glossary's sort chips and the search panel's swatches, which all take a
   constant name plus `aria-pressed`. Those are state selectors; this is an action. The
   difference is principled, not an inconsistency to tidy away later.

2. **Contextual biasing is available and unused.** Chrome shipped
   `SpeechRecognitionPhrase` with a `boost` (Intent to Ship 2025-07-09), which biases
   recognition toward a list of phrases. Tempting for a jargon-heavy app — but the box we
   dictate into is the **reader profile**, which has no article and no glossary in scope;
   the jargon there is the reader's own name for their own field, which we do not know.
   **Not adopted.** Worth remembering if dictation ever reaches comments or chat, where
   the article's glossary terms are right there and the case becomes strong.
3. **iOS may need a microphone "warm-up" before the first `start()`.** Practitioners
   report first-attempt failures on iOS Safari fixed by opening the mic briefly
   beforehand. Cannot be settled from this machine; it joins the list of things only a
   real iPad can answer, in
   [microphone-device-and-recording.md](../plans/microphone-device-and-recording.md).

Two useful facts that change nothing today but date this document:

- `recognition.start(audioTrack)` is in the living spec and shipped in **Chrome/Edge 135+**,
  not Safari or Firefox — so the `NOT_A_TRACK` probe in
  [`useDictation.ts`](../../src/web/useDictation.ts) is still necessary and still correct.
- **Safari 18.4 (March 2025)** added WebM, Ogg and PCM recording, where 14.1–18.3 could
  only do MP4/AAC. Our attempt order is unaffected — AAC-in-MP4 stays first because it is
  the one every Safari can also *play* from the Finder, which is the actual goal — but the
  reasoning in [`mic-recording.ts`](../../src/web/mic-recording.ts) rests on a fact that
  has moved once and may move again.

## When to look at this again

Not on a date, on a trigger, and the first one is a task rather than a wait:

- **A second AAC encoder appears.** WebCodecs and `MediaRecorder` currently share one, which
  is why the spike found no escape. Two would make a fallback across APIs meaningful.
- **`extendable-media-recorder` becomes right if the recording constraint changes shape** —
  a cap short enough that WAV fits (roughly 80 seconds at 48 kHz, or 4 minutes resampled to
  16 kHz), or a hard requirement that the file open anywhere, valued above staying small.
- **Dictation reaches a box with an article in scope** — comments, chat — and then
  `SpeechRecognitionPhrase` contextual biasing is worth building against the glossary.
- **Recording stops being Chromium-only.** It is armed only where the session owns a shared
  track, so the day `recognition.start(audioTrack)` ships in WebKit, every platform
  assumption in this document needs re-reading — including which encoder paths exist.

## What this document does not do

Named plainly, because a decision doc that hides its gaps is worse than a short one. It has
no weighted candidate matrix against the stated criteria, no marginal production-bundle
measurement (only a standalone esbuild proxy), no per-library estimate of exactly which
lines would be deleted, and no security or supply-chain review of any candidate beyond
counting dependencies. The bundle and audio numbers here are reproducible in principle —
the commands are in the git history of this file's review — but were not scripted.

The recording spike has now been run and is written up above; what remains missing would
sharpen the reasoning without moving it. One caveat on the spike itself: it used a
synthesised mono track rather than a real microphone, because a `getUserMedia` prompt needs
a human. The failure it reproduces matches the original in signature (`EncodingError` at
382 ms against 307 ms, zero bytes both times), but the confirming run on a real device has
not been done.

## The review

[microphone-library-options-review-sol.md](microphone-library-options-review-sol.md) —
GPT Sol, 2026-08-27, which declined to approve the first draft and was right to. Three
blockers, all three verified here and all three acted on: the WebCodecs reading was wrong
about the spec (though the spike later showed Chrome does not implement what the spec says,
so the conclusion it supported was right anyway), the iPadOS argument was about a browser
this code path cannot reach, and
**the recorder fallback it was defending contained a live event-ordering bug** — a failed
attempt's terminal chunk could land in its replacement's file, because the specification
fires `error` before that chunk arrives and our handler had no generation guard. Fixed, with
three tests, in the same pass.

One recommendation not taken: Sol wanted the opening narrative, the RecordRTC note, and the
field-survey findings cut as padding. The narrative and the RecordRTC note stay — this
repo's docs are for the reasoning as much as the conclusion, and RecordRTC is the case where
our own first criterion argues against the others, which is decision-relevant. The
field-survey material stays where it is rather than moving to an appendix, because two of
its three findings changed the code.
