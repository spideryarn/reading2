# Plan review: dictation, a double press on Stop also sends

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- Base: `9969c9259` (dev). Worktree: this directory.
- One untracked file is the candidate:
  `docs/plans/261005a-dictation-double-press-on-stop-also-sends.md`. Read it first.
- Nothing is built yet. The code it describes is as it is on the base.

## Start with (does not limit scope)

- `src/web/useDictationField.ts` (whole file)
- `src/web/DictationStrip.tsx` § `DictationButton`, `dictationWords`
- `src/web/useDictation.ts` § `finish`, `done`, `deliverTranscript`, `retry`, and every call of
  `ended.current`
- The five boxes' send paths: `src/web/FeedbackDialog.tsx` § `send`, `src/web/ChatPanel.tsx` §
  `submit` and `toggleDictation`, `src/web/CommentDialog.tsx` (the follow-up form's `onSubmit`),
  `src/web/QuizPanel.tsx` § `submit`, `src/web/AnnotateDialog.tsx` § `press`
- `src/web/styles/profile.css` and `diagram-drift.css`, the `.prof-mic` rules
- `docs/project/dictation.md`

## What to attack, independently

The request is an admin's and is not under review: a double press on Stop sends once the transcript
has arrived.

1. Is the plan's "one hard fact" right, and is `aria-disabled` on a live button the right answer to
   it? Is there a simpler reliable way to see the second press?
2. Trace the proposed send path against the real hook: is it true that one state bump in `onEnd`
   yields a render where the box's value holds the transcript and `busy` is false, in every ending
   (normal, a dictation in parts, the no-tape ending, the retry ending, a superseded session,
   StrictMode)? Name any ending where `onDone` would run on stale state, run twice, or never.
3. Name any way this sends something the reader did not mean: rough live words, a transcript in a
   box that changed, a second dictation's words, a box that closed (Feedback stays mounted when
   shut; the comment dialog and annotate box unmount), chat's live-conversation handoff, a
   different quiz question.
4. Each box's done action as chosen in the table: is any of them the wrong action, or unsafe to
   call from an effect?
5. The 600 ms window and the "press after the dictation already ended" rule: any misfire, on touch
   as well as mouse (double-tap zoom, ghost clicks)?
6. Accessibility of the changed button.
7. Is anything the plan calls unchanged actually changed by it? Is the deferral list right?

Run one test file yourself if it helps, e.g. `npx vitest run tests/dictation-field-busy.test.tsx`.
You have no network and no Postgres.

## Output

Findings with stable IDs `F1`, `F2`, …, each graded by consequence:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

For each: the file and line, what goes wrong, and the smallest change to the plan that fixes it.
End with one line: `VERDICT: build as written`, `VERDICT: build with the fixes above`, or
`VERDICT: do not build`.

## My own suspicions (already mine; spend most of the run elsewhere)

- The effect-after-render send may race with a parent re-render that changes the value between the
  ending and the effect.
- Chat's `toggleDictation` is async (it awaits `live.stop()`), so the Stop press time is recorded
  late.
