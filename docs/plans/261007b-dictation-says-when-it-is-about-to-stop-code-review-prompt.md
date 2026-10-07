You are reviewing code before it is pushed. **Read-only this time: do not edit any file.** (A
sixteen-minute browser soak is running against this worktree's dev server, and an edit under
`src/web/` would hot-reload the page under it. Report what you would change; the session will make
the edits.)

What to review: commit `497ec8d00` in this worktree (`git show 497ec8d00`), which is the whole
change. The plan, with what each finding of your plan review became, is
`docs/plans/261007b-dictation-says-when-it-is-about-to-stop-and-runs-fifteen-minutes.md`; your plan
review is `docs/plans/261007b-dictation-says-when-it-is-about-to-stop-plan-review-sol.md`.

The request, from Greg (an admin, feedback report spya-n8cuqq): a long dictation in the Feedback
dialog was cut off at five minutes with no sign; never stop silently, and make any cap at least
fifteen minutes.

What was built:
- `src/web/mic-recording.ts`: `MAX_MS` 15 minutes (exported), `CAP_WARNING_MS`, the tape owns
  `endsAt`, `cap()` is called by the timer and by `onData` past the deadline, once.
- `src/web/useDictation.ts`: `endsAt` on the hook's result (set from the tape when armed, cleared
  in `finish`), the `[mic-full]` sentence built from `MAX_MS`, the cap chime played after
  `tape.stop()` resolves and the track is stopped, a 1.5 s grace in `toggle` after a cap.
- `src/web/quiet-chime.ts`: `playCappedChime`, `useLastMinuteChime` (dropped if its timer is more
  than 5 s late).
- `src/web/DictationStrip.tsx` + `styles/profile.css`: the last-minute warning row and countdown;
  the live region says one stable sentence.
- `tools/fleet/web/src/DictationControl.tsx`: the fleet dashboard's own countdown.
- `src/types.ts`, `src/routes.ts`, `src/db/schema.ts` (comment only): Feedback's reader limit
  4,000 → 12,000, inside the unchanged 12,072 CHECK; a stale client's three legacy answers keep
  4,000 each (`MAX_LEGACY_FEEDBACK_ANSWER_CHARS`).
- Help text, `docs/project/dictation.md`, comments.
- Tests: `tests/dictation-cap-warning.test.tsx`, `tests/fleet-dictation-cap-warning.test.tsx`, and
  edits to `tests/mic-recording.test.ts`, `tests/dictation-segments.test.ts`,
  `tests/feedback-route.test.ts`.

Gates already run by the session: `npm run typecheck` clean; the dictation and feedback suites
named above pass (199 + 48 tests); two guards (`CAP_PRESS_GRACE_MS`, `LATE_MS`) were mutated and
their tests seen to fail.

Please look hardest at:

1. Real bugs in the hook. Every path on which `endsAt`, `s.capped` or `cappedAt` could be wrong or
   stale: a device change mid-dictation, another box taking the microphone, unmount, a tape that
   breaks, a tape that never arms, the recogniser dying, `retry`, a recovered recording, a second
   dictation started after a capped one (does the 1.5 s grace ever swallow a press it should not?
   is `endsAt` ever left set while idle, or the last-minute chime armed for a dead session?).
2. `cap()` in `mic-recording.ts`: its guards (`capped || stopping || cancelled`), the call from
   `onData` relative to rotation and to a part that is closing or failed, and whether a cap that
   arrives through `onData` during `rec.start()` (a chunk delivered from inside `start`) can run
   before `parts` holds the part. Whether `collect()` still marks the right part `capped`.
3. The strip: `useNow(dictation.endsAt === null ? null : 1000)` and whether `now` can be stale when
   `endsAt` first arrives or after a hidden tab; the countdown at and below zero; the two classes
   together (`quiet` and `ending`); the live region; whether the visible words and the live words
   can contradict each other.
4. The chime played after `tape.stop()`: is it on every ending a capped session can reach, and
   never on one that was not capped? Does it also play when the session was superseded or the
   component unmounted, and should it?
5. Feedback: every reader of `MAX_FEEDBACK_ANSWER_CHARS` after the change; the legacy fold; the
   request-size arithmetic; anything that pinned 4,000 (dialog prefill guard, tests, docs, Help,
   the privacy page). Is anything now wrong at 12,000?
6. The tests: does each one fail if the behaviour it names is removed? Name any that would pass
   over a broken implementation.
7. Docs and reader-facing sentences changed here: anything untrue, anything still saying five
   minutes about dictation, anything that claims more than was verified.

Answer with findings numbered C1, C2, …, each marked blocker / should-fix / note, with file:line
and the smallest change that would fix it. Finish with one line: `VERDICT: approve`,
`VERDICT: approve with fixes` or `VERDICT: rework`.
