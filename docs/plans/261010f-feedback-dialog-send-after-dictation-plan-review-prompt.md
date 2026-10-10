# Plan review: 261010f

You are reviewing a plan, read-only, in the repository in your working directory. Read
docs/plans/261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md first, then the code it
changes: src/web/FeedbackDialog.tsx (send, the Send button's disabled/label, the `sending` latch,
`dictationBusy`, `onDone`, `doneKey`), src/web/useDictationField.ts (`again`, `wantSend`,
`delivered`, `onEnd`, `toggle`, `DOUBLE_PRESS_MS`), src/web/useDictation.ts as needed,
src/web/DictationStrip.tsx, src/web/lib/api.ts (`apiFetch`), src/web/FeedbackButton.tsx
(`FeedbackHost`, `readerId`), src/web/lib/storage-reader.ts, docs/project/auth.md § Browser storage
that is a reader's is keyed by that reader, docs/project/dictation.md § A double press on Stop also
sends, docs/project/feedback.md.

Context: the bug was not reproduced; the plan makes three silent-dead-Send states impossible and
adds a localStorage draft. Answer:

1. Is each of the three stage-1 changes correct and safe? In particular `finishThenDone()`: races
   with `doneKey` changing (dialog shut), with the cap's auto-stop, with `opening` (getUserMedia
   pending) — what happens to the wish if stop ends with no audio, or the hook restarts on a new
   device? Does making Send enabled while armed break the `somethingSaid` / over-length / Earlier
   guards, or any existing test's intent? Is ignoring a start press within DOUBLE_PRESS_MS of Stop
   right, and does it break anything (e.g. a reader who stops and immediately starts again)?
2. The 60 s deadline: is `apiFetch` able to take an AbortSignal cleanly, and does the idempotent
   retry really hold (server `duplicate`)? Any interaction with the `sending` latch and `stillMine`?
3. Stage 2 draft: correctness of restore-once-on-load vs the existing in-memory draft that survives
   close; reader change (the dialog is keyed on readerId); clearing only when the stored body equals
   the sent body; the prefill prop; anything privacy-wise in the feedback/auth docs it contradicts.
4. Anything simpler that gets the same result, and anything missing.

Number findings F1.., each with severity (P1 must fix / P2 should / P3 nit), file:line evidence, and
the concrete change. End with a verdict line: APPROVE, APPROVE WITH CHANGES, or REWORK.
