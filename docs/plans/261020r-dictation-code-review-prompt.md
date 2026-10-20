You are reviewing code before it is pushed, and you may fix what you find inside this change.

The change: a dictation microphone on the add page's two boxes, and a ratchet test so every prose box gets one by default.
Plan (with your plan review's outcome, and the findings declined with reasons, Opus arbitrating): docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md
Your plan review: docs/plans/261020r-dictation-plan-review-sol.md
The scoped diff: docs/plans/261020r-dictation-code-review.diff (also `git diff HEAD` in this worktree)
Code: src/web/AddPage.tsx (useBusyDictation, AddMic, busyNow, tellPurposeBusy, tellAboutYouBusy, mayOpen, the completion effect, the waiting effect, showPurpose, micOff, PublicChoice, ReadyBar), src/web/add-purpose.ts (setPaused, heldSeed, adopt, arm), src/web/dictation-report.ts; tests/add-purpose.test.ts (describe "paused while dictating"), tests/add-page-dictation.test.tsx, tests/prose-boxes-have-a-microphone.test.ts. Reference: src/web/useDictationField.ts, src/web/useDictation.ts, src/web/ProfileBox.tsx, docs/project/dictation.md § Adding it to a box.

Look especially for: a path where a live dictation is unmounted or the page leaves by itself; a saved rough guess outside the accepted exits; a same-tick race between the busy refs and the completion effect or a press (layout effect ordering, StrictMode double effects, the unmount cleanup that reports not-busy); the held seed and the session replaced when the slug first arrives; the microphone button disabled mid-dictation (a Stop that cannot stop); a test that would pass with the feature removed; the ratchet scan missing a textarea or misattributing its component.

Do not re-raise the declined findings (P1-1's exit snapshot, P1-2, P1-3) unless you find something the plan's reasons do not cover.

Fix what you find inside this change, keeping to the surrounding code's style and comment density. Then run: npx vitest run tests/add-purpose.test.ts tests/add-page-dictation.test.tsx tests/add-page-purpose.test.tsx tests/prose-boxes-have-a-microphone.test.ts and npm run typecheck. Do not commit, and do not run git commands that discard work.

Your answer: a numbered list of findings (P1/P2/P3, file:line, what you changed or why you did not), the test and typecheck results, and a final one-line verdict: "ship", "ship with the fixes above", or "do not ship".
