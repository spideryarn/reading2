# GPT Sol on the code — microphone device, timer and recording

`gpt-5.6-sol`, effort high, 2026-08-27, run read-only against the built code rather than the
plan. **This is the review that matters more** — a plan-stage review cannot find a promise
resolving into the wrong session. Two of its findings were things the plan review had already
raised, that I had claimed to fix and had not.

Verbatim, with only the link targets rewritten to be repo-relative from this file.
What was done with each finding is in
[260827k-microphone-device-and-recording.md](260827k-microphone-device-and-recording.md).

---

1. **Blocker — teardown is not a barrier, so rapid restart can overlap microphones and publish stale audio.** [`finish`](../../src/web/useDictation.ts) clears `session.current` before `tape.stop()` settles; meanwhile `chooseDevice` starts immediately, and `toggle` permits restart while the previous stop is pending. The old track therefore remains live while the new capture opens. Worse, the old promise publishes whenever `session.current === null`, so it can publish after a newer session has started and ended. Both recorder fakes call `onstop` synchronously, hiding this race. Use an awaited teardown barrier plus a monotonic generation check. [`tests/dictation-recording.test.ts`](../../tests/dictation-recording.test.ts)

2. **Blocker — permission refusal still falls back to recogniser-owned/default capture.** In [`beginCapture`](../../src/web/useDictation.ts), every non-device-missing `getUserMedia` error sets `track = null`, then calls parameterless `r.start()`. Thus the claim that only `OverconstrainedError`/`NotFoundError` causes fallback is false. The new test checks only that no second `getUserMedia` call occurred; it never checks that recognition was not started. The pre-existing test explicitly expects `started === [null]` after refusal. [`tests/dictation-recording.test.ts`](../../tests/dictation-recording.test.ts) [`tests/dictation-phases.test.ts`](../../tests/dictation-phases.test.ts)

3. **Should-fix — the bounded flush can hand over an unfinalized recording.** [`MicTape.stop`](../../src/web/mic-recording.ts) cannot distinguish `done` from the three-second timeout; after either wins, it builds and returns a blob. If `onstop` never arrived, existing timeslice chunks are presented as complete evidence without the final data. Return `null` when the timeout wins. The synchronous recorder fakes cannot expose this.

4. **Should-fix — the byte “cap” is not a cap.** `ondataavailable` stores the entire chunk before checking `bytes > MAX_BYTES`; the test explicitly blesses a 9 MiB blob against an 8 MiB limit. A delayed `dataavailable` chunk can be arbitrarily larger. Overflow should discard the evidence rather than retain an unbounded or truncated container. [`src/web/mic-recording.ts`](../../src/web/mic-recording.ts) [`tests/mic-recording.test.ts`](../../tests/mic-recording.test.ts)

5. **Should-fix — the timer still diverges after either recording cap.** [`Elapsed`](../../src/web/ProfileBox.tsx) counts until dictation ends, while the tape can stop at five minutes or the byte cap. The shared zero is correct, but after the cap the timer no longer describes recorded audio. No test covers this.

6. **Should-fix — `role="timer"` is hidden from accessibility APIs.** The entire visible strip has `aria-hidden="true"`, so its `Elapsed` descendant is hidden despite `role="timer"`. The persistent status region is correct; only the repeated words/bars/interim should be hidden. [`src/web/ProfileBox.tsx`](../../src/web/ProfileBox.tsx)

7. **Should-fix — retaining a stale preference is defensible, but the UI conflates preference with active device.** After fallback, `deviceId` remains an unavailable ID and becomes the controlled `<select>` value even though no option matches and another track is active. Keep the preference if desired, but track the active device separately or render an explicit “unavailable; using default” option. [`src/web/useDictation.ts`](../../src/web/useDictation.ts) [`src/web/ProfileBox.tsx`](../../src/web/ProfileBox.tsx)

No edits made. Biome passed all eight reviewed source/test files, and the web TypeScript project passed. Focused Vitest execution was blocked by the read-only environment because Vite attempted to write `node_modules/.vite-temp`.