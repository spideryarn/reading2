# Quiz and Remember controls as icons; ← / → step the quiz

**Status:** built, 2026-09-30. SPIDERYARN-READING2-71. Plan reviewed by GPT Sol (approve with
changes; § What the plan review changed).

> Make minimal UI tweaks to the quiz mode and maybe remember mode as well. For example, let's use
> icons instead of text labels, you know, perhaps with tooltips. And maybe add keyboard shortcuts,
> left and right, to move through the quiz questions.
>
> — Greg, 2026-09-30, SPIDERYARN-READING2-71

Minimal, as asked. It applies the rule already written in
[icons.md § Navigation](../project/icons.md) (*a control that takes you somewhere is an icon button,
its words in its tooltip and `aria-label`*) to the quiz, and reuses the ← / → seam that Trajectory
already has ([keyboard.md § ← / → in Trajectory](../project/keyboard.md)).

## What changes

### 1. Quiz's step row becomes three icon buttons

Today, under each question: `Previous` · `Next` · `Show all 12` / `Hide the list`, as words.

```
before:  [Previous] [Next]  Show all 12
after:   [‹] [›] [≡]          each with a tooltip: "Previous question (←)",
                               "Next question (→)", "Show all 12 questions" / "Hide the list"
```

- `ChevronLeft`, `ChevronRight` (Trajectory's stepper uses the same two), `List` for the list.
- Built with the existing [`IconButton`](../../src/web/IconButton.tsx) wrapped in a `Tooltip`
  (`titled={false}`, so no OS `title` races the card). That makes an unavailable button
  `aria-disabled` rather than natively `disabled`, which is what lets its tooltip still open —
  tooltips.md § `ControlTip` on the shelf's row. The click is refused in the handler, as
  `IconButton` already does.
- `aria-expanded` stays on the list button.

**Kept as words, on purpose** (icons.md § "Where we can"): **Answer** (the one real action here, and
the mark's note says "Press Answer"), **Show a reference answer** (the indefinite article *is* the
design — QuizPanel.tsx § `ReferenceAnswer`), and the *Only what I've read* tick-box.

### 2. Remember's Recall | Quiz switch keeps its words

The first draft made it two icons (`Speech`, `GraduationCap`). **Dropped on GPT Sol's plan review**:
on a touch screen the hover card never opens, so a sighted iPad reader would have two unexplained
glyphs, and "say what you took from it" versus "the article asks" is not something either glyph
carries. Greg's *"maybe remember mode as well"* left it open, so this takes the simpler reading. The
Recall half's own controls are `ConversationBand`, shared with Chat, and already icons. The chevrons
and the list icon are conventional enough to stand without their card.

### 3. ← / → step the quiz

While Remember is the mode, Quiz is the half showing and a question is on screen, **← is Previous and
→ is Next** — the same functions the buttons call, so the keys can do no more than the buttons.

**The seam is the one Trajectory already uses:** `useArrowNav`'s `horizontal` argument in
[`keynav.ts`](../../src/web/keynav.ts), which runs after every existing guard — no modifier, no
auto-repeat, not while focus is in a text box (`isTyping`), not when a widget already
`preventDefault`ed, and not while the bottom drawer is open. `Reader` holds one more piece of state,
the quiz's step handler, set by `QuizPanel` through `RememberBand` → `QuizSubBand` (an
`onArrowKeys` prop, mirroring Trajectory's `onControl`), and cleared on unmount — so leaving Quiz,
leaving Remember, or Recall being the half showing all leave ← / → with the browser, as in every
other mode.

The handler is **stable** (registered once, reading the latest `goNext` / previous through a ref), so
setting it does not re-render `Reader` on every quiz render.

**It answers `false` (the key goes back to the browser) when:**

- there is no next / previous question on the path (the ends — no wrap, Trajectory's rule);
- Next is waiting for a mark to finish (`canGoNext` false — the rule the button already has);
- **the microphone is recording or its transcript is on its way**, box empty or not (Sol's finding
  2): a browser that shows no rough words leaves the box empty while it listens, and the transcript
  lands after the move — under the next question;
- **the answer box holds words that have not been marked** (a draft, or an edit after the mark).
  This one is new and the keys only: the buttons still move and discard, as today. The textarea
  already stops its own key presses from bubbling, so arrows *inside* the box never reach this; the
  case is a reader who typed, clicked somewhere else on the page, and pressed → expecting nothing.
  A stray keypress should not throw away a half-written answer; a click on a labelled button is a
  deliberate act. Cheap to add, easy to remove if Greg finds it gets in the way.

### 4. Docs

- [keyboard.md](../project/keyboard.md): the status note and § ← / → in Trajectory become
  "Trajectory and Quiz"; one short subsection on the quiz's rules (above).
- [quiz.md](../project/quiz.md): one paragraph — icons, and the keys.
- [icons.md § Where they're used](../project/icons.md): the quiz row and the Remember switch.

**And not from inside a dialog** (Sol's finding 1), for Trajectory as well: `useArrowNav` ignores a
← / → whose target is inside `dialog` or `[role="dialog"]`. A comment's dialog focuses its Close
button, and a press there stepped the band behind it.

## Tests

- `tests/quiz-panel.test.tsx`: its `press`/`buttons` helpers find a button by visible text; they
  learn `aria-label` too, and the two `.disabled` checks become `aria-disabled` checks. New: a
  keypress test — mount the panel with an `onArrowKeys` spy, call the registered handler with ±1,
  check it moves, returns `false` at the ends, while marking, and with an unmarked draft.
- `tests/pressing-a-chip-arms-it.test.tsx`: unchanged in the end — the toggle kept its words.
- `tests/keynav-horizontal.test.ts` already pins that a handler takes the key and `null` leaves it;
  it gains the dialog case (§ 3). Wiring (Reader picks the quiz handler only in Remember) is one line,
  checked in a browser rather than a new test.
- Red first: the new keypress test is written before the handler exists.

## What the plan review changed

GPT Sol, read-only, `--sandbox review`: **approve with changes**, five findings. Its report was
written to `/tmp` because the review profile cannot write under `docs/plans/`, and is copied in
full into
[the -review-sol file](260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz-review-sol.md).

1. **P1, keys from inside a comment dialog stepped the band — taken.** A target-scoped dialog check in
   `keynav.ts`, red first in `tests/keynav-horizontal.test.ts`, both dialog shapes plus a control.
2. **P1, an empty in-flight dictation bypassed the draft rule — taken** for the keys; red first with
   the box empty so the draft rule cannot pass it. The buttons still move during dictation, as they
   did before this change; that is theirs and not in scope.
3. **P2, the tests accepted native `disabled` — taken.** `off()` now throws on a natively disabled
   step button, and a refused press is shown to run nothing.
4. **P2, Recall | Quiz as icons fails on touch — taken**, § 2.
5. **P3, icon sizes — not taken; its premise is wrong.** It says the icons inherit Lucide's 24px
   default, but `<LucideProvider size={16}>` in `main.tsx` sets 16, and the 390px screenshot shows it.

## Code review

GPT Sol, `--sandbox workspace-write`, on 4136fef4: **no functional findings.** It checked the
handler's lifecycle (Recall → Quiz, mode switches, a replaced batch, remount order), the refusal
rules, the dialog guard, the `IconButton` + `Tooltip` row, and whether each new test can fail. One
P3, fixed by it: comments in four files pointed at a section called "← / → in Trajectory and Quiz",
which the docs never used. Its focused run: 7 files, 118 tests passed; typecheck passed.

**Full suite** at 5fc7dcdf (after merging `origin/dev`): 1246 files passed, 5 failed, and all five
are a fresh worktree's missing build output — `api-dist/vercel.js` (cold-start-lazy-imports,
pdf-bundle-trace) and `tools/fleet/web/dist` (the three fleet route tests). None touches this change.

## Browser check

A Sonnet subagent, Playwright on the box, at 348c8573 plus the working tree, before the review
changes: every icon's tooltip, ← / → from the page, the caret moving inside the box, a draft kept
from a stray →, Recall leaving the keys alone, and no overflow at 390px — all passed. It saw the
count jump once from "1 of 2" to "6 of 7" after →, which it read as *Only what I've read* widening
while the page was open (reading time accrues as you read); the key calls the same `goNext` as the
button, so that is the filter's behaviour, not this change's.

## Passed over

- **A second window listener in `QuizPanel`** instead of the `horizontal` seam. Fewer props to
  thread, but it would duplicate every guard in `useArrowNav` (and could not see the drawer), which is
  the second-way-to-do-the-same-thing the house rules warn against.
- **Icons for Answer and the reference answer.** See § 1.
- **Recall's own controls.** Shared with Chat and already icons.
- **Icons for Recall | Quiz.** § 2.

## Deferred

- Naming the shortcut in the tooltip follows whatever convention reports 73 + 74 land (in flight on
  2026-09-30); until then it is "(←)" / "(→)" in the words, as Chat's "Cancel (Esc)" does.
- ↑ / ↓ stay the article's in Quiz, as everywhere.
