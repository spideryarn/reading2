# Verdict

Do not approve this document as written.

“No library” is probably right for device selection, metering, and dictation. It has not been established for recording. The WebCodecs argument is materially wrong, the iPadOS argument examines a browser that cannot reach the recording path, and the current recorder fallback contains an event-order race.

My practical recommendation:

- Keep the first three areas custom.
- Change recording from “rejected” to “Mediabunny spike required.”
- If the spike succeeds, Mediabunny is the library I would adopt—preferably lazy-loaded.
- Fix the recorder race immediately if the custom implementation remains.
- Use the action-button accessibility pattern, or remove the moving `title`; the current hybrid is not clean.

## Blockers

### 1. The WebCodecs reading is wrong

The spec does not leave `isConfigSupported()` free to check only the codec string. It says `true` is returned only if the user agent can support **all entries of the config**, including defaults. It qualifies that as a best-effort, time-of-query answer because hardware and resources can change. That makes it a capability query, not merely argument validation. [WebCodecs §7.1](https://www.w3.org/TR/webcodecs/#check-configuration-support)

The WPT description is also incomplete. The same file contains `validButUnsupportedConfigs` and asserts that `support.supported` is false for unsupported sample rates, channel counts and codec forms. It is not limited to `TypeError` tests for nonsense. [Current WPT audio encoder config tests](https://chromium.googlesource.com/external/w3c/web-platform-tests/+/master/webcodecs/audio-encoder-config.https.any.js)

What remains true:

- WPT does not test AAC at 32 kbps.
- `isConfigSupported()` does not guarantee that every subsequent frame will encode.
- Resource loss and encoder defects can still cause runtime `EncodingError`.
- A runtime error path is still required.

The accurate conclusion is therefore:

> WebCodecs provides a materially stronger, configuration-sensitive best-effort probe, but successful encoding must still be verified at runtime.

“Exactly as implementation-defined as `MediaRecorder.isTypeSupported()`” is false. `MediaRecorder.isTypeSupported()` cannot even inspect bitrate; WebCodecs explicitly can.

Most importantly, the MediaRecorder failure cannot be projected onto WebCodecs without testing it. They are different APIs and potentially different encoder paths. The missing decisive experiment is:

```js
await AudioEncoder.isConfigSupported({
  codec: "mp4a.40.2",
  sampleRate: 48000,
  numberOfChannels: 1,
  bitrate: 32000,
})
```

followed by an actual short encode and MP4 finalization on the affected machine.

### 2. The iPadOS rejection criterion is irrelevant to this code path

Recording is armed only when `useDictation` owns a shared track: [useDictation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useDictation.ts:704). Browsers without `recognition.start(audioTrack)` return `track: null`, so no recording starts: [useDictation.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useDictation.ts:775).

The document itself says that overload is Chromium 135+ only. Therefore Safari/iPadOS does not reach `recordTrack` today. “AudioEncoder is only a year old on iPadOS” and “revisit when iPadOS has a few more years” are padding, not decision evidence.

The relevant platform is recent Chromium, where `AudioEncoder` has existed since Chrome 94.

### 3. The supposedly fixed recorder fallback contradicts the MediaRecorder event order

At [mic-recording.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/mic-recording.ts:310), `onerror` checks `bytes === 0` and immediately starts another recorder.

But the recording specification requires the failure sequence:

1. `error`
2. terminal `dataavailable` containing collected data
3. `stop`

[MediaStream Recording error handling](https://www.w3.org/TR/mediastream-recording/#error-handling)

Consequences:

- At `onerror`, `bytes === 0` does not prove the failed attempt collected no data; its terminal blob has not arrived yet.
- The next recorder begins before the old recorder’s terminal events.
- The old `ondataavailable` handler does not check `rec === next`.
- Late AAC bytes can therefore be appended to the new WebM attempt, producing a mixed, corrupt blob.
- Those late bytes can also prevent the next retry because shared `bytes` is no longer zero.

The fake’s `fail()` calls only `onerror`: [mic-recording.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/mic-recording.test.ts:69). It does not model the mandated terminal `dataavailable` and `stop`, so the tests certify the wrong event model.

There is a second smaller hole: if the next attempt fails synchronously to construct or start, the asynchronous fallback calls `begin()` once and gives up instead of continuing through later attempts.

## The strongest library case

Mediabunny is the serious opposite case. It specifically buys:

- `MediaStreamAudioTrackSource`, which accepts the already-owned track—no second capture.
- AAC encoding plus MP4 muxing.
- A typed `canEncodeAudio()` query accepting bitrate, sample rate and channel count.
- Explicit asynchronous error propagation through `errorPromise`.
- Defined start/finalize/cancel lifecycle.
- Resampling and channel transforms.
- Zero dependencies.

Those are not speculative capabilities; they are documented APIs. [Mediabunny live audio source](https://mediabunny.dev/api/MediaStreamAudioTrackSource), [AAC microphone-to-MP4 example](https://mediabunny.dev/guide/writing-media-files), [configuration-aware `canEncodeAudio`](https://mediabunny.dev/api/canEncodeAudio)

It would not remove device selection, metering, the shared-track probe, time/byte caps, minimum duration or evidence semantics. It could remove most codec negotiation, muxing, chunk/event-order handling and container-specific tests.

The counterarguments are real:

- It is young under the project’s pretraining-data criterion.
- 42.5 KB gzip is substantial for a narrow recovery feature.
- Runtime failure handling still exists.
- Its MPL-2.0 licence needs recording in the decision.
- The exact cap/finalization integration needs proving.

That supports a bounded spike, not categorical rejection. Test the exact 32 kbps AAC configuration, zero-output/error behavior, five-minute memory, final Finder-openable file, and marginal production bundle. If it passes, I would prefer Mediabunny over maintaining this event choreography.

## Number audit

The WAV arithmetic is right under the stated assumptions, but the units and comparison are sloppy:

| Quantity | Correct value |
|---|---:|
| 48 kHz × 16-bit × mono | 96,000 B/s |
| In IEC units | 93.75 KiB/s |
| 8 MiB cap | 87.38 seconds |
| Five minutes | 28.8 MB or 27.47 MiB |
| 32 kbps for five minutes | 1.20 MB or 1.144 MiB |
| Nominal ratio | 24× |

Problems:

- The code cap is 8 MiB, not 8 MB.
- “94 KB/s” and “27.5 MB” are actually KiB/MiB values.
- “Measured rather than estimated” is false for this bullet; it is arithmetic unless an actual WAV was inspected.
- You have not shown that the library output on the target track is mono, 16-bit, 48 kHz. The library uses the stream’s sample rate and documents resampling through an `AudioContext`. [Extendable Media Recorder sample-rate guidance](https://github.com/chrisguttandin/extendable-media-recorder#setting-the-sample-rate)
- “24× what we produce now” compares WAV against a nominal fallback, not the preferred current path.

Your own Opus measurement was 13,971 bytes in 2.5 seconds: 5,588 B/s, or roughly 1.60 MiB over five minutes—not 1.14 MiB. That makes WAV about 17× that measured output. The preferred AAC path reportedly produces about 14 KB/s, making WAV roughly 7× it.

The size rejection may survive, because WAV still violates the simultaneous five-minute/8 MiB requirements. But “27 MB or 87 seconds” is a false binary: resampling, changing the cap, or accepting a larger local-only recovery file are alternatives that were not evaluated.

### Bundle figures

Gzipped minified bytes are a legitimate transfer-size metric. They are not “the honest shipped cost” by themselves.

The honest measurement is the marginal delta in the actual Vite production build, including:

- gzip and Brotli;
- initial route versus lazy chunk;
- uncompressed parse/compile size;
- exact entry file and import list;
- package version and lockfile;
- the code removed from the existing bundle;
- runtime CPU and memory.

A standalone esbuild entry is a useful proxy. Without its source and command, 43.7/42.5 KB are not reproducible evidence.

Also test a dynamic import. This feature is reached only after microphone activation, so charging every page load the full static-import cost is not inevitable.

### Line counts

The table needs its counting method. `scc` reports these six files as approximately:

- 703 code
- 985 comments
- 76 blank

That differs substantially from 845/919. More importantly, source lines are not a valid dependency decision metric.

The core claim—“a library removes none of the measured knowledge”—is rationalisation. It confuses two categories:

- Product knowledge that remains: one capture, exact device choice, measured meter floor, caps, minimum duration.
- Implementation knowledge that a library can absorb: recorder event ordering, chunk finalization, codec configuration, muxing and container behavior.

The second category can and should disappear from local code and comments when a dependency owns it. Keep the requirements in a short design note and acceptance tests; delete implementation archaeology that is no longer applicable. Comments are also maintenance surface, not free knowledge.

## Accessibility change

Both APG patterns are valid:

- Stable name plus `aria-pressed`.
- Moving action name without `aria-pressed`.

The APG explicitly describes both. [WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)

The current change correctly fixes the illegal mixture in the accessible **name**, but then recreates a mixture through `title`. When `aria-label` supplies the name, HTML AAM uses an otherwise-unused `title` as the accessible description. Some screen readers may therefore expose:

> Dictate, toggle button, pressed, Stop dictating

`aria-label` outranking `title` for the name does not make `title` inaccessible. [HTML accessible-description computation](https://w3c.github.io/html-aam/#accessible-description-computation)

Given that the icon and tooltip already represent the next action, I would use the action-button model:

```tsx
aria-label={armed ? "Stop dictating" : "Start dictating"}
title={armed ? "Stop dictating" : "Start dictating"}
// no aria-pressed
```

If stable voice control is considered more important, keep `aria-label="Dictate"` and `aria-pressed`, but remove or stabilize `title`. Do not keep the current hybrid without real VoiceOver/NVDA testing.

The voice-control argument is overstated:

- “The same four words” is unexplained; the accessible name is one word.
- Voice control does use control names, but changing action names is normal for play/pause controls.
- A visible tooltip differing from the accessible name can itself confuse voice users; Apple advises aligning Voice Control labels with visible text. [Apple Voice Control criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/voice-control-evaluation-criteria/)

The new test only checks raw attributes and explicitly pins the questionable moving `title`. It does not test the computed accessible description or an accessibility tree. Its 27-line essay and the 19-line component comment are padding; the decision belongs in the document, with a one-line implementation comment.

## Other factual problems and missing evidence

- `react-speech-recognition` exposes the underlying recognizer through `getRecognition()`. Its high-level `startListening()` does not accept a track, so rejection may still be right, but “a wrapper that owns the recognizer cannot express it” was not actually tested. [Official API](https://github.com/JamesBrill/react-speech-recognition/blob/master/docs/API.md)
- Its “types: no” entry is misleading: maintained DefinitelyTyped declarations exist. Use “bundled / DefinitelyTyped / none.” [`@types/react-speech-recognition`](https://www.npmjs.com/package/@types/react-speech-recognition)
- “There is no library” is an indefensible negative universal. Say “the survey found no credible package.”
- “No prior art” does not establish that the write-up is original or that no fix exists.
- Weekly npm downloads are not evidence of a long-lasting community. Include release history, dependents, contributors, bus factor, docs/examples, issue responsiveness and Stack Overflow footprint.
- “Some years on iPadOS” is not an actionable revisit trigger. Define a browser-support threshold or target matrix.

The decision document needs:

1. An explicit browser/path reachability matrix.
2. Required versus optional behavior and quantified budgets.
3. A weighted candidate matrix against the stated selection criteria.
4. Reproducible bundle and audio measurements.
5. A deletion estimate showing exactly what each library replaces.
6. A direct Mediabunny proof against the actual AAC/32 kbps failure.
7. Runtime fallback and degradation policy.
8. Security, licence and maintenance risks.
9. Primary-source citations for every compatibility or API claim.
10. Concrete revisit thresholds.

The opening narrative, much of the RecordRTC detour, the “original write-up” claim, contextual biasing, and iOS warm-up material are padding in a library decision. Move field-survey findings to an appendix.

Verification note: `git diff --check` passed. I could not run Vitest because this read-only environment prevented Vite from creating its temporary config file. Direct TypeScript checking reached unrelated pre-existing test errors before the scoped files could be certified.