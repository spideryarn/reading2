# Code review: 261007h F3 (run buttons; text boxes in the bands)

**Candidate:** commit `e7ac789ee` in worktree `/var/tmp/spideryarn-worktrees/fbrgq3f6-design-consistency`.
`git show e7ac789ee --stat` lists every path; start with `src/web/components/ui/button.tsx`,
`src/web/styles/mode-band.css` § text boxes in the bands, `src/web/CriteriaPanel.tsx`,
`src/web/SearchPanel.tsx`, `src/web/GlossaryPanel.tsx`, `src/web/CitationInvestigation.tsx`. That
list does not limit scope. **Another builder may start on order chips and failure colours in this
worktree while you work; uncommitted changes outside this commit are theirs — ignore them.**

**Spec:** `docs/plans/261007h-design-system-refresh-controls-that-do-the-same-job-look-the-same-in-every-mode.md`
§ F3 and § "What GPT Sol's plan review changed" (R8–R10). Greg: *"controls that do the same job
should look the same in every mode, though use your judgment."*

## What to do

You may write. **Fix what is inside this commit's scope**, narrowly and red-first, and **report,
do not fix**, anything wider. Do not commit. Findings to the answer file first, then fixes, then
update the answer with what you changed.

Independent pass:

1. `button.tsx`'s new `aria-disabled` styling: which other shadcn `Button`s in the app carry
   `aria-disabled` or could, and does anything change for them? Is the hover really suppressed for
   `outline` and every other variant that could carry it? Does a press on an `aria-disabled` run
   still reach its guard (Criteria), with the tooltip still reachable by keyboard and touch?
2. Each moved run button: `type`, handler, icon, tooltip, disabled/busy state, placement
   (`align-self`, `margin-left: auto`, `width: 100%`) preserved? Any that is not actually a run
   button (e.g. Glossary's Find more vs Write a new list; Candidates' start vs send)?
3. The judgement call the orchestrator wants your view on: Glossary's opened entry now pairs a
   32px "Dig deeper" with a 28px `.gloss-btn` "Ask in chat"; Citations' "Dig deeper" was made
   `size="xs"` (24px) to sit beside its 25px "Ask in chat". So "Dig deeper" is 32 in one mode and
   24 in another. Is the better answer to give "Ask in chat" in both the same shadcn outline button
   as its neighbour (it is an action beside an action), so both rows agree at one size? Fix if
   narrow and clearly better; otherwise recommend.
4. Text boxes: the grouped rule's specificity against each mode's remaining rules and the 16px
   iOS floor in narrow-window.css; the reader face in voices.css; `resize` and autosizing; focus
   mark visible on each box in both themes (2px `--highlight-text`); any box whose ground was
   raised on purpose (Skim's purpose box); heights that grew (srch-input, gloss-ask-input, the
   poles) — does anything now overflow its row, especially Search at the ~288px band?
5. Tests: run `npx vitest run tests/run-buttons-and-text-boxes-agree.test.ts tests/referee-criteria-explained.test.tsx tests/touch-controls.test.ts tests/voices-css.test.ts tests/preflight-substitute.test.ts tests/part-switchers-share-one-bar.test.ts`.
   Does each new assertion fail if the change it names is undone?
6. Docs: controls.md's new rows and "three local edits"; referee-mode.md.

## Severity

P0 data loss / security / charging / broadly unusable · P1 user-visible wrong behaviour or a
contract violated · P2 design or maintainability risk · P3 prose. IDs `L1`, `L2`, …. Refuse only
on an established P0 or P1.

End with `VERDICT: ready` / `VERDICT: ready with these fixes` / `VERDICT: not ready`, and a list of
files you changed.
