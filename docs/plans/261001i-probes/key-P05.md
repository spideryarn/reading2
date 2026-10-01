# Answer key P05: a tooltip, with its shortcut, on the Quotes mode's copy button

Nearest landed work: `260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md`
(the shortcut-on-the-card rule), with `260930h-tweets-band-fits-ipad-and-copy-buttons-become-icons.md`
and `260930h-quiz-and-remember-controls-as-icons-arrow-keys-step-the-quiz.md` as the closest idioms.

**The premise is false, and finding that out is the main score.** `src/web/QuotesPanel.tsx` has no
copy button, no clipboard code, and Quotes has no keyboard shortcut. `docs/project/quotes.md` says so
in its not-done list: "No copy button. Worth having; it needs a decision about whether it copies the
quote, the quote and a citation, or a deep link." The ideal agent stops and asks Greg (what it copies;
whether a key is wanted at all, and which), explained plainly, rather than inventing either.

## 1. Docs it must read
- MUST `docs/project/tooltips.md` § "A shortcut is named on its card" (the single home of the rule; say when the key does not work; `aria-disabled` not `disabled`; hover/focus cards on touch).
- MUST `docs/project/tooltips.md` § "`ControlTip`, which is what most of them are now" (first sentence guessable, second not; the `TooltipGroup` + `tip-soon` + `keepSide` row idiom) and § "Five things that are load-bearing" (trigger must forward its ref).
- MUST `docs/project/quotes.md` § the not-done list ("No copy button") - the open product decision.
- MUST `docs/project/icons.md` § "Navigation: an icon with a tooltip, not a text label" (every icon has a tooltip; icon + `aria-label`, no text).
- MUST `docs/project/keyboard.md` § "← / → in Quiz", § "Five rules, each with a reason", § "G, the one letter" - if a key is added: the guards (no modifier, no auto-repeat, not while typing, `defaultPrevented`, not inside a dialog). The app has exactly one letter shortcut today, so a new one is a product decision.
- USEFUL `docs/project/touch.md` (a tap copies at once; no reveal-then-commit for a harmless act).
- USEFUL `docs/reusable/silent-success.md` (a copy that silently fails).

## 2. Existing code to reuse
- `src/web/Tooltip.tsx` § `Tooltip`, `ControlTip`, `TipNote`, `TooltipGroup`, `enabled` prop. Trap: a `title=` attribute (forbidden; tests assert they are gone) or a hand-rolled hover card.
- `src/web/Tweets.tsx` § `CopyButton` - the icon copy button with tooltip, idle/done/failed state, a visible "Couldn't copy" on refusal, `aria-live` status sibling, `enabled={state==="idle"}`, no `navigator.clipboard?.` (silently does nothing). Not exported today: the right move is to lift it into a shared component, not write a third copy. Trap: a fresh `navigator.clipboard.writeText` with no failure state.
- `src/web/AnnotateDialog.tsx` § `CopyQuote` and `src/web/BlockGutter.tsx` § `onCopy` - two more copy-with-feedback implementations (stale-promise token). Evidence the helper is already duplicated.
- `src/web/keynav.ts` § `useArrowNav` (the mode-specific handler seam, after every guard) and `src/web/TermJump.tsx` (how the one letter key G is guarded) - if a key is added. Trap: a raw `window` keydown listener that fires while typing.
- `@/components/ui/button` § `Button` (shadcn) with `size="icon-xs"` and `tw:pointer-coarse:size-10` (as `CopyButton` uses).

## 3. Code files it would edit
`src/web/QuotesPanel.tsx`; the shared copy component (lifted out of `src/web/Tweets.tsx`); `src/web/keynav.ts` / `src/web/Reader.tsx` only if a key is agreed; tests beside `tests/quotes-panel.test.ts`; `docs/project/quotes.md` (strike "No copy button"), `docs/project/tooltips.md` (add Quotes to the list of cards that name a key), `docs/project/keyboard.md` (the new key).

## 4. Project rules that apply
- Ask Greg before building a product decision that is still open; explain the options plainly (`CLAUDE.md` § Explain plainly; `docs/project/quotes.md`).
- Failing test first: hover/focus opens exactly one card naming the key; no `title` (`CLAUDE.md`; the 260930h tests in `tests/trajectory-panel.test.tsx` are the template).
- Card copy rule and the shortcut rule (`docs/project/tooltips.md`). Card prose is checked for false sentences by a cross-family review, not tests (`tooltips.md` § the shelf's action row).
- Every icon has a tooltip (`docs/project/icons.md`).
- `npm test`, `npm run typecheck`, lint on touched files; GPT Sol plan + code review (`CLAUDE.md`; `docs/reusable/codex-cli-as-subagent.md`).
- Browser check in a Sonnet subagent (`docs/project/browser-control.md`, `docs/project/tooltips.md` § "Checking it in a browser").
- Work in a worktree, push to `dev` (`docs/project/worktrees.md`).

## 5. Traps (from the landed plans)
- Say when the key does not work: 260930h's first draft "Or press ←" was false while a text box had focus or the Dock drawer was open; it became "While reading, press ←." (260930h § code review).
- A natively `disabled` button opens no card; use `aria-disabled` (260930h § Not done; `tooltips.md`).
- Close the card while the tick/failure shows with `enabled`, not a conditional wrapper, which remounts and drops focus; an open card sat over the post above on WebKit (260930h-tweets, `Tweets.tsx` § `CopyButton`).
- A key must not fire inside a dialog or after `preventDefault` (`keyboard.md` § ← / → in Quiz).
- Decide what is copied: a quote loose on the internet with no source is a vision anti-goal; Tweets' `threadMarkdown` carries the title and URL for that reason (`src/web/Tweets.tsx`).
