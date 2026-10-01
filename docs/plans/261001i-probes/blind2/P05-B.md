# P05 (after2): tooltip + shortcut on the Quotes mode's copy button

**Premise check: Quotes mode has no copy button.** `docs/project/quotes.md` says so twice ("What is not built — a copy button", and "No copy button" under § What is still open). `grep -i copy src/web/QuotesPanel.tsx` finds nothing. The only copy button is Tweets' private one. Quotes also has no keyboard shortcut for copying, so there is no key to name unless we invent one. I would stop and ask Greg before building a button plus a shortcut.

## 1. Docs opened, in order
- `AGENTS.md` (as CLAUDE.md): signposts; rules on tooltips not stated here.
- `docs/project/reading-view-overview.md`: found `tooltips.md`, `quotes.md`, `keyboard.md` in the map. Helped.
- `docs/project/tooltips.md`: very helpful. `ControlTip`, `TipNote`, the "A shortcut is named on its card" rule (keys go in the card's prose, no `keys` prop), the touch rule.
- `docs/project/quotes.md` (grep only): revealed the premise is false and pointed at `Tweets.tsx` `CopyButton`. Decisive.
- `docs/project/keyboard.md` (grep only): no Quotes copy key exists; the arrows belong to the article.

## 2. Code files I would edit
- `src/web/QuotesPanel.tsx` (add the button, wrapped in the tooltip).
- Possibly `src/web/Tweets.tsx` (only to export or extract `CopyButton`).
- `src/web/keynav.ts` (only if Greg wants a real shortcut).
- `docs/project/quotes.md` and `docs/project/keyboard.md` (update "not built" and the key list).

## 3. Existing helpers to reuse
- `src/web/Tweets.tsx` § `CopyButton`: clipboard write, tick and failure state, `aria-live` status, `enabled={state === "idle"}` tooltip, no reveal-then-commit on touch. It is private, so I would extract it to a shared file rather than write a second one.
- `src/web/Tooltip.tsx` § `Tooltip`, `ControlTip` (head, what, how), `TipNote`, `TooltipGroup`.
- `src/web/QuotesPanel.tsx` already imports `Tooltip` (the ⓘ card), so its idiom is there to copy.
- No new helper otherwise.

## 4. Rules and policies
- A control with a shortcut names it in its tooltip, in prose, e.g. "While reading, press X." Say when the key does not work (`keynav.ts` guards). From `tooltips.md` § A shortcut is named on its card.
- ControlTip: first sentence guessable, second sentence the unguessable fact. No restating the label. `tooltips.md`.
- Touch: copying is harmless, so tap copies at once (`touch.md` via the `Tweets.tsx` comment).
- Product decision first: copy the quote, the quote plus a citation, or a deep link (`quotes.md`). Ask Greg. Simplest first: copy the quote text.
- Tests: write the failing test first; run `npm test` and `npm run typecheck`; lint touched files. `AGENTS.md`.
- Cross-family GPT Sol review before commit; work in a worktree; commit own files by name and push to `dev`. `AGENTS.md`.
- Reader-facing strings go through `src/messages.ts`, with failure copy per `copy.md` (not opened).
- Never log article prose. `logging.md` via `AGENTS.md`.

## 5. Where I got lost
- The task assumed a button that does not exist. Only `quotes.md` told me; the overview and `tooltips.md` imply nothing either way.
- I expected `keyboard.md` to list a copy key; none exists, so "including its keyboard shortcut" has no referent.
- `tooltips.md` § Where the code is does not list the Quotes panel or the Tweets `CopyButton`. I found the latter only via `quotes.md`.

## 6. Confidence
7/10 on the plan. The open risk is that the task meant a different mode's copy button (Tweets) or expects a new shortcut.
