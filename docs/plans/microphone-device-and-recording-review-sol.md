# GPT Sol on the plan — microphone device, timer and recording

`gpt-5.6-sol`, effort high, 2026-08-27, run read-only against the plan and the code it
proposed to change. Verbatim, with only the link targets rewritten to be repo-relative from
this file (Codex writes them as absolute paths with line numbers, which
[tests/doc-links.test.ts](../../tests/doc-links.test.ts) rejects).

What was done with each finding is in
[microphone-device-and-recording.md](microphone-device-and-recording.md).

---

The plan is not ready to build. Three blockers remain.

1. **Blocker — Recorder finalization is incompatible with the current session teardown unless its ordering is specified.** [`useDictation.ts`](../../src/web/useDictation.ts) currently marks the session finished and stops its track synchronously. `MediaRecorder.stop()` delivers the final `dataavailable` and `stop` events asynchronously; an ended track also stops the recorder asynchronously. A correct design must cover:

   - stop → late recognition result → recognition `onend` → recorder `dataavailable` → recorder `stop`;
   - track `ended`, where both the existing handler and recorder react;
   - unmount while recorder events remain queued;
   - rapid stop/start, where the old recorder finishes after the new session exists;
   - the old five-minute timer firing after a replacement session starts.

   The recorder, chunks, cap timer, confirmed count, and a unique generation must belong to `Session`. Recorder callbacks must not be discarded merely because `s.finished` is true, but must never publish or stop anything belonging to a newer session. Stop the recorder before stopping the track, and publish a blob only after its `stop` event. The current tests in [`dictation-phases.test.ts`](../../tests/dictation-phases.test.ts) exercise none of this. The required recorder event ordering comes from the [MediaStream Recording specification](https://www.w3.org/TR/mediastream-recording/).

2. **Blocker — The retention predicate contradicts itself.** The plan says both “dropped the moment a dictation succeeds” and “offered on any error ending regardless.” Consider: confirmed text arrives, then `network` fires. If “success” means the first confirmed result, the recording is already gone; if success is decided only at termination, every successful dictation is retained throughout the session. Likewise, stop can produce a final result after the button has gone idle, as [`useDictation.ts`](../../src/web/useDictation.ts) and its regression test deliberately allow. Define one terminal predicate over the session’s final confirmed count and terminal cause. Do not derive it from React state or decide it before recognition `onend`.

3. **Blocker — The device preference cannot currently be guaranteed, and Safari cannot honor it at all.** On the no-track-overload path, `beginCapture()` starts recognition immediately and never calls `getUserMedia`; there is therefore no selectable track, device label, or way to apply `{deviceId:{exact}}`. On Chromium, the existing `getUserMedia` catch silently calls `r.start()` on every failure, which would also abandon an explicit selection and use the browser default. Refactor that distinction:

   - Hide the device picker on the recogniser-owned/Safari path.
   - Fall back only for `OverconstrainedError`.
   - Do not turn permission denial or another capture failure into an undisclosed default-device start.
   - Always report the label/settings of the track actually handed to recognition.

   Otherwise the UI can say a device was chosen while transcribing another—the exact failure this work exists to fix.

4. **Should-fix — The timer’s claimed zero is wrong once MediaRecorder exists.** `getUserMedia` returns an already-live track before `recognition.start(track)` and `audiostart`; a recorder started when that track reaches the hook will capture the 1.1-second “opening” interval. Therefore “nothing is being captured” is no longer true, and the downloaded file will be longer than the displayed timer. Either start both recorder and timer at `audiostart`, or use the recorder’s own `start` event as zero. Also, after the five-minute cap, a continuing timer cannot still represent “recording.”

5. **Should-fix — Cut the recording/download feature from this round.** “No confirmed text” includes an immediate cancel, speech that remained interim, an ordinary pause, and recognition failure—not merely diagnostic failures. The resulting voice blob then remains in memory indefinitely while the page stays mounted, unless another dictation succeeds. The device label and picker directly fix the observed incident; a saved file of digital silence adds little while introducing the most dangerous lifecycle, privacy, format, and UI work in the plan. I would ship the device correction and stop glyph first. The timer is also expendable for this two-sentence input.

6. **Should-fix — If recording remains, its evidence and retention contract is incomplete.** Never offer a download unless recorder startup succeeded, no recorder error occurred, finalization completed, and the combined blob is non-empty. Provide an explicit Discard action or short expiry; “eventually unmount or dictate successfully” is not a reader-controlled deletion mechanism. After the five-minute cap, say “Save the first five minutes,” not “Save the recording.” Revoke every object URL on replacement, discard, and unmount.

7. **Should-fix — Treat a stored device ID as a hint with explicit recovery.** Device IDs are origin-scoped and can rotate when permission/storage circumstances change; labels and the full list may be unavailable before successful capture. The plan’s quiet-line placement does conveniently enumerate after capture, when labels should be available, but it still needs to:

   - clear or replace a stale preference after fallback, rather than retry it forever;
   - refresh an open picker on `devicechange`;
   - retain the current track until it ends—never silently hot-switch;
   - make a choice during dictation explicitly “for next time,” or disable changing until stopped;
   - surface permission revocation instead of treating it as device absence.

   These behaviors follow the [Media Capture and Streams device model](https://www.w3.org/TR/mediacapture-streams/).

8. **Should-fix — “No sound from [device]” repeats the diagnosis the previous round rejected.** `quiet` in [`useAudioLevel.ts`](../../src/web/useAudioLevel.ts) means no reading exceeded −55 dBFS for ten seconds. It does not mean zero samples: a thinking reader, quiet room, or noise-gated headset can trigger it. [`microphone-level-meter.md`](microphone-level-meter.md) explicitly kept this observation neutral. Use “No sound detected yet · Microsoft Teams Audio Device · Change,” preserving the useful device identity without converting a threshold into a fact.

9. **Should-fix — The accessibility direction is right, but the better shape is a persistent status plus a non-live timer.** Keep only the phase/error sentence in a persistent `role="status" aria-atomic="true"` node; do not mount and remove the live region with the strip. The current terminal error paragraph in [`ProfileBox.tsx`](../../src/web/ProfileBox.tsx) is not live, so the status disappearing on error may leave a screen-reader user with silence. Give the visual counter `role="timer"` rather than `aria-hidden`; that role is exposed but implicitly non-live. Keep interim text outside the status, with `aria-live="off"` or `aria-hidden`. WAI-ARIA defines `status` as polite/atomic and [`timer` as live-off](https://www.w3.org/TR/wai-aria/#timer).

10. **Should-fix — The format and memory “cap” are measurements, not guarantees.** Your Chrome 151 AAC/MP4 and Opus/MP4 findings are credible as measured, and excluding bare `audio/mp4` is sensible for this target. But `isTypeSupported()` does not guarantee a concrete recording will succeed, and `audioBitsPerSecond` is an encoder hint that may be exceeded. Therefore 1.7 MB is not a real bound. Enforce both elapsed time and accumulated bytes, handle asynchronous recorder errors, and derive the extension from the actual completed blob/recorder MIME type. The specification also guarantees playability only for the combined blobs from a completed recording, not individual chunks.

The zero-RMS experiment itself looks sound: the nonzero built-in-microphone control rules out the hidden-frame/analyser failure from the previous round. The three-consumer result is also valid evidence for Chrome 151; it just does not remove the lifecycle problems above.