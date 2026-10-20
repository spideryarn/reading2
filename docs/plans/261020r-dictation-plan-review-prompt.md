You are reviewing a plan before it is built. Read-only: do not edit any file.

Plan: docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md
Background: docs/plans/261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md § C2, and your own earlier review docs/plans/261020a-part-c-plan-review-sol.md (its four P1s are meant to be the spec; check each is fully answered).
Code: src/web/AddPage.tsx (PurposeBox, AboutYouBox, ReadyBar, PublicChoice, the completion effect, openTheArticle, the waiting effect, showPurpose), src/web/add-purpose.ts (AddPurposeSession: seed, changed, commit, idle timer), src/web/useDictationField.ts, src/web/useDictation.ts (armed/opening, keeper box change, unmount abort), src/web/ProfileBox.tsx (the reference box with a microphone), src/web/dictation-keep.ts, src/web/dictation-report.ts, docs/project/dictation.md § Adding it to a box.

Questions:
1. Does any exit, unmount or save path still lose or corrupt dictated words? Think about StrictMode, a session replaced when the slug first appears mid-dictation, the held seed, the repeat-paste path, the author-gift phase, failure answers, Retry.
2. Is the held-seed design in Stage 2 right, or is there a simpler correct one?
3. Is the ratchet test in Stage 5 sound and worth it, and is its file scan robust?
4. Anything simpler that is still correct.

Write findings as a numbered list, each with severity (P1/P2/P3), file:line evidence and a concrete fix. End with a one-line verdict: "build as planned", "build with the changes above", or "revise before build".
