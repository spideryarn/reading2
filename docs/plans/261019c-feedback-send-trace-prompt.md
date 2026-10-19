You are helping diagnose a UI bug in this repo (Spideryarn, a React reading app). READ-ONLY: do not edit files. Repo root is the current directory.

## The report (from the admin, trusted)
"When I click send in this feedback dialog, it seems to take a few seconds to take effect, where there is no UI feedback at all, no spinner, and then eventually the dialog disappears and presumably got sent."
iPad Safari, production build 956a2380, 2026-10-18 23:38 UTC. consented=false, no screenshot, so no diagnostics were collected.

## Evidence already gathered (production Vercel logs)
- POST /api/feedback for this report: request started 23:38:42.741, server took 81ms, 201. So the server is NOT slow; whatever delay the user saw happened in the browser before the request left (or the user's perception is otherwise explained).
- Immediately before: POST /api/transcribe started 23:38:23.171, ended 23:38:25.971 (24 s of m4a audio, 206 chars = exactly this report's length). So the report was dictated (iPad Safari: no live recogniser; words arrive only via the tape upload to /api/transcribe).
- Same pattern for all five reports Greg filed that evening: transcribe ends -> feedback POST starts 17-19 s later every time (23:37:22.9->23:37:40.9, 23:38:26.0->23:38:42.7, 23:40:27.3->23:40:46.5, 23:41:10.3->23:41:29.9, 23:43:21.8->23:43:40.0). The regularity is suspicious but may just be the human re-reading.
- An earlier report (2026-09-05, docs/user-feedback/260905_1802-spinner-on-the-send-button.md) said the same; the conclusion then was "too fast to see". That is now contradicted: the user says "a few seconds".

## What I need
Trace src/web/FeedbackDialog.tsx (`send`, the Send button label/disabled logic near line 1575, `closeOpening`, the Toast), src/web/useDictationField.ts (`finishThenDone`, `onDone`, `sendingAfter`, `busy`, `readOnly`), src/web/useDictation.ts (phases, what happens on iPad Safari after Stop and after the transcript lands), src/web/DictationStrip.tsx, src/web/lib/api.ts (`apiFetch`, whatever it awaits before fetch — session lookup, SESSION_DEADLINE_MS) and CSS in src/web/styles/feedback.css (.fb-send, :disabled opacity) and annotations.css (.cmt-spinner, reduced-motion).

Answer concretely:
1. Every path from a press of Send (tap, or the double-press Stop, or Send while the mic is on / while transcribing) to the POST on iPad Safari, and for each, what the Send button and the dialog show at each moment, and whether anything can take seconds with the button still reading plain "Send" (or looking unchanged).
2. Whether any path makes the "Sending" state not paint, or paint invisibly (e.g. a disabled 0.45-opacity button, a 14px spinner, a spinner colour that disappears on the green, reduced motion).
3. Whether the onDone -> send() after dictation can silently no-op (stale closure, `somethingSaid` false, `open` false, `view`, `doneKey`), leaving the reader to press Send again.
4. Anything on iOS specifically: a tap on Send while the textarea is focused (first tap dismisses the keyboard / blur and layout shift, so the click lands on nothing or a moved button), sticky :hover states, `touch-action`, the dialog's height changing as the keyboard goes.
5. Your ranked best explanation(s) for "a few seconds with no feedback, then the dialog closes", and the simplest robust fix. Cite file:line.

Write your answer as markdown. Be concrete and short; no preamble.
