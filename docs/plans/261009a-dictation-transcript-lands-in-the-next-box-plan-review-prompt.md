Review the plan docs/plans/261009a-dictation-transcript-lands-in-the-next-box.md (read-only review; do not edit files).

Context: src/web/useDictation.ts (the hook: sessions, `landed` in the session ending ~line 970, `retry` ~line 1762, the recovery effect ~line 1859, `Session.keeper`), src/web/useDictationField.ts (span, doneKey), and the consumers: src/web/CommentDialog.tsx:208-222, src/web/QuizPanel.tsx:704-716, src/web/FeedbackDialog.tsx:715-735, src/web/CommandBar.tsx:2070-2090, src/web/FeedbackEarlier.tsx:1231-1246, src/web/AnnotateDialog.tsx:438, src/web/ChatPanel.tsx:3047. Prior plan: docs/plans/261005a-dictation-double-press-on-stop-also-sends.md and its review docs/plans/261005a-dictation-double-press-on-stop-also-sends-plan-review-sol.md (F1, F2).

Questions:
1. Is binding delivery to the keeper's box name (refuse only when both the bound and current box are non-null and differ) correct for every consumer? Name any consumer whose keeper box changes when the target does NOT, or stays the same when the target DOES change.
2. Is offering the refused transcript back on the strip (recording + [mic-moved] error + Try again with cached text + held tape) sound? What breaks: the recovery effect, `held`/locks, `artifactSeq`, `keptOnDevice`, the field's onEnd/doneKey/double-press state, the cap, a new press in box B while A's offer is showing?
3. Anything simpler that is still correct?
Give findings numbered F1.., each with severity, file:line, and the smallest fix.
