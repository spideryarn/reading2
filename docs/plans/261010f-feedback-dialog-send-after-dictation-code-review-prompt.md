# Code review: 261010f

You are reviewing code in the repository in your working directory, and you may fix what you find.
The work is the two commits `ad7f55d72` (stage 1) and `a32bcf282` (stage 2) on top of `d571a7f14`:
`git diff d571a7f14..HEAD`. Read the plan first,
docs/plans/261010f-feedback-dialog-send-after-dictation-and-a-saved-draft.md, including your own
earlier plan review beside it (…-plan-review-sol.md) and how each finding was taken or answered.

Files: src/web/useDictationField.ts (`finishThenDone`, `stoppedAt`/`endedWith`, the `opening`
effect), src/web/FeedbackDialog.tsx (send order, Send's `disabled`, `SEND_TIMEOUT_MS`,
`attempted`, the draft effect and its removal on success, the lazy restore), src/web/feedback-draft.ts,
src/web/FeedbackButton.tsx, src/web/AccountSection.tsx, src/web/PrivacyPage.tsx, the tests
(tests/dictation-finish-then-done.test.tsx, tests/feedback-dialog.test.tsx), and the doc changes.

Look hardest at:
1. Races in `finishThenDone`: the wish set before `dictation.toggle()`; Safari's synchronous finish;
   a stop during `opening`; the cap; the `doneKey` flip when Feedback shuts; StrictMode double effects.
   Can the wish leak into a later session or send twice (finishThenDone + again + fast second press)?
2. The fast-ending second press in `toggle`: can it fire `onDone` for words the reader did not just
   stop, e.g. a press on a box whose last ending was long ago but `stoppedAt` was never cleared, or
   after the dialog shut and reopened, or after the double press was already honoured?
3. `send()`: refusal order; the `attempted` id rotation with `stillMine`/`reportIdRef`/`discard`;
   the timeout's `finally` and `stillMine`; anything that can leave `sending.current` true.
4. The draft: the effect's dependency on `reportId` (and `discard` minting a new id on success),
   the success-path removal vs a pending timer, restore + prefill, reader change (`key={readerId}`),
   storage errors, the week expiry, sign-out.
5. Anything a reader would notice that the plan did not intend; doc statements that are not true of
   the code.

Fix what you are confident about, keep the house style (comment density, naming), run
`npx vitest run tests/dictation-finish-then-done.test.tsx tests/feedback-dialog.test.tsx
tests/dictation-double-stop-sends.test.tsx tests/dictation-double-stop-sends-real-hook.test.tsx` and
`npm run typecheck`, and do not commit. Report numbered findings C1.. with severity (P1/P2/P3),
file:line, what you changed or why you did not, and anything wider for me to decide. End with a
verdict line: APPROVE, APPROVE WITH CHANGES, or REWORK.
