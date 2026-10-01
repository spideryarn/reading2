# Probe P05, round: before
Task: add a tooltip, including its keyboard shortcut, to the Quotes mode's copy button.

## 1. Docs opened, in order
1. `CLAUDE.md` (AGENTS.md) - pointed to reading-view-overview and its children; did not itself name tooltips.
2. `docs/project/tooltips.md` - very helpful: `ControlTip`, `TipNote`, `keepSide`, and "A shortcut is named on its card" (the shortcut rule's single home).
3. `docs/project/quotes.md` (grep only) - decisive: "No copy button. Worth having; it needs a decision about whether it copies the quote, the quote and a citation, or a deep link."
4. `docs/project/keyboard.md` (grep only) - confirms no copy shortcut is documented; points back to tooltips.md.

## 2. Code files you would edit
Nothing yet. The task's premise appears false: `src/web/QuotesPanel.tsx` has no copy button and no clipboard code (grep for copy/clipboard finds nothing there). I would stop and ask Greg which of the three copy options he wants, and whether a shortcut is wanted at all, since none exists.
If he says go: `src/web/QuotesPanel.tsx` (button + `Tooltip`), a new test beside `tests/quotes-panel.test.ts`, and `docs/project/quotes.md` (remove the "No copy button" line).

## 3. Existing helpers/components to reuse
- `src/web/Tooltip.tsx` § `Tooltip`, `ControlTip` (head/state/what/how), `TipNote`, `keepSide`.
- `src/web/DiagramPanel.tsx` - the idiom to copy (chips in a `TooltipGroup`, `className="tip-soon"`, `keepSide`).
- `src/web/AnnotateDialog.tsx` § `CopyQuote` - copy-with-feedback, press-token pattern against stale promises.
- `src/web/BlockGutter.tsx` § `onCopy` - the same copied/failed pattern.
- No shared copy-to-clipboard helper found; I would write a small one or reuse CopyQuote's pattern.

## 4. Rules/policies I would follow
- A shortcut is named on its card, in prose, saying when the key does not work (`docs/project/tooltips.md`).
- `Tooltip`, never a `title=` attribute; `aria-disabled` if the control can be unavailable (`tooltips.md`).
- ControlTip: first sentence guessable, second the unguessable fact; no price named (`tooltips.md`).
- Reproduce with a failing test first; `npm test`, `npm run typecheck`, lint on touched files; GPT Sol review before commit (`CLAUDE.md`).
- Ask Greg before building the hard version when a product decision is open (`CLAUDE.md`, and the open decision in `quotes.md`).
- A new key binding goes through keynav's guards (`keyboard.md`); not read in depth.

## 5. Where you got lost
- The brief assumes a copy button exists; it does not. `docs/project/quotes.md` says so, but only in the last "not done" list at about line 763, which I found by grepping, not by following links.
- `tooltips.md` and `keyboard.md` do not list which controls lack shortcuts; "Not every shortcut has been checked" is all it says.
- Could not tell whether any other quotes-related copy (Plain-mode annotate dialog `CopyQuote`) is what the task means. It has the tooltip as a native `title`, and no shortcut.

## 6. Confidence
5/10 that I found everything. High confidence (8) that no Quotes copy button exists, low on what the task intended.
