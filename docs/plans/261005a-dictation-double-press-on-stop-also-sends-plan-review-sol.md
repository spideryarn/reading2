F1 — P1 — [plan:65](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:65), [CommentDialog.tsx:207](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/CommentDialog.tsx:207), [QuizPanel.tsx:594](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/QuizPanel.tsx:594)

The dictation is not bound to the comment or quiz question where it started. Both components reuse the same hook instance when navigating and clear the controlled value. When there are no live words—always on Safari/Firefox, and possible on Chromium—`span.current` is null, so the final transcript is accepted into the new comment/question. `delivered` becomes true and the latest `onDone` then submits it against that new target. The effect’s latest-callback ref makes this retargeting explicit.

Smallest plan fix: add a field identity captured at Start (`comment.id`, `question.id`, and equivalent identity for every consumer), and refuse both transcript delivery and deferred send if it changed. Test navigation during transcription on the no-recognizer path.

F2 — P1 — [plan:55](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:55), [FeedbackDialog.tsx:683](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/FeedbackDialog.tsx:683), [FeedbackDialog.tsx:812](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/FeedbackDialog.tsx:812)

Feedback remains mounted after closing, deliberately continues receiving its transcript, and `send()` does not guard `open`. A reader can double-press Stop, close the dialog while transcription is pending, and have a report filed unseen.

Smallest plan fix: require the done action still to own a visible/active box. Feedback’s callback must check `open`, and closing must cancel the pending-send intent. Add a close-before-transcript test.

F3 — P1 — [plan:37](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:37), [DictationStrip.tsx:191](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/DictationStrip.tsx:191)

`aria-disabled="true"` is false semantics: during the relevant interval the button is intentionally actionable. Assistive technology will announce it as unavailable and may not offer ordinary activation, while its proposed name—“Turning your words into text”—describes status rather than the action available.

The hard fact about a native `disabled` button is correct; the ARIA answer is not. Keep it enabled, style the busy state with a class/data attribute, and name its available action, such as “Send when transcription finishes.” Once that intent is accepted, it may become genuinely disabled. The proposed “keyboard equivalent” deferral should also be removed or replaced with an actual keyboard design.

F4 — P1 — [plan:61](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:61), [AnnotateDialog.tsx:455](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/AnnotateDialog.tsx:455), [AnnotateDialog.tsx:570](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/AnnotateDialog.tsx:570)

The UI can promise “then sending” when the box’s done action cannot run. Annotate explicitly allows dictation while comments are loading, but `press(false)` refuses until `loaded`; an accepted double press can therefore end with no Save and no later retry. Similar refusals exist for Feedback preparation and over-limit transcripts.

Smallest plan fix: only offer the second-press action when the done action is currently available, or queue it until that prerequisite becomes available. Test each consumer’s refusal states; do not announce an unconditional send when only an attempt is guaranteed.

F5 — P1 — [plan:80](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-also-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:80), [profile.css:387](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/styles/profile.css:387)

The plan adds a double-tap gesture without disabling browser double-tap handling. `.prof-mic` has no `touch-action: manipulation`, so mobile browsers may delay clicks or treat the gesture as zoom rather than two button activations. The proposed width/layout check would not exercise this.

Smallest plan fix: add `touch-action: manipulation` to the microphone button and include a real two-tap interaction in the iPad/phone browser pass. There is no separate touch handler here, so ordinary ghost-click duplication is not otherwise introduced.

F6 — P1 — [plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:84), [useDictation.ts:872](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/useDictation.ts:872)

After a fast no-tape ending, the button is visibly back to “Dictate,” yet the plan swallows a press within 600 ms. A reader promptly pressing it to retry gets no new dictation and no explanation. A fast successful ending has the related ambiguity that a press apparently starting another dictation instead sends the prior text.

Smallest plan fix: clear the window immediately on an ending without a delivered transcript, so retry starts normally. For a successful fast ending, retain an explicit transient “Send” state until the window expires rather than showing “Dictate” while intercepting it.

F7 — P2 — [plan:123](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/docs/plans/261005a-dictation-double-press-on-stop-also-sends.md:123), [useDictation.ts:823](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/useDictation.ts:823), [useDictation.ts:1705](/home/greg/code/spideryarn2/.claude/worktrees/fbrp8676-dictation-double-stop-sends/src/web/useDictation.ts:1705)

The planned field tests mock out `useDictation`, even though the central claim under test is its real ordering and its distinct normal, multipart, no-tape, retry, superseded, unmount, and StrictMode endings. The mock can only repeat the order the test author assumes.

Smallest plan fix: retain the focused unit tests, but add real-hook coverage—preferably alongside `dictation-segments.test.ts`—for multipart success, no tape, retry, supersession, unmount, and StrictMode exact-once behavior, plus consumer tests for Feedback close and comment/quiz identity changes.

On the ordinary and multipart success paths, the real hook does deliver the transcript before `onEnd`, and React can render the new value with `busy: false`; no-tape/failure call `onEnd` without delivery, retry deliberately calls it again, and stale or unmounted sessions do not call it. Chat’s awaited Live stop does not delay the actual Stop timestamp in the valid state: Live and dictation cannot both own the microphone then.

`npx vitest run tests/dictation-field-busy.test.tsx` passed: 4 tests.

VERDICT: build with the fixes above