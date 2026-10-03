# Fix check: 261003a, the code written after your stage 3 review

Read-only (`--sandbox review`). Do not change any file. Discovery is closed for the stage; this is a
narrow check of code you have not seen, written after your stage 3 review
(`docs/plans/261003a-gpt-live-alongside-realtime-stage-3-code-review-sol.md`).

Scope, `git diff b777b1cb7..6ff2cad8c -- src tests`:

1. `112fd1301` + the `PROD` change — the dev-only seam in `src/web/live/useLive.ts` (`devSeam`):
   can it do anything in a production build, and can it leave a call running on a silent track by
   accident?
2. `6ff2cad8c` fix 1 — `shownPassage(args, inArticle?)` in `src/web/live/session-shared.ts`, its
   callers in both hooks, `LiveOptions.blocks` from `ConversationModes.tsx`. This answers your D5.
   A real-browser run hit it: the backend sent `spya-gm3xu0a` for `spya-gm3xu0`, `/spoken` returned
   400 and the call ended with its words unsaved. Is the fix complete — can any unknown or
   malformed id still reach a stored `passages` array through either engine? Is the result text
   returned to the model true in every branch? Does the cap of four change Realtime behaviour that
   something else depends on?
3. Fix 2 — `textOf` in `src/web/live/gpt-live/segments.ts`: a space before a delta that arrives
   bare after a 400 ms gap. Can it insert a space inside a word or a number, or change text that has
   already been frozen and stored?
4. Fix 3 — the two flex rules in `src/web/styles/mode-band.css` for `.chat-tool-label` /
   `.chat-tool-detail`. Read the rules; say whether they do what the comment claims.

Also say whether your own D1–D4 fixes look intact after these changes.

Severity: P0/P1/P2, an id on each finding (E1…), file:line. You may run
`npx vitest run tests/live-shown-passage.test.ts tests/gpt-live-segments.test.ts tests/chat-tool-row-css.test.ts`.
End with a verdict: land / land after fixing the P0–P1s / do not land.
