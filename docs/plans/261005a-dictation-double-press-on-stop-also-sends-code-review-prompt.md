# Code review: dictation, a double press on Stop also sends

You are reviewing **and fixing** one committed stage, in this worktree. You may edit files. You
cannot commit; leave your changes in the working tree.

- **Fix what is inside this stage**, narrowly, each finding red-first with the test that reproduces
  it.
- **Report, do not fix, anything wider** you notice, so the caller can decide.

## The candidate

- Commit `4c59b9d9c`, on top of `9969c9259`. See it with `git show --stat 4c59b9d9c` and
  `git diff 9969c9259 4c59b9d9c`.
- Changed paths, complete: `src/web/useDictationField.ts`, `src/web/DictationStrip.tsx`,
  `src/web/FeedbackDialog.tsx`, `src/web/ChatPanel.tsx`, `src/web/CommentDialog.tsx`,
  `src/web/QuizPanel.tsx`, `src/web/AnnotateDialog.tsx`, `src/web/help/help-modes.tsx`,
  `src/web/styles/profile.css`, `tests/dictation-double-stop-sends.test.tsx`,
  `tests/chat-live-dictation.test.tsx`, `docs/project/dictation.md`, and under `docs/plans/` the
  plan `261005a-dictation-double-press-on-stop-also-sends.md` with its plan review and prompt.
- Read the plan first. Its § "GPT Sol's plan review, and what was done with it" says which of your
  earlier findings were taken and which one was overruled in part (F4), with the reason.

## Start with (does not limit scope)

- `src/web/useDictationField.ts` (the whole of the new logic)
- `src/web/DictationStrip.tsx` § `DictationButton`
- `src/web/useDictation.ts` § `finish`, `done`, `retry`: the real order of `onTranscript`, the
  phase change and `onEnd`, which the new code depends on
- each box's `onDone`

## What to attack, independently

1. Any path where `onDone` runs with stale state, runs twice, or runs for a dictation or a target
   it was not pressed for. StrictMode, an unmount with the timer pending, a second Stop press
   inside the window, a device change, another box taking the microphone.
2. Any path where the button is left enabled, or left disabled, when it should not be; and whether
   the 600 ms state can stick.
3. Each box's `onDone` against that box's real send path. `CommentDialog.tsx` had its form's submit
   body moved into `askFollowUp`: is behaviour identical for the plain submit?
4. Whether `docs/project/dictation.md` and the `/help` sentence are true of the code.
5. **Real-hook coverage (your plan-review F7).** `tests/dictation-double-stop-sends.test.tsx` stubs
   `useDictation`. Add one test that mounts the real `useDictation` under `useDictationField`
   (the fakes in `tests/dictation-keep-hook.test.tsx` or `tests/dictation-segments.test.ts` are the
   place to borrow from) and proves: Stop, a second press, the transcriber answers, `onDone` runs
   exactly once and sees the transcript in the box with `busy` false; and that a failed
   transcription followed by Try again does not send. If the real hook disagrees with the stubbed
   order, that is a finding.

Tests you can run: `npx vitest run tests/dictation-double-stop-sends.test.tsx` and any other single
jsdom test file. You have no network and no Postgres; a red inside your sandbox from a test that
spawns a process or writes a temp file is not yet a finding. Do not run `npm test`.

## Output

Findings with stable IDs `C1`, `C2`, …, each graded by consequence, each saying **fixed** (with the
test that went red first) or **reported**:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

Do not attribute any sentence to Greg that is not already quoted in the plan. End with one line:
`VERDICT: ship`, `VERDICT: ship with the fixes I made`, or `VERDICT: do not ship`.

## My own suspicions (already mine; spend most of the run elsewhere)

- `again` is returned only when `onDone && againOpen && readOnly`; if the hook reports
  `transcribing` a render later than the Stop press, the window is shorter than 600 ms in practice.
- In `AnnotateDialog.tsx`, `onDone` appears only once `loaded`; if `loaded` flips after the second
  press was taken the wish is still honoured through the latest ref, which is intended.
