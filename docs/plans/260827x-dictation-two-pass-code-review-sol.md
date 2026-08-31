Verdict: not ready to land. Seven must-fixes remain. Several of the original nine findings received partial fixes or comments, not complete implementations.

## Findings

1. **Must-fix — stale field/session state can insert into or damage newer text.**

   [`useDictationField.ts:147`](../../src/web/useDictationField.ts) verifies only the dictated substring, not the full value, revision, field identity, or context.

   - On Safari/Firefox, `span` remains `null` until the final transcript, so an external update has no check at all; the transcript is inserted at the old numeric caret.
   - On Chromium, an external update that preserves identical text at the same offsets passes the check.
   - Changing comments clears the follow-up while leaving the hook alive.
   - `where.current` is read at upload time, not captured when the session starts ([useDictation.ts:625](../../src/web/useDictation.ts)).
   - A stale session’s `done()` calls the latest `onEnd` even when `stillOurs()` is false ([useDictation.ts:552](../../src/web/useDictation.ts), [useDictation.ts:618](../../src/web/useDictation.ts)), potentially clearing the new session’s span or committing the wrong field.

   `live.current = value` is reasonable for observing controlled-state changes, but it supplies no revision or identity. It does not solve this race.

2. **Must-fix — provider error bodies can leak private content into logs.**

   [`transcribe.ts:315`](../../src/transcribe.ts) reads the provider body and [`transcribe.ts:321`](../../src/transcribe.ts) logs its first 300 characters. The logging contract explicitly forbids this because a provider may echo request content. Here that content includes voice data, vocabulary, and potentially transcript text.

   The comment claiming this is deliberately safe directly contradicts [`logging.md:373`](../../docs/project/logging.md) and the existing `providerRefused` boundary.

3. **Must-fix — the page-wide microphone lock fails the A→B→C race.**

   [`mic-lock.ts:52`](../../src/web/mic-lock.ts) installs B as holder before B has acquired the microphone. When C arrives, it stops B. B has no track yet, so its `released` resolves immediately; C proceeds without waiting for A’s still-live track. B remains waiting for A and later exits as stale.

   Thus C can call `getUserMedia` while A’s recorder is still draining. The comment that C “queues behind us” is false.

4. **Must-fix — the probe is not proven safe and does not implement the prior review’s requirement.**

   [`probeTrackOverload`](../../src/web/useDictation.ts) calls `start()` and immediately `abort()`, then opens the owned track without awaiting `end`. The current Web Speech algorithm does not guarantee the comment’s claimed “queued task to ask for audio”; `abort()` guarantees disconnection and a later `end`, not synchronous release. [Web Speech API specification](https://webaudio.github.io/web-speech-api/#speechreco-methods)

   The earlier review explicitly required awaiting the terminal event. Also, [`useDictation.ts:829`](../../src/web/useDictation.ts) can still call bare `r.start()` if the track ends before the recogniser’s `onend`, reopening an unowned capture.

5. **Must-fix — deployed article vocabulary uses the wrong storage seam.**

   [`transcribe.ts:37`](../../src/transcribe.ts) imports filesystem-era `loadGlossary` from `src/api.ts`, while production article reads use the owner-filtered store exported at [`store/index.ts:205`](../../src/store/index.ts).

   Under PostgreSQL, glossary lookup therefore normally fails and is silently swallowed, removing the central quality improvement. `transcribe.test.ts` mocks the wrong module and consequently blesses this mistake.

6. **Must-fix — Firefox is advertised as supported but its button does nothing; recorder failure is also silent.**

   `supported` requires only `getUserMedia` and `MediaRecorder` ([useDictation.ts:392](../../src/web/useDictation.ts)), but `start()` returns immediately when no `SpeechRecognition` constructor exists ([useDictation.ts:694](../../src/web/useDictation.ts)). That is Firefox’s path.

   Separately, if every `MediaRecorder` attempt fails, `recordTrack` returns `null`; [`finish` treats that as an ordinary no-recording ending](../../src/web/useDictation.ts), without telling the reader that the authoritative pass never existed.

7. **Must-fix — provider output validation remains incomplete.**

   [`transcribe.ts:333`](../../src/transcribe.ts) accepts the first choice’s `transcript` string without checking:

   - `finish_reason: "length"`
   - refusal fields
   - exactly one choice
   - implausible transcript length relative to audio
   - truncated structured output

   A truncated or answered-in-schema response can therefore replace the field. The test covers only prose that is not JSON. The original finding’s preservation/retry requirement is also absent: failed output keeps the recording only when there were zero live phrases.

8. **Should-fix — unmount cancellation does not work once upload begins.**

   `finish` clears `session.current` before starting the upload ([useDictation.ts:500](../../src/web/useDictation.ts)). Unmount cleanup reads only `session.current` and returns when it is null ([useDictation.ts:977](../../src/web/useDictation.ts)). The response is ignored, but the upload and paid provider call continue.

   A second direct press aborts the upload, but leaves `onEnd` undelivered and field-span state stale. `chooseDevice` during upload merely changes the remembered device. Track `ended` during transcription is harmless because the track has already been released.

9. **Should-fix — route validation and failure handling are still partial.**

   The body cap and `res.on("close")` choice are correct. Remaining gaps:

   - Additional top-level and context properties are accepted despite the “exact shapes” claim.
   - Non-canonical base64 such as `AB==` passes.
   - No decoded-byte or container-signature validation exists.
   - `audio/aac` is incorrectly labelled `"m4a"` by [`formatOf`](../../src/dictation-limits.ts).
   - The server’s “3 MB of audio” message describes the encoded limit; raw audio is about 2.25 MB.
   - Routine disconnect aborts become logged/reported 502 failures.

10. **Should-fix — copy, disclosure, and retry are real gaps.**

   Dictation model failures should use `src/messages.ts`; that file expressly owns reader-facing model-failure copy. In particular, 429 should use `providerHttpFailure`, because the current generic message does not say the service is busy or what to do.

   There is no retry using the retained blob.

   The privacy notice is also incomplete: ProfileBox deliberately hides it visually, while chat and comment provide neither visible copy nor `aria-describedby`. The project doc’s claim that a sentence sits beside every button is false.

   The stated “no client timeout” is outdated: [`dictation-upload.ts:64`](../../src/web/dictation-upload.ts) has a 120-second client timeout.

## Earlier nine findings

| Earlier finding | Result |
|---|---|
| 1. Probe and page-wide ownership | **Not fixed**: ordering changed, but no terminal wait; lock has the three-claim race |
| 2. Tape lifecycle | **Partial**: cap and drain fixed; recorder failure remains silent |
| 3. Field/revision race | **Not fixed**: substring check is insufficient; no field identity/revision |
| 4. Vercel/body caps | **Fixed** |
| 5. Validation, copy, retry | **Partial** |
| 6. Structured output and injection | **Partial**: schema/fencing fixed; terminal/output checks absent |
| 7. Cancellation and timeout | **Partial**: timeout exists; unmount upload cancellation fails |
| 8. Privacy | **Partial**: ZDR fixed; disclosure and provider-body logging are not |
| 9. Measurement claims | **Fixed** |

The plan also miscounts the earlier verdict as seven must-fixes and two should-fixes; the review contains eight must-fixes and one should-fix.

## Test assessment

Important missing coverage: recognition-less Firefox, three lock claimants, probe terminal release, recorder construction failure through the hook, external field mutation, comment change, stale session `onEnd`, unmount during upload, route validation, and provider `finish_reason`/choice/refusal handling.

The Safari probe test’s fake counts `abort()` but cannot prove the microphone disconnected before `getUserMedia`. The vocabulary test mocks the legacy filesystem seam, masking the production-store error.

I could not run Vitest in the read-only sandbox: it attempted to create `node_modules/.vite-temp` and failed with `EPERM`. Direct root and web TypeScript checks passed; the tests project has unrelated existing type errors.