# Quiz: Answer as an icon, the whole answer on screen, and Next under the mark

**Status: built in one stage; GPT Sol's code review and the browser check follow below.** Evidence: `tests/quiz-panel.test.tsx` § "the answer box" and § "Next is the thing to press once the answer is marked", seen red (11 failing) before the change. Where §§ 1–3 and § After GPT Sol's plan review differ, the later section is what was built.

**Was: plan, not built.** Three reports from Greg, 2026-10-03, all filed from Quiz on the Entropy
article, all confirmed as an admin's by `scripts/feedback-reporter.ts` (exit 0 on each).

## What Greg said

spya-fzgcqu:

> In quiz mode, replace the answer text label with, you know, an icon and a tooltip, just as we do
> with other places in the chat or whatever. And look for anywhere else where we have a button with
> a text label that could be an icon plus tooltip instead. And I think we say something in our, you
> know, design documents that we prefer icons plus tooltips because there's so much text already on
> this page that adding more, well, it means the buttons don't stick out as much and it's just
> overwhelming.

spya-qnrxuw:

> Quiz mode. If I provide an answer, show the whole answer and don't put my answer in a scrollable
> box.

spya-smev24:

> In quiz mode, so it asked me a question, I gave an answer, it then critiqued my answer. That's all
> great. But then I was expecting there to be a button at the bottom underneath, sort of for, you
> know, next question, and perhaps even previous question, I'm not sure.

## What is there now (measured, 2026-10-03, local `fowler-phrenology`, three widths)

A Sonnet browser run at 1440x900, 820x1180 and 390x844, before any change:

- **The answer box scrolls.** `textarea.quiz-answer` is `rows={4}`, 102px tall, and a ~120-word
  answer has `scrollHeight` 276 / 669 / 451px. Reproduced at every width.
- **A Next control exists and is on screen after the mark**, at every width. But it is a 16px grey
  chevron (`oklch(0.63 0 0)` on `oklch(0.19 0 0)`) in a 28px box, and it sits *below* "Show a
  reference answer", not under the critique. So the report is not a missing control; it is one that
  does not read as the thing to press next, in a place Greg did not look.
- The Answer button is the text button `gloss-run`: "Answer" / "Marking…" / "Try again".

## The change — one stage, all in the Quiz band

Files: `src/web/QuizPanel.tsx`, `src/web/styles/quiz.css`, `tests/quiz-panel.test.tsx`,
`docs/project/quiz.md`, `docs/project/icons.md`.

### 1. Answer is chat's send button

The same control chat's composer draws (`ChatPanel.tsx` § `Composer`, `.chat-send` in
`mode-band.css`): `SendHorizontal` at 18 in the 36px box, filled orange when it can be pressed,
`LoaderCircle` while the mark arrives. Its words move to a `ControlTip` card — head *Answer* (or
*Try again* in the one state that label exists for), what: the shortcut (⌘/Ctrl+Enter, which the box
already takes). `aria-label` is the same word the button used to show, so the tests' `buttons("Answer")`
and the mark's note (*"Press Answer to have the new one marked"*) still name a real control.

- `aria-disabled` and a refused click, not native `disabled`, so the card opens on an empty box —
  chat's reason (tooltips.md). `submit` already refuses every state the button is disabled for
  (empty, too long, marking, stale, both microphone states), so an `aria-disabled` press reaches a
  guard that says no; the one new refused state (§ 3) is added to `submit` as well as to the button.
- `.chat-send`'s filled style is keyed on `[type="submit"]`. So the action row becomes a small
  `<form onSubmit>` holding the button and the microphone, and the button is a real submit. Passed
  over: widening chat's selector to `:not(.stop)` — it edits chat's CSS for the quiz's benefit.

**This overrules a sentence in quiz.md** (*"Answer is the one real action and the mark's note names
it"*, kept as words on 2026-09-30). Greg's report is newer and names this button; the doc changes.

**Kept as words, for now** (question for Greg in the debrief): *Show a reference answer* — quiz.md
says the indefinite article is the point — and the microphone's *Talk*, labelled on purpose because
talking is what the band wants (quiz.css § `.quiz-mic`).

### 2. The box grows with the answer

Chat's own mechanism: a layout effect on the value that sets `height: auto` then
`height: scrollHeight`. No roof — "show the whole answer" — and `rows={4}` stays the floor.
`overflow-y: hidden` and `resize: none` on `.quiz-answer`, since the height is no longer the
reader's to drag. The band (`.quiz-one`) already scrolls, so a long answer scrolls the band, not a
box inside it.

Passed over: `field-sizing: content`, one CSS line, already used by `.cmt-note` and the annotate
dialog. Firefox has no support and Safari's is recent; Greg reads on an iPad, and a fix that
silently does nothing there is the failure this report is about.

### 3. Next, under the mark, as the thing to press

- **The step row moves up**: directly under the mark (under the action row when there is no mark
  yet), above *Show a reference answer*. One row, not a second Next.
- **Once the mark is `done` and is about the words in the box**, Next takes the primary style
  (the same filled orange 36px box) — the answer is marked, so the next thing to do is go on.
  Previous and the list stay the quiet icons they are. Nothing else about Next changes: same
  `goNext`, same wait while the mark arrives, same tooltip, same premise rule.
- **In that same state the Answer button goes `aria-disabled`**, card: *"Marked. Change your answer
  to have it marked again."* Otherwise there are two orange buttons and the first re-buys a mark of
  the identical words. Editing the box (the existing `superseded`) lights Answer again and returns
  Next to quiet. A failed mark is not `done`, so *Try again* is untouched.
  Passed over: leaving Answer lit — simpler by one condition, but it leaves two primaries.
- On the last question there is no Next to promote; nothing is drawn in its place.

Not built: a word on the Next button ("Next question"). Greg asked for icons over words in the same
breath; the promoted style is what makes it findable.

## Tests (red first, in `tests/quiz-panel.test.tsx`)

1. Answer has no visible text; `aria-label` Answer; an empty box makes it `aria-disabled`, not
   natively disabled; a click while refused marks nothing.
2. With `scrollHeight` stubbed on the textarea, typing sets `style.height` to it.
3. After a `done` mark matching the box: the step row precedes the reference-answer disclosure in
   document order; Next carries the primary class; Answer is `aria-disabled` and a press marks
   nothing. After an edit: Next is quiet, Answer is live. While `marking`: Next not primary.
4. The existing suite stays green (the grading-words assertion, the batch reset, the mic guards).

Then a mutation at the end (drop the promote condition; drop the grow effect) to see each go red.

## Browser check

Sonnet, Playwright on the box, the same three widths and the same article as the "before" run:
the box grows with a long answer and has no inner scrollbar; the send icon is drawn and its card
opens; after a mark Next is orange and directly under the critique; nothing overflows the 287px
iPad band.

## Deferred, with its own queue entry: the rest of the sweep

Greg's *"look for anywhere else"* was run as a read-only sweep of `src/web` (about 150 button
sites). Roughly forty are clear candidates, in a dozen files other sessions are working in, so they
are a separate job rather than a rider on this one. The list, for whoever takes it:

- **One component, about 25 sites:** `JobProgress`'s idle re-run label ("Find them again", "Write
  them again", …) and its Retry — convert the component once (`RotateCw`).
- **"Try again" after a failure**, ten panels: CommentDialog, CriteriaPanel, FaqPanel, SkimPanel,
  SimplePanel, Tweets, ClaimsPanel, DiagramPanel, DictationStrip, live/LiveStatus.
- **Hover-card exits whose icon is already drawn beside the word** (`ProseHoverCard`: go there, go
  to the note, in the glossary, add to Spideryarn, open in Quotes) — the rule's own example.
- **Chat:** Latest, New conversation (ChatPanel, ChatDialog), Open in full chat, ChatDialog's Stop;
  CandidatesPanel's Stop and Ask.
- **Icon already present, drop the word:** Sketch/Illustrated Enlarge, Close, Back; Skim's All
  stops and Next stop ›; Debate more/less; CitationInvestigation Show less / Read all, Dig deeper
  again; Glossary Hide/Unhide, Find terms again; FoldToggle Fold all.
- **Arguable, wants Greg:** the voice-call states in LiveStatus, Ask in chat, Dig deeper, Look up,
  flesh out, More detail ›, How this works.
- **Keeps its words:** every first-run job button (*Plan the route* is the doc's named exception),
  the Recall | Tutorial | Quiz switch, sort and view switchers, anything whose label is content.

Line numbers were read on 2026-10-03 at `428054781` and will drift; the sweep's tooltip column was
only partly verified, so check each site before converting.

## Questions for Greg (asked in the debrief, not waited on)

- **Q-quiz-words-left:** two controls in Quiz still carry words — *Show a reference answer* and the
  microphone's *Talk*. Convert them too?

## After GPT Sol's plan review (2026-10-03)

[The review](261003i-quiz-answer-icon-whole-answer-and-next-after-the-mark-review-sol.md), of
`ff19a98b1`: *build with changes*, four findings, all taken. They replace what §§ 1–3 say where the
two differ.

- **F1 (P1, reasoned): a height set only when the value changes hides words after a reflow** —
  type a long answer, then rotate the iPad, and more lines wrap inside a fixed height with the
  overflow hidden. So the box is re-measured when its **width** changes (a `ResizeObserver`) and
  when it mounts, as well as on every change to its value. The browser check uses the *same
  unchanged answer* across widths.
- **F2 (P2, established): three existing assertions need native `disabled` and one needs an
  unavailable Next on the last question.** Migrated to accessible names, `aria-disabled` and a
  refused press. The last question **keeps** its unavailable Next; nothing is removed there. Added:
  the shortcut submits, and Next's promotion is tested with the box matching the mark for a right,
  a wrong and an absent verdict — it must be the same in all three, since the verdict is not for
  showing.
- **F3 (P2, established): `IconButton` takes no `className`, and its Tailwind utilities outrank
  quiz.css.** So Next is one permanent local `<button>` that switches class — `IconButton`'s own
  quiet classes (exported as `ICON_BUTTON_CLASS`) or the primary box — rather than swapping
  component, which would drop keyboard focus at the moment the mark lands.
- **F4 (P2, reasoned): refusing to re-mark unchanged words is behaviour nobody asked for.** Dropped.
  Answer stays pressable after a mark and goes **quiet** (chat-send's outline, no fill) while a
  finished mark matches the box, so there is one filled button at a time: Answer before the mark,
  Next after it. No new guard in `submit`, no new copy. And no `<form>`: the fill is a local class,
  `quiz-go`, beside `chat-send`.
