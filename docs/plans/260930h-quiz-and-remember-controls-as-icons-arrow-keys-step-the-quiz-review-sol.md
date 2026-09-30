Review complete: **approve with changes**.

Report: [plan review](/tmp/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz-plan-review-sol.md)

Key findings:

1. P1: Arrow keys can step Quiz from focused controls inside comment/annotation dialogs.
2. P1: Empty in-flight dictation bypasses the draft guard and may land in the next question.
3. P2: Tests accept native `disabled`, so they do not prove the required `aria-disabled` behavior.
4. P2: Recall/Quiz icons lose their explanation for sighted touch users.
5. P3: The implementation needs explicit icon sizes.

The ref-based handler lifecycle itself looks safe. Focused tests passed: 78/78.

The repository’s read-only review profile blocked writing the report under `docs/plans/`, so it was written to `/tmp` instead.

---

The full report, copied from /tmp:

APPROVE WITH CHANGES

1. **P1 — Left/right can still step the quiz from inside an open comment or annotation dialog.** The plan says the shared listener runs after every existing guard, but those guards are only `enabled`, modifiers/repeat, `isTyping(e.target)`, and `defaultPrevented` (`src/web/keynav.ts:446`). A comment dialog deliberately focuses its Close button, and also contains Previous/Next buttons (`src/web/CommentDialog.tsx:294`); none is a typing target and none handles an arrow key, so the event reaches `window` and changes the quiz behind the dialog. The command bar is safe in its normal state because its input keeps focus, the drawer is covered by `enabled`, and Trajectory is mutually exclusive by mode, but those do not make the dialog case safe. Fix: before dispatching a horizontal key, refuse an event whose target is inside `[role="dialog"]` or `dialog[open]` (target-scoped so a modeless dialog does not freeze the page after the reader deliberately focuses the page behind it), and add a DOM test with a focusable button inside each dialog shape.

2. **P1 — An empty in-flight dictation bypasses the draft guard and can put one question's answer into the next question.** The proposed rule only refuses when `typed.trim()` is non-empty (`docs/plans/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md:68`; the in-progress expression is `src/web/QuizPanel.tsx:598`). On Safari/Firefox a recording contributes no rough words, so `typed` can be empty while the microphone is armed or while its transcript is arriving. After a stray arrow calls `move`, `useDictationField` remains mounted and its eventual transcript writes through the latest `setTyped`, now under the next question (`src/web/useDictationField.ts:223`). Fix: refuse stepping while `dictate.dictation.armed || dictate.readOnly`; preferably apply the same rule to Previous, Next, and the list, or explicitly stop/cancel the dictation before any deliberate move. Test both armed and transcribing states with an empty box so the ordinary draft guard cannot make the test pass accidentally. The ordinary definition is otherwise right: a non-empty failed/marking attempt is still unmarked, a `done` attempt is current only when `typed.trim() === mine.answer`, and an emptied box contains no draft to lose.

3. **P2 — The planned disabled-state test cannot distinguish the required implementation from the one it is replacing.** The plan requires native `disabled` to become `aria-disabled` so the tooltip remains focusable, but the in-progress `off` helper deliberately accepts either (`b.disabled || aria-disabled`) (`tests/quiz-panel.test.tsx:184`). A regression that leaves the buttons natively disabled therefore stays green. Nor does the proposed test activate an unavailable step button to prove its handler is inert. Fix: on a boundary and while marking, assert `button.disabled === false` and `aria-disabled === "true"`, dispatch click/Enter, and assert that the question and attempt did not move. `IconButton` itself currently swallows the click correctly (`src/web/IconButton.tsx:98`); the missing part is proving these callers preserve that contract.

4. **P2 — Turning Recall | Quiz into unexplained icons is not minimal on touch.** `Speech` and `GraduationCap` are new local vocabulary, and the explanatory words are only in an ordinary hover/focus tooltip (`docs/plans/260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md:40`). This tooltip design explicitly says a hover-only card does not exist on touch (`src/web/Tooltip.tsx:109`); `aria-label` helps assistive technology, not a sighted iPad reader. The chevrons and list are conventional enough to stand alone, but the difference between “say what you took from it” and “the article asks” is not carried reliably by those two glyphs. Fix: take the simpler version Greg's “maybe remember” leaves open—keep `Recall | Quiz` as words and iconify only the quiz navigation—or retain short visible labels on coarse pointers and add a real touch check.

5. **P3 — Specify icon sizes; the current implementation inherits Lucide's 24px default inside a component designed around 14px glyphs.** `IconButton` is a fixed 28px square whose own contract describes a 14px glyph (`src/web/IconButton.tsx:112`), and every existing caller supplies `size={14}`. The in-progress quiz buttons use bare `<ChevronLeft />`, `<ChevronRight />`, and `<List />`, while both Remember icons are also bare (`src/web/QuizPanel.tsx:189`, `src/web/QuizPanel.tsx:878`). Fix: state and use explicit sizes—14px in `IconButton`, and a similarly deliberate header size for the sub-mode pair—then include the actual glyph bounds in the narrow-window browser check.

The stable-handler-through-a-ref design itself is sound: `onQuizKeys` is stable, the ref receives the latest committed quiz closure, layout cleanup clears the parent slot on unmount, and the mode checks keep stale Trajectory/Quiz controls mutually exclusive. There is no practical stale-closure or unmount-event race in that shape. The focused `quiz-panel`, `keynav-horizontal`, and arming tests passed (78 tests); the findings above are cases those tests do not currently exercise.
