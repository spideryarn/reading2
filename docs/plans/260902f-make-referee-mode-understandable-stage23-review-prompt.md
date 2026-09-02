# Review prompt — Stages 2 and 3, Referee mode's explanations

You have reviewed this work twice: the plan (*do not build as written*) and the stage 1 code (*ship
with changes*, twelve findings, all acted on). This is the final code review of the remaining two
stages. **Weight it higher than the plan-stage one** — a plan review cannot find a control whose
tooltip is unreachable exactly when it is needed.

Repository root is the current directory (a git worktree). The scoped diff for these two stages is at
`/tmp/claude-1000/-home-greg-code-spideryarn2/a4050f5f-51fd-4db5-acf6-5bbf91c54fff/scratchpad/stage23.diff`
(3,414 lines). Read it, then the files it touches, then judge. Stage 1 is committed and already
reviewed; do not re-litigate it except where stages 2 or 3 have made something in it wrong.

## The plan and what these stages were for

`docs/plans/260902f-make-referee-mode-understandable.md` — § *Stage 2* and § *Stage 3* are the
contract; each records what actually landed and where it deviated.

Greg's ask: *"The new Referee mode is very confusing. Add lots of explanatory tooltips to buttons
etc."* The mode had zero tooltips. Stage 2 added ~30 `ControlTip` cards and changed four labels.
Stage 3 added a dismissible "How Referee mode works" card, put Candidates' opening model call behind
a button, and closed two gaps stage 2 found in itself.

## Attack these specifically

1. **Is the explanation load actually lower?** A referee opening `?mode=referee` cold now meets: a
   confidentiality notice, a source-scan notice, four chips, a "How this works" card, a tick
   sentence, a rank sentence, and a colour key. Count what is on screen before anything is pressed.
   Is this *more* confusing than what it replaced? If so, say what should go. Be willing to say the
   card is a net loss.
2. **`ControlTip`'s rule** is that the second sentence is what a press would not have told you. Find
   every card in the diff whose second sentence merely restates the first, or whose first sentence
   restates the visible label. Name them.
3. **Reachability.** `src/web/CriteriaPanel.tsx`'s Run button moved from `disabled` to
   `aria-disabled` so its card is reachable when the form is incomplete, with activation blocked in
   the form's `onSubmit`. Check that: can it still be activated by click, Enter, Space, or a form
   submit from another control? Is it still announced as unavailable? Are there other `disabled`
   controls in this mode whose card is now dead when it is most wanted?
4. **The rank numeral's card is hover-only** — a `<span>` inside a button. Stage 3 added a visible
   line instead. Is the line true, and is the card now redundant or contradictory?
5. **`localStorage`.** `src/web/referee-card.ts` and `src/web/RefereeCard.tsx`. Check the guards
   against `src/web/install-hint.ts` (it throws outright in some browsers rather than returning
   null). Check the dismissal really is *one* bit — that reopening clears it rather than setting a
   second flag. Check SSR/first-paint: is there a state where the card flashes in and then
   disappears, or the reverse? `RefereeBand`'s docstring used to say localStorage was banned outright
   and has been changed; is the new distinction it draws honest, and does it contradict anything else
   in the repo?
6. **Candidates.** The opening `useEffect` is gone and a button calls `startBrief`. Check there is no
   path that still fires a model call on open — a remount, a `?referee=candidates` deep link, a
   restored thread, a second panel instance. Check the cost wording is true: does it make exactly one
   model call, and does the search really reach a third party?
7. **`ANSWER_OVERFLOWED` in `src/messages.ts`** was changed because it advised narrowing where three
   of its four callers have nothing to narrow. Check every caller, and check the new wording is true
   for all of them.
8. **The four label changes** — `KIND_LABEL.diverging` "Two ends" → "For / against"; Mirror's two
   badges gaining "A kind"; Mirror's native `title` becoming a `Tooltip`. Are they right, and did any
   test, doc or copy test go stale against them?
9. **The tests.** `tests/referee-tooltips.test.tsx`, `referee-how-card.test.tsx`,
   `referee-candidates-press.test.tsx`, `referee-criteria-explained.test.tsx`. Several assert against
   **source text** rather than a render (card placement, stylesheet rules), which is a real weakness.
   Say which of those could pass over a genuine regression. Is there a mutation to stages 2 or 3 that
   leaves the whole suite green?
10. Anything you would refuse to ship.

## Evidence

`npm run typecheck` clean. `npm test`: **4 files / 4 tests red**, all four already red before this
work (`doc-links` — one broken link in an unrelated August plan; `pdf-bundle-trace`;
`store-artefact-manifest`; `store-roundtrip`). A fifth slot flakes run to run against the shared local
Postgres and a loaded box (`routes`, `chat-web-links` seen once each); those pass in isolation.
Mutating `KIND_LABEL.diverging` back to "Two ends" turns a test red, so the copy is genuinely pinned.

A browser pass over all four sub-modes is running in parallel and its findings are not in this prompt.

Answer with a verdict — **ship / ship with changes / do not ship** — then numbered findings, most
serious first, each naming the file and line and what you would do instead. Do not summarise the
change back to me.
