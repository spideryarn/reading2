Review this plan (read-only). Plan: docs/plans/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md

Context: Greg's feedback SPIDERYARN-READING2-71, quoted in the plan. Read the plan, then the code it touches:
src/web/QuizPanel.tsx (RememberSubModeToggle, QuizPanel step row, move/goNext/canGoNext), src/web/keynav.ts (useArrowNav `horizontal`),
src/web/reader/Reader.tsx (~line 1030-1145, trajectoryKeys; and the remember case ~1750), src/web/modes/conversation/ConversationModes.tsx (RememberBand, QuizSubBand),
src/web/IconButton.tsx, src/web/Tooltip.tsx, src/web/key-chord.ts (isTyping), docs/project/keyboard.md, docs/project/icons.md § Navigation, tests/quiz-panel.test.tsx.

Questions:
1. Is the ← / → wiring correct and safe: can the keys fire when Quiz is not showing, in a text box, with the drawer open, or double-fire with anything else (Trajectory, the dock, the comment dialog, the command bar)? Does the stable-handler-through-a-ref design have a stale-closure or unmount race?
2. Is the "refuse the key while the box holds an unmarked draft" rule right, and is its definition (typed non-empty and (no attempt or superseded)) correct against the code?
3. IconButton with aria-disabled replacing native disabled on Previous/Next: anything broken (tests, keyboard focus, a click that still moves)?
4. Anything simpler that would do the same job, or anything missing for "minimal".
Write findings to the output file, numbered, each with severity (P0-P3), the file/line, and the fix. Say plainly if you find nothing.
