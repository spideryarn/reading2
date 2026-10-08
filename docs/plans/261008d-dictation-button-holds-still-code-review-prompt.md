# Code review: 261008d (write-capable; fix what you find inside the stage)

Repo: Spideryarn, this worktree. The plan is
`docs/plans/261008d-dictation-button-holds-still-and-why-the-iphone-asks-again.md` (read it, including
the plan-review dispositions). The change is commit 96124f2c2: `git show 96124f2c2`.

What it must do: from listening through transcribing, nothing in a dictating box's strip or labelled
microphone may change size, so the microphone button does not move at Stop and a second press within
600 ms lands (261005a's double press). And it must not show stale or wrong information: the
microphone line, the couldn't-use warning and the picker must belong to the current dictation, go
when it ends, never carry into the next one, and never offer an action that does nothing (Change and
the picker are disabled while transcribing).

Please check, and fix red-first (a failing test before the fix) anything wrong:

1. `DictationStrip`'s adjust-state-during-render block: correctness under StrictMode, every phase
   transition (opening → listening, listening → transcribing, transcribing → idle, transcribing →
   opening when a new press comes before the words land, a failed/no-tape ending, a retry via
   `retry()`), and render loops.
2. Whether `deviceUnavailableWords(…, mic?.label ?? null)` changes wording in a way that could wrap
   differently at Stop.
3. `TalkLabel` in ChatPanel (Learn) and QuizPanel: accessibility (the Quiz label was not
   aria-hidden before; check what a screen reader gets from a `visibility: hidden` sibling inside an
   inline-grid), and that the CSS in profile.css applies.
4. Any other box (Feedback, comment follow-up, annotate, command bar, profile, Illustrated note,
   the fleet dashboard's `tools/fleet/web/src/DictationControl.tsx`) where something still changes
   size at Stop and moves the button. Report rather than fix anything outside the strip/label if it
   needs a design call.
5. Anything else wrong in the diff.

Gates after any fix: `npx vitest run tests/dictation-strip-holds-still.test.tsx tests/quiz-panel.test.tsx
tests/learn-panel.test.tsx tests/voice-row.test.tsx` plus the `tests/dictation-*` files, and
`npm run typecheck`. Do not commit. Write your answer as: each finding (severity, file:line, what,
what you changed and the test that went red first), then a one-line verdict.
