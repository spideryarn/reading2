Code review of commit 4136fef4 (SPIDERYARN-READING2-71). You may FIX what you find, inside this change's scope (src/web/QuizPanel.tsx, src/web/keynav.ts, src/web/reader/Reader.tsx, src/web/modes/conversation/ConversationModes.tsx, tests/quiz-panel.test.tsx, tests/keynav-horizontal.test.ts, and the three docs). Report anything wider rather than changing it. Do not commit.

Read the plan first: docs/plans/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md (it records your own plan review and what was taken). The code diff is `git show 4136fef4`.

Check in particular:
1. The ← / → wiring end to end: QuizPanel's stepByKey ref + useLayoutEffect registration/cleanup → QuizSubBand → RememberBand → Reader's quizKeys state (setQuizKeys(() => handler)) → useArrowNav's horizontal. Any path where a stale handler survives (e.g. Remember → Recall → Quiz, mode switch, batch replacement, remount ordering where the new panel registers before the old one's cleanup nulls it), or where Reader re-renders on every quiz render?
2. The refusal rules: unmarked draft, listening (armed || readOnly), canGoNext, previousAt; and the new dialog guard in keynav.ts (does it break Trajectory or the ↑/↓ path, and is `closest` on the event target right when the target is a text node or window?).
3. IconButton + Tooltip on the step row: does Tooltip's cloned props reach the button (IconButton passes ...rest), is aria-expanded still on the list button, focus/keyboard OK, and does an aria-disabled Next still refuse a click while marking?
4. The tests: can each new test fail? (I saw the draft and dictation tests go red with their guards removed, and the dialog test red before the fix.)
5. Docs claims vs code: anything in keyboard.md § ← / → in Quiz, quiz.md § On screen, or the plan that the code does not do.

Run: npx vitest run tests/quiz-panel.test.tsx tests/keynav-horizontal.test.ts tests/keynav.test.ts tests/keynav-handled.test.ts tests/arrows-belong-to-the-article.test.tsx tests/remember-url-rules.test.tsx tests/pressing-a-chip-arms-it.test.tsx and npm run typecheck.

Write your findings (numbered, severity P0-P3, file:line, what you changed or why not) to the --output file.
