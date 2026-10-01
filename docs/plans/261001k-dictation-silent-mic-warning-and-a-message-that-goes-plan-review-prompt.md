# Plan review: 261001k

You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React, Vite).

Read the plan: docs/plans/261001k-dictation-silent-mic-warning-and-a-message-that-goes.md

Then check it against the code: src/web/useDictation.ts (error, recording, clearRecording, retry,
the [mic-silent] endings, the keeper `held`/forgetHeld), src/web/useDictationField.ts,
src/web/DictationStrip.tsx, src/web/FeedbackDialog.tsx (discard, send, the close path, the keeper
only-while-open), src/web/useAudioLevel.ts and src/web/audio-level.ts (the quiet signal and why it is
mild), and docs/project/dictation.md.

Questions I most want answered:
1. Is `dismiss()` on `discard(false)` the right moment? Does `forgetHeld` (deleting the device copy)
   after a successful send lose anything a reader would want — e.g. the audio of a failed,
   retryable transcription whose words the reader typed by hand instead? Should dismiss release
   rather than forget?
2. Can `dismiss()` race anything: a retry in flight, a dictation started between send and its
   response, the keeper offering a recovered recording on reopen ([mic-recovered])?
3. Is clearing the error in clearRecording safe for every error that can sit beside a recording?
4. The chime: any problem with playing a Web Audio tone while getUserMedia + MediaRecorder are
   running (Safari/iOS audio session, AudioContext autoplay policy, echo cancellation, the tone
   landing in the transcript)? Is the rising-edge rule right?
5. Anything the plan claims that the code does not bear out.

Write findings numbered, each with severity (P0/P1/P2), file:line evidence, and a suggested fix.
End with a one-line verdict.
