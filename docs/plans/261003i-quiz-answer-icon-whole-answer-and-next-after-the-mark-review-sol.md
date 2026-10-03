Reviewed read-only. `npx vitest run tests/quiz-panel.test.tsx` passes: **87 tests**.

1. **F1 — P1 — REASONED: value-only resizing can hide the answer after reflow.**  
   [Plan §2](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/docs/plans/261003i-quiz-answer-icon-whole-answer-and-next-after-the-mark.md:71) recalculates height only when the value changes. Type a long answer, then narrow the window or rotate the iPad: more lines wrap, but the fixed height remains. With `overflow-y: hidden` and resizing removed, part of the answer becomes hidden until another edit. Checking three widths independently misses this.

   Recalculate when the field’s width changes, and when its DOM node mounts. Check the **same unchanged answer** across widths, including 287px.

2. **F2 — P2 — ESTABLISHED: the existing tests require migration, and do not cover the new state fully.**  
   [tests/quiz-panel.test.tsx:483](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/tests/quiz-panel.test.tsx:483) selects `button.gloss-run` and requires native `disabled`; lines 531 and 556 also require native disabling. Those assertions cannot survive the planned control unchanged. Additionally, line 802 requires an unavailable Next on the last question, whereas the plan removes it. The existing component always renders that Next at [QuizPanel.tsx:1090](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/src/web/QuizPanel.tsx:1090).

   Explicitly migrate these assertions to accessible names, `aria-disabled`, and refused activation. Retaining the existing unavailable terminal Next is the simpler choice. Add shortcut submission checks and exercise promotion with **matching typed text** for right, wrong, and absent verdicts: the existing grading-word test uses an unmatched answer, so it would miss the promoted state.

3. **F3 — P2 — ESTABLISHED: Next’s proposed primary styling needs a concrete implementation choice.**  
   [IconButton.tsx:25](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/src/web/IconButton.tsx:25) excludes `className` and `type`; line 126 fixes its 28px size and colors with Tailwind utilities. Ordinary rules in `quiz.css` cannot override those utilities, because [tailwind.css](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/src/web/tailwind.css:72) places them above the application layer.

   Specify the mechanism before building. A permanent local Next button with the existing accessible name, tooltip, refusal behavior, and conditional styling fits the stated file scope. Avoid swapping component types when promotion changes, which could lose keyboard focus.

4. **F4 — P2 — REASONED: disabling re-marking adds behavior the reports do not require.**  
   [Plan §3](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/docs/plans/261003i-quiz-answer-icon-whole-answer-and-next-after-the-mark.md:89) removes the ability to request another critique of unchanged words, introduces another submission guard, and adds explanatory copy. The existing [submit handler](/home/greg/code/spideryarn2/.claude/worktrees/fb-quiz-answer-icon-next-button/src/web/QuizPanel.tsx:822) permits that action.

   The simpler version promotes Next and gives Answer a quiet enabled style after a matching completed mark. That gets one visual primary without changing submission behavior. Likewise, a local styling class avoids adding an action-only form merely to satisfy chat’s CSS selector.

The plan’s use of `done` plus `!superseded` is sound: it neither exposes the hidden verdict nor promotes Next before completion. The current submission guards cover both microphone states, and keeping the textarea handler preserves Cmd/Ctrl+Enter and stopped key propagation. An `aria-disabled` submit inside a form is workable with canceled default submission and guarded handlers. The conventional send icon is a reasonable interpretation of the explicit request; its meaning should remain usable without opening a touch tooltip.

**BUILD WITH CHANGES (F1, F2, F3, F4).**