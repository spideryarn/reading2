# Code review brief: Referee panels' how-to-read sentences behind a tap-to-open button

You are reviewing uncommitted work in this git worktree. See it with `git status` and
`git diff HEAD` (plus the two new files under `docs/plans/261003m-*`). Do not run any git command
that discards work, do not commit, do not push, and never run `npm run deploy`.

## What the work is

Read first: `docs/plans/261003m-referee-panels-how-to-read-sentences-behind-a-tap-to-open-button.md`
(the plan), then `docs/project/referee-mode.md` § "How to read a panel" and
`docs/project/tooltips.md` (the house tooltip machinery; `BandAbout.tsx` is the tap-to-open pattern
being copied).

Greg chose to move four how-to-read sentences out of the Referee panels (Criteria ×2, Claims,
Mirror) into a card behind a small *How to read this* button at the end of each panel's lead line.
The hard requirement: **these sentences must still reach a touch reader, one tap away, never gone.**
Also one clause of `MODE_CATALOG.referee.how` in `src/mode-catalog.ts` was reworded because
"the sub-modes inside arm themselves" stopped being true (only Claims starts on its chip; see
`REFEREE_TARGET` in `src/web/activation.ts`).

## What to check, in this order

1. **Does a tap really open and shut the card?** `HowToRead` in
   `src/web/modes/referee/RefereeMode.tsx` is a controlled `Tooltip` (`src/web/Tooltip.tsx`) with
   `open` / `onOpenChange` and an `onClick` toggle. Trace the real event sequence for (a) a touch
   tap, (b) a mouse hover then click, (c) keyboard focus then Enter, (d) a tap outside, (e) Escape.
   Is there any sequence where the click toggles the card straight back shut (for example focus
   opens it, then the click that caused the focus closes it), or where it cannot be shut? Compare
   with `BandAbout.tsx`, which has the same shape and ships; say whether any fault you find is
   shared with it or new here.
2. **Is the mode-catalog sentence true?** Read it against `src/web/activation.ts`
   (`REFEREE_TARGET`, `armActivationForRefereeView`) and the chip `onClick` in `RefereeMode.tsx`.
   Is "inside, only Claims starts a run when its chip is pressed" (the wording at the time of this
   review; it changed afterwards) accurate, including when a claims
   run already exists? Is there a smaller wording that is true? The catalog rule is in
   `docs/project/mode.md` § The card on the button.
3. **Is anything lost?** Each of the four sentences must appear exactly once in the client: in the
   card. Check no panel still prints one, no test still expects one visible, and that the sentences
   are word-for-word what they were (`git diff HEAD` shows the old text).
4. **Are the tests real?** `tests/referee-notices.test.tsx` § "one press away" is new; three other
   test files changed from asserting presence to asserting absence. Try mutations: remove a sentence
   from `REFEREE_HOW_TO_READ`; remove the `onClick`; make `HowToRead` uncontrolled; drop the
   `key={view}`; put a sentence back in a panel. Report any mutation the suite does not catch, and
   add a test for it.
5. **Stale words.** Any comment, doc (`docs/project/`), Help page text (`src/web/help/`) or test
   docblock that still says one of these sentences is visible text at the top of a panel, or that
   the sub-modes arm themselves.
6. **Accessibility.** A `<button>` inside a `<p>`; `aria-expanded` together with the tooltip role's
   `aria-describedby`; whether a screen-reader user can reach the sentences.
7. CSS in `src/web/styles/referee.css` (`.ref-rules`, `.ref-rules-card`): anything that would
   overflow a 390px-wide band, or a dead rule left behind.

## What to do with what you find

Fix what is inside this stage's scope directly in the working tree (the files in the diff, their
tests, their docs). Report anything wider and leave it. After any fix run
`npx vitest run tests/referee-notices.test.tsx tests/referee-criteria-explained.test.tsx tests/referee-criteria-panel.test.tsx tests/referee-claims-panel.test.tsx tests/referee-tooltips.test.tsx tests/dock-mode-tooltips.test.tsx`
and `npm run typecheck`.

## What to write back

A verdict line first (*land*, *land after fixes (made)*, or *do not land*), then numbered findings,
each with: severity, file and line, what is wrong, how you know (a traced path or a test you ran,
not a guess), and whether you fixed it. Then the list of mutations you tried and which were caught.
Say plainly what you did not check.
