You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React). Read CLAUDE.md briefly for conventions.

Plan: docs/plans/261011y-dictation-short-recordings-and-a-double-press-that-lands.md — read it in full. Part 1 is already implemented in the working tree (`git diff` shows src/web/mic-recording.ts MIN_MS 2000 -> 600 and tests/mic-recording.test.ts); Part 2 is the proposal.

Relevant code: src/web/useDictationField.ts (the whole file: toggle, again, finishThenDone, onEnd, the wish/sendTick effect, doneKey handling), src/web/DictationStrip.tsx (DictationButton, DONE_WORDS, DICTATION_DOUBLE_STOP), src/web/useDictation.ts (stop/toggle/cap, CAP_PRESS_GRACE_MS, phases), the boxes that pass `again`: ChatPanel.tsx (note `toggleDictation`), CommandBar.tsx, FeedbackDialog.tsx, FeedbackSendBox.tsx, QuizPanel.tsx, AnnotateDialog.tsx, CommentDialog.tsx, help/HelpAsk.tsx; tools/fleet uses the field too. Tests: tests/dictation-double-stop-sends*.test.tsx, tests/dictation-finish-then-done.test.tsx, tests/command-bar-double-stop.test.tsx, tests/dictation-strip-holds-still.test.tsx. Docs: docs/project/dictation.md § "A double press on Stop also sends".

Questions:
1. Part 1: is 600 ms a sound floor? Anything else (client or server) that would still throw away a ~1 s dictation (e.g. upload/size floors, MIN_AUDIO_BASE64 vs real Chrome/Safari bitrates for 0.6-1 s, the TIMESLICE, a hook-level duration check)? Any risk the plan underrates?
2. Part 2: does a 300 ms hold before Stop on boxes with onDone, with the second press calling finishThenDone, correctly replace the 600 ms after-Stop window and the fast-ending path? Find edge cases that break: the cap during the hold, a microphone/device change or the hook's own restart, unmount, doneKey change, keyboard activation (Enter/Space on the button; Enter in the command bar while holding), the box's own Send during the hold, a third press, the live recogniser on Chromium, ChatPanel's toggleDictation wrapper, the Feedback dialog closing during the hold, StrictMode.
3. Is deleting `again`/pressable/stoppedAt/endedWith/stopAwaitingEnd safe — does anything else depend on them (e.g. sendingAfter display, Retry semantics)?
4. Is there a simpler or better design we missed? Greg wants little complexity.

Write findings as a numbered list, each with severity (P0-P3), the file/line, and the concrete fix. End with a one-line verdict: BUILD / BUILD WITH CHANGES / RETHINK.
