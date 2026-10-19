Review the plan docs/plans/261019m-dictation-records-from-the-first-word-and-a-preview-everywhere.md before it is built. Read-only: do not edit any file.

Context: docs/project/dictation.md (long; read § It transcribes twice, § One capture, § What the reader sees in the gap, § The sizes, § The ways it fails), src/web/useDictation.ts (start(), armTape, the recogniser handlers onaudiostart/onend, beginCapture, stop()), src/web/mic-recording.ts (recordTrack, MIN_MS, PART_MS), src/web/DictationStrip.tsx (dictationWords, the interim span), src/web/transcriber.ts, src/web/dictation-upload.ts, src/transcribe.ts, tests/dictation-phases.test.ts, tools/fleet/web/src/DictationControl.tsx.

Questions:
1. Stage 1: is the diagnosis right (Chromium tape armed only at the recogniser's audiostart, ~1.1s after the track is live)? Is arming the tape at track-ownership safe on every path (mic-lock, device fallback listInputs await, stop during opening, the keeper/IndexedDB copy, cap timer endsAt, quiet warning, double-press Stop, recogniser restart, liveGaveUp before audiostart)? Anything else that delays the tape that the plan misses?
2. Stage 2: is a second MediaRecorder on the same track, in 5-second segments sent through the existing transcribe seam, a sound simplest preview? Risks: WebKit/iOS, server floor MIN_AUDIO_BASE64 / MIN_MS, spend attribution, aborts, out-of-order results, mic-lock, the keeper, Sentry noise, the fleet dashboard. Is it honestly not a new data flow given DICTATION_PROMISE and privacy.md § Where a reader's voice goes?
3. Anything simpler that gets the same outcome.

Write findings, numbered F1.., each with severity (high/medium/low), the file:line evidence, and the change you recommend. End with a one-line verdict.
