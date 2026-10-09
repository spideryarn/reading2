Code review of the built fix for docs/plans/261009a-dictation-transcript-lands-in-the-next-box.md (queue item qi-cfrv4spd). Your plan review is docs/plans/261009a-dictation-transcript-lands-in-the-next-box-plan-review-sol.md; the plan says which findings were taken.

The diff: `git diff HEAD` in this worktree. Files: src/web/useDictation.ts (`elsewhere`, MOVED / MOVED_HELD, the moved branch in `landed`, the live-phrase guard in `r.onresult`, the guard at the top of `start`, the two checks in `retry`, the recovery gate, `keptNow`), src/web/AnnotateDialog.tsx and src/web/FeedbackEarlier.tsx (keeper names), tests/dictation-lands-in-its-own-box.test.tsx (each test was seen red with its guard disabled), docs/project/dictation.md § Words go only where they were said.

You may edit files to fix defects you find inside this change (house workflow: the reviewer fixes what it finds within the stage). Report anything wider for me to decide. For every fix, add or adjust a test that fails without it. Do not commit. Do not invent quotes from Greg. Run `npx vitest run tests/dictation*` and `npm run typecheck` after any edit.

Look especially at:
1. The `[mic-moved-held]` refusal in `start`: does the field's `toggle` (src/web/useDictationField.ts) leave any of its own state wrong when the hook refuses (focus, pressedAt, wantSend, againOpen)? Is the strip (src/web/DictationStrip.tsx) still sensible: does it show Try again / Save / Discard and the sentence?
2. `keptNow` is render-state mirrored into a ref; is there a window where it lies (holdKept resets it to false then sets true after intact())?
3. The recovery gate using `phaseNow.current !== "idle"`: any case where a legitimate recovery is now skipped for good rather than deferred?
4. Anything in the moved branch of `landed` that diverges from the failure branch where it should not (artifactSeq, done(), s.kept complete/forget, `keptOnDevice`).
5. The `elsewhere` rule for every consumer of useDictationField.

Findings numbered C1.., each with severity, file:line, what you changed (if anything) and why.
