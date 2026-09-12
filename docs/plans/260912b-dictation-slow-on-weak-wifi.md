# Dictation is slow on a weak connection — where the time goes

> Using the voice mode works quite well to dictate, like, a message, like in the feedback dialog, but
> it's quite slow. I'm on an iPad on a not very good Wi-Fi. I don't know where that slowness is. Is it
> the transcription? I wonder if it's the upload. Is there any way in which we could upload something
> more compressed, or I don't know, try running some spikes to measure this on a slow internet
> connection and see if you can figure out where the slowness is and then improve it so that voice
> dictation feels much snappier.
>
> — Greg, 2026-09-12, from the Feedback dialog on an iPad (SPIDERYARN-READING2-39)

**Status: measuring.** The feedback note is
[260912_0818-dictation-slow-on-weak-wifi.md](../user-feedback/260912_0818-dictation-slow-on-weak-wifi.md).

## The question, and the order it asks for things

Greg asked for measurement before a fix, and said which way round: *is it the transcription, or is
it the upload?* A smaller upload is his hypothesis, not a finding. So this plan measures every leg of
a dictation separately before choosing anything, and the fix is whichever leg the numbers blame.

## What happens between pressing stop and the words arriving

On an iPad there is no live recogniser ([dictation.md § One capture](../project/dictation.md#one-capture-and-it-is-always-ours)),
so pressing stop goes straight to the tape. Four legs, paid in this order, none overlapping:

```
 stop ─▶ 1. recorder flushes ─▶ 2. blob → base64 → JSON ─▶ 3. upload to Vercel ─┐
                                   (in the browser)          (the reader's Wi-Fi) │
                                                                                  ▼
 words ◀── 6. response ◀── 5. OpenRouter → gpt-transcribe ◀── 4. vocabulary read
            (small)            (box/datacentre to OpenAI)       (Supabase, ≤1.5 s)
```

- **Legs 1–3 are on the reader's device and link**, and their cost scales with the size of the
  recording. Leg 3 is the one a weak Wi-Fi makes slow, and nothing else here gets slower on it.
- **Legs 4–5 are server-side** and do not care what the reader's connection is like.
- **Nothing streams.** OpenRouter's transcription endpoint documents no `stream` parameter (its API
  reference, read 2026-09-12), so time-to-first-token from the transcriber *is* its time-to-answer on
  this route. That rules out one whole family of fix before any measuring.

## How it was measured

[`scripts/spike-dictation-latency.ts`](../../scripts/spike-dictation-latency.ts), on the box:

- **Leg 1–2, the recording.** Headless Chrome, the real `MediaRecorder`, fed from Web Audio (the box
  has no microphone and Chrome's fake device does not work headless — the same workaround as
  [`spike-dictation-browser.ts`](../../scripts/spike-dictation-browser.ts)). Four committed clips
  back to back, mono, 48 kHz — about half a minute, an ordinary dictation. Eight recorders listen to
  **one** playthrough, so every row heard identical audio.
- **Leg 3, the upload.** The app's own JSON body POSTed from the page to a local sink, under Chrome's
  network throttling at four profiles. The sink answers the moment it has read the body, so the
  number is the wire and nothing else.
- **Leg 4, the vocabulary** — `vocabularyTermsFor`, timed.
- **Leg 5, the transcriber** — `transcribeWith`, the request path's own function, per encoding, with
  a fixed keyword list, twice each, scored for word error rate and hard terms against the clips'
  reference text.

What it cannot see: **an iPad's encoder** (Safari's AAC is Apple's, not Chrome's), real Wi-Fi's packet
loss rather than a clean throttle, and production's own timings — this pool account has no Vercel or
Sentry sign-in and this box has no production database credential, so the `dictation transcribed`
log line and the `ai_calls.duration_ms` column that would answer leg 4–5 from real traffic were out
of reach.

## What it found

### What an iPad records — from WebKit's source, because the box cannot run Safari

This is the part of the answer the spike cannot measure, so it was read instead (WebKit `main`,
fetched 2026-09-12; a research subagent, quotes checked against the files):

- **With no `audioBitsPerSecond`, Safari records at 192 kbps.**
  `Source/WebCore/platform/mediarecorder/MediaRecorderPrivate.cpp` declares
  `constexpr unsigned LargeAudioBitRate = 192000;`, and `computeBitRates` returns
  `options.audioBitsPerSecond.value_or(LargeAudioBitRate)`. `mic-recording.ts` asks for AAC-in-MP4
  **with no hint, on purpose** (the hint is what made *Chrome's* AAC encoder throw on 2026-08-27), so
  every iPad dictation is 192 kbps: **~24 KB/s, ~1.4 MB a minute** — for a voice, where 24–32 kbps is
  plenty.
- **A hint is honoured.** It goes straight to Core Audio as `kAudioConverterEncodeBitRate`
  (`MediaRecorderPrivateEncoder.cpp`, `AudioSampleBufferConverter.mm`); a value Core Audio refuses
  falls back to the default *silently*. An older WebKit change (r265328, 2020) limited AAC to 128k,
  192k or 256k — when that was lifted is not confirmed, so an older iPadOS may round a low hint back
  up.
- **Safari 18.4+ records Opus in WebM** (WebKit's 18.4 release notes), and its Opus default takes the
  same 192 kbps path — so switching container without a bitrate would save nothing.

**A second consequence, found on the way.** `MAX_BYTES` in `mic-recording.ts` is 2.1 MB, and its
comment says it "bites at about two and a half minutes" — at Chrome's ~14 KB/s. At an iPad's 24 KB/s
it bites at **about 87 seconds**, and hitting it ends the dictation. Nobody has reported it; nobody
had worked out that the iPad is the heavy one.

### The legs, measured

`scripts/spike-dictation-latency.ts`, 2026-09-12, 41.2 s of speech; the full output is
[`evals/dictation/results-latency.json`](../../evals/dictation/results-latency.json).

**It is the upload, by about five to one.** The same 41 seconds of speech, recorded at an iPad's
rate and at a speech rate, as the app's own JSON body:

| profile (up, latency) | iPad-sized, 192 kbps — 1,292 KB | Opus 32 kbps — 203 KB | Opus 24 kbps — 154 KB |
|---|---|---|---|
| unthrottled | 0.19 s | 0.04 s | 0.02 s |
| weak Wi-Fi (1 Mbps, 150 ms) | **10.80 s** | 1.84 s | 1.43 s |
| DevTools Fast 3G (750 kbps, 562 ms) | **14.75 s** | 2.80 s | 2.27 s |

Against which the **transcriber takes 1.6–2.7 s** for the same 41 seconds, at every bitrate —
**including the iPad-sized file, at 2.00 and 2.05 s**, so a big recording costs nothing extra once it
has left the reader's device — and the
**vocabulary 66 ms cold, 3 ms warm** (locally — production reads Supabase from Vercel and was not
measurable from here). The throttle is doing what it says: 154 KB over 125 KB/s is 1.23 s, plus the
latency, against 1.43 s measured.

- **Recording size is the whole lever.** A dictation's upload scales with bytes, and an iPad sends
  ~6.5× the bytes it needs to.
- **Base64 is a second, smaller one.** The same iPad-sized recording as a raw body took 8.10 s rather
  than 10.80 s — the third that base64 adds, exactly. Worth having, but after the first.
- **A low bitrate costs nothing measurable in accuracy.** Opus at 16, 24 and 32 kbps all transcribed
  word-perfect (0.0% WER, 21/21 hard terms). That 0.0% was checked rather than believed: the 16 kbps
  transcript differs from the reference by two commas, which the scorer normalises away, and the
  script now refuses to run unless a wrong transcript scores badly. **Synthetic voices in a silent
  room** — a real room is the caveat, and the reason not to go to 16.
- **Headless Chrome on Linux has no AAC encoder at all**: the four AAC rows report "not supported".
  So the box cannot produce the app's first-choice container, and the iPad-sized row is Opus at
  192 kbps standing in for Safari's AAC by *size*, which is all the upload leg reads.
- **The encode is not the problem.** Base64 of the iPad-sized recording took 113 ms in desktop
  Chrome; an iPad is slower but not by the seconds the upload costs.

## What to change, and the version passed over

**Ask for a speech bitrate on the engine that honours one, and keep the container.** In
`mic-recording.ts`, the AAC-in-MP4 attempt carries `audioBitsPerSecond: 48_000` **on WebKit only** —
`navigator.vendor === "Apple Computer, Inc."`, which Safari and every browser on an iPad or iPhone
report and Chromium does not (`"Google Inc."`). An iPad goes from ~24 KB/s to ~6 KB/s, and a
30-second dictation's upload on the weak-Wi-Fi profile from ~8 s to ~2 s. Chrome is untouched.

Why an engine check rather than a hint everywhere: **Chromium's AAC encoder throws on a hint** and
nothing can ask it first (the `ATTEMPTS` comment has the measurements), and the ladder's recovery
starts the next recorder ~380 ms later — which eats the reader's first word. So a hint may only go
where the encoder is known to take it, and WebKit's source says it does (it hands the value to Core
Audio, and a refused value falls back rather than throwing).

**A positive WebKit check, not "not Chromium" — and not a reuse of the check `useDictation` already
has.** The first draft of this plan moved `probeIsSafe()`'s `Chromium`-brand test here to avoid two
engine checks. It would have been the wrong way round: that test is built so its mistake is harmless
*for the probe* — a Chromium it fails to recognise merely skips a question. Reused for the hint, the
same mistake sends a hint to a Chromium AAC encoder, which throws, and the reader loses their first
word. For the hint the harmless default is *no hint* (today's behaviour), so the predicate has to say
yes only to what it positively recognises. Two predicates, because they fail in opposite directions;
and `useDictation` and the fleet's pinned import list stay untouched. Firefox has no AAC recording
and never reaches the attempt either way.

Why 48 kbps: AAC-LC needs a little more than Opus for the same speech, and a value Core Audio refuses
does not fail — it falls back to 192 kbps silently. 48k is a common rate; 32k was tempting and is
more likely to be the value that quietly does nothing. **Whether it is taken is not measurable from
the box**, which is why stage 2 also makes production say so (below).

**The simpler option passed over — Opus/WebM first, everywhere.** A one-line reorder of `ATTEMPTS`,
engine-agnostic, and a bigger win: Chrome 14 → 4 KB/s as well, iPads on 18.4+ 24 → 4 KB/s. It is not
taken because it quietly reverses a decision Greg made on 2026-08-27: when a dictation *fails*, the app
offers the recording as a download, and AAC `.m4a` is first so that file opens on a Mac with a
double-click — `.webm` does not, nor in an iPad's Files app. The failure file is rare and the upload is
every dictation, so the reorder may well be the right trade; **but it is Greg's trade**, and it is put
to him in the feedback note as one question rather than made here. Fable's arbitration, 2026-09-12.

**Stage 3, if stage 2 lands cleanly — send the recording as the body, not as base64 in JSON.** A third
off every upload on every engine (8.10 s against 10.80 s for the iPad-sized row). It changes the
route's contract — the format and the context move to the query string, `readBody` gains a raw
sibling — so it is its own stage with its own review, and it can be dropped without undoing stage 2.

**Deferred, and named so nobody re-derives it:**

- **Upload while the reader is still talking.** `MediaRecorder`'s one-second chunks could stream to
  the server as they arrive, hiding the upload behind the speech entirely — the only change that makes
  the upload ~0 on *any* link. It needs a chunked endpoint and an ordering story, and the transcriber
  still cannot start before the last chunk. The harder version of this whole plan, not the afternoon.
- **Lower than 32 kbps.** 16 kbps Opus was word-perfect on synthetic speech; a real room is the
  reason not to bank that yet.
- **The transcriber's own ~2 s.** It does not stream on this route and is unchanged by bitrate; the
  lever there is a different endpoint, not a smaller file.

## Stages

1. **The measurement** — `scripts/spike-dictation-latency.ts`, its results file, this plan. Done.
2. **The bitrate hint, and production saying whether it was taken.**
   - `mic-recording.ts`: a new `takesAacBitrate()` — WebKit, recognised positively by
     `navigator.vendor` — and `supportedAttempts` puts the hint on the AAC attempt when it says yes.
     `useDictation` is not touched. Red-first tests in `tests/mic-recording.test.ts`.
   - **The achieved rate, logged.** OpenRouter's transcription reply carries `usage.seconds` — the
     provider's own measure of the audio's length — so `openRouterTranscription` returns it and the
     `dictation transcribed` line logs `format`, `audioKb`, `audioSeconds` and `kbps`. No client or
     route change. After a deploy, one iPad dictation and a Vercel log search answer whether the hint
     was honoured: ~48 means yes, ~192 means Core Audio refused it, ~128 means an older WebKit
     clamped it.
   - `dictation.md § The sizes`, and the `MAX_BYTES` comment, which says the cap "bites at about two
     and a half minutes" and is at ~87 seconds on an iPad today.
   **Built.** `takesAacBitrate()` and `WEBKIT_AAC_BPS` in `mic-recording.ts`; `seconds` on
   `TranscriptionCall`; `format`, `audioSeconds` and `kbps` on the log line. Red first: the three
   WebKit tests failed before the change (`takesAacBitrate is not a function`, the hint `undefined`).
   Mutated after: forcing `takesAacBitrate()` to `true` reds three tests including the older Chromium
   one, and forcing `seconds` to `null` reds its test. **`usage.seconds` is real** — one dictation
   through `scripts/spike-dictation-browser.ts` logged `"audioSeconds":9,"kbps":127` for an
   8.8-second clip (that script asks Chrome for bare `audio/mp4` with no hint, hence 127). It looks
   rounded to whole seconds, so `kbps` is a few per cent out on a short clip — enough to tell 48
   from 192, which is all it is for.
3. **The raw body** — see above; reviewed on its own.

Each stage ends with GPT Sol's code review, `npm test` and `npm run typecheck`.

## Open questions for Greg

- **Opus/WebM first on every browser?** Roughly 3.5× smaller uploads on Chrome and on iPads running
  18.4 or later, at the price of a failed dictation's saved file being `.webm`, which a Mac and an
  iPad will not open with a double-click. Not built; one line if yes.
- **One iPad dictation after the next deploy**, so the log says whether the hint was honoured. The box
  cannot run Safari, so this is the only way the stage-2 claim gets measured rather than read from
  source.
