Code review of Stage 1 of docs/plans/261019m-dictation-records-from-the-first-word-and-a-preview-everywhere.md (read its Stage 1 and "After GPT Sol's plan review" sections, and your plan review at docs/plans/261019m-dictation-plan-review-sol.md, F3 and F4). Stage 2 is NOT built and must not be.

The diff is the uncommitted working tree (also saved at docs/plans/261019m-dictation-code-review.diff): src/web/useDictation.ts, src/web/DictationStrip.tsx, src/web/styles/profile.css, docs/project/dictation.md, docs/project/reader-profile.md, tests/dictation-phases.test.ts, tests/dictation-recording.test.ts.

House workflow: you FIX what you find inside this stage (edit files directly, keep the surrounding comment style), and report anything wider for me to decide. Do not commit. Do not run the full `npm test`; run `npx vitest run tests/dictation-*.test.* tests/mic-*.test.* tests/fleet-dictation*.test.* tests/fleet-new-session*.test.* tests/profile-mic-button.test.tsx tests/help-ask-dictation.test.tsx tests/chat-*dictation*.test.tsx tests/live-mic-lock.test.tsx tests/doc-links.test.ts` and `npm run typecheck`.

Things the implementer flagged, which I want you to judge and fix where right:
1. On Chromium a press-and-stop under ~2 s now ends with "[mic-empty]" (Safari/Firefox already did). Worse: a track `ended` within that window sets "[mic-unplugged]" and then `nothingKept` (useDictation.ts ~1160) overwrites it with "[mic-empty]". The more specific earlier error should win. Fix, with a red-first test.
2. tools/fleet/web/src/DictationControl.tsx says "Opening the microphone…" while startedAt === null; the product strip now says "Wait — opening the microphone…". Align it if it is cheap (update its test), since the fleet uses the same hook.
3. On a non-honoured remembered device the strip shows listening with no microphone line until listInputs resolves. Acceptable?

Also check: every path where the tape now arms earlier (mic-lock, stop during opening, stop during the listInputs await, the keeper/IndexedDB copy, the cap timer endsAt, the quiet warning, double-press Stop in useDictationField, recogniser restart, liveGaveUp, the fleet control), and that removed onaudiostart logic left nothing reading state it used to set.

Write your findings to the output file: numbered, severity, file:line, and for each whether you fixed it (and how) or are leaving it to me. End with the test/typecheck results you ran and a one-line verdict.
