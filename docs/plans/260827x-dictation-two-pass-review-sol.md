# GPT Sol's review of the two-pass dictation plan

> **How this file got here.** `run-codex.ts` reported *"exited 0 but wrote no answer — which is
> what running out of credit mid-run looks like"*. It had not: the review ran in full and the
> answer was sitting in the activity log beside it. Recovered by hand on 2026-08-27 and pasted
> verbatim below. Worth recording, because a review that returned nothing looks exactly like a
> review that found nothing — and this one found nine things.

Verdict: not ready to build. The central design is plausible, but several gaps can silently lose or replace reader text.

1. **Must-fix — “one capture, everywhere” is not yet true.** The plan’s diagram opens `getUserMedia` first, but the existing [`NOT_A_TRACK` probe](../../src/web/useDictation.ts) must run first: on a browser without `start(track)`, it ignores the argument and opens its own microphone. Running it after `getUserMedia` creates exactly the forbidden double capture; retaining the current Safari branch instead produces no owned tape. Likewise, the current failed-`getUserMedia` fallback calls bare `r.start()` ([line 859:859](../../src/web/useDictation.ts)), which must disappear.

   The safe choices are:

   - Drop live recognition everywhere; or
   - Probe before `getUserMedia`; if the argument is ignored, abort the recogniser and await its terminal `end` before opening our track. That preserves “never two captures,” but the probe briefly owns one, so “every capture is ours” must be softened.

   Also add a page-wide owner: separate hook instances in chat and the comment dialog can otherwise open two tracks. A device change must stop and settle the old session before starting another. `SpeechRecognition.start()` without a track explicitly asks it to use the microphone. [MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start)

2. **Must-fix — the existing tape lifecycle contradicts an authoritative second pass.** Today:

   - Recording starts only at recogniser `audiostart` ([`armTape`](../../src/web/useDictation.ts)); Safari will have no recogniser event.
   - Any browser-confirmed text causes the tape to be cancelled ([line 378:378](../../src/web/useDictation.ts)).
   - Hitting the recorder cap deliberately stops the tape while dictation continues ([mic-recording.ts:153](../../src/web/mic-recording.ts)).

   Under this plan, all three silently break the source of truth. Start the recorder and timer when the owned track is ready, keep its blob until the model transcript is accepted, and stop dictation when recording caps. A runtime recorder failure must now be a visible terminal failure, not an optional-evidence failure. The existing per-session object, newest-session guard, track-ended handling, and never-suspend AudioContext rule should be retained and extended.

3. **Must-fix — `readOnly` does not make span replacement race-free.** It blocks typing, but not controlled-state writes, submission, or unmounting:

   - Clicking the separate microphone button has already blurred the textarea, so the plan’s “keeps focus” claim is false without explicit refocus.
   - A pending profile save can replace the draft with its older response ([useProfile.ts:138](../../src/web/useProfile.ts)); the metadata save has the same problem ([Metadata.tsx:347](../../src/web/Metadata.tsx)).
   - Changing comments clears the follow-up through React state ([CommentDialog.tsx:81](../../src/web/CommentDialog.tsx)); changing chat threads unmounts the keyed composer.
   - `readOnly` still fires `keydown`: Enter can submit the Chromium live text from chat ([ChatPanel.tsx:1457](../../src/web/ChatPanel.tsx)) or the comment form before the good transcript arrives.
   - A second microphone press has no specified meaning.

   Add a `transcribing` phase and put `{sessionId, fieldIdentity, expectedRevision, expectedValue, span, AbortController}` on the session. Disable/guard form submission and send controls, not only the input. Replace only if the same field and revision still own the value; otherwise leave the newer value untouched and report the conflict. During transcription, either disable the mic and provide Cancel, or define the mic as Cancel—never start another capture.

4. **Must-fix — the client cap already exceeds Vercel before the route can enforce anything.** [`mic-recording.ts`](../../src/web/mic-recording.ts) prefers AAC without the 32 kbps hint and allows 8 MB. Its measured AAC rate is about 14 KB/s, so five minutes is roughly 4.2 MB raw and about 5.6 MB after base64, before JSON overhead. Vercel rejects bodies above 4.5 MB before `readBody`, auth, custom copy, or request logging runs. [Vercel Functions limits](https://vercel.com/docs/functions/limitations)

   Keep the global 64 KB constant unchanged. Make `readBody(req, limit)` accept an explicit limit and pass a transcription-only limit in that exact route. Align the client’s raw-audio cap below it—roughly 3 MB leaves reasonable base64/JSON headroom—or change this route to binary rather than JSON.

5. **Must-fix — route validation and failure copy are underspecified.** Validate an exact object shape; canonical, non-empty base64; encoded and decoded byte caps; and the exact context union. `format` needs a closed allowlist derived from the recorder’s actual MIME type and ideally a container-signature check. Unknown recorder output must fail locally rather than be labelled `webm`. OpenRouter says formats vary by provider, so empirical acceptance by one endpoint is not a general contract. [OpenRouter audio guide](https://openrouter.ai/docs/guides/overview/multimodal/audio)

   An oversized recording is a non-retryable `blocked` failure: tell the reader to save it if needed and dictate a shorter passage. The current `[ai-too-big]` copy says “text” and is wrong here; add dictation-specific copy in `src/messages.ts`. Map 429 through `providerHttpFailure(429)`, retain the audio, and offer an explicit retry using that same blob.

6. **Must-fix — a system prompt is not sufficient output validation.** A dictated question ending in `?` is a valid transcript, so semantic “looks like a question” checks are unusable. Require a strict structured response such as `{ transcript }`, use `provider.require_parameters: true`, cap output against recording duration, and reject empty, truncated, refused, multi-choice, malformed, or implausibly long responses. A plainly answered question must produce a safe upstream-output failure and must never replace the field; preserve the rough text and recording.

   Where Chromium provides rough text, lexical overlap is useful even when jargon differs. On Safari and Firefox, the server cannot reliably distinguish a concise answer from a transcript without another acoustic reference; the plan must either accept that residual risk explicitly or use an independent ASR result as a guard.

   Also, server assembly does not remove prompt injection: article titles and glossary terms originate in untrusted articles. Put capped terms in clearly delimited data, not interpolated into the governing system instruction.

7. **Must-fix — request cancellation and slow-network behavior need a lifecycle.** “Two seconds” is a median, not a deadline. Abort the client fetch on unmount, field change, cancellation, or timeout; ignore every late response. Propagate cancellation server-side from `res.on("close")`, not `req.on("close")`, as [`routes.ts`](../../src/routes.ts) already explains. Define a visible timeout and retry behavior so the field cannot remain read-only indefinitely. Because this is a model call a reader waits on, the plan must also either stream/heartbeat it or record why atomic validation makes this an exception to the repository’s streaming rule.

8. **Must-fix — the privacy promise is stronger than the implementation.** The plan says the audio is “gone when the request ends” ([line 208:208](../../docs/plans/260827x-dictation-two-pass.md)), but its own failure path retains it for download. More importantly, that sentence can only describe Spideryarn: provider retention varies unless routing enforces it. OpenRouter supports `provider: { zdr: true }`; use it or disclose the weaker truth. [OpenRouter ZDR documentation](https://openrouter.ai/docs/guides/features/zdr)

   The pre-press copy should say that the recording—and profile or article vocabulary—is sent to an AI service. The project can promise that it does not write or log the audio; it cannot promise external deletion without the routing guarantee.

9. **Should-fix — the measurement supports a candidate, not the stated conclusion.** The clearest overstatement is line 29: *“it ranks latency reliably and jargon recovery reliably.”* One synthetic British voice, one sentence, two selected jargon tokens, and three repeated calls only show that this model/prompt worked on that clip. They do not establish expected WER, human-speech quality, accent robustness, or stable latency. “The quality difference is context, not the acoustic model” is likewise broader than the evidence.

   Also, `$0.00040 / 22s` is about `$0.00109/min`, roughly a tenth of a cent—not the “twentieth” claimed at line 77. The referenced benchmark scripts and fixture are not present in the repository, so the result is not reproducible. Check them in and add real human/iPad samples, silence, short one-word dictation, genuine questions, noise, both M4A and WebM, and capped recordings before calling the model choice settled.

The five checks at the end of the plan are therefore insufficient. Each must-fix above needs a failure-first test, especially maximum simultaneous live tracks, unsupported-probe ordering, recorder cap stopping capture, external React-state mutation, Enter submission while read-only, stale response rejection, route-specific body limits, question-transcript acceptance versus answer rejection, and unmount cancellation.
