Found six issues and fixed them.

### Findings

- **F8 — P1 — established:** An unscored quote said both “the higher it scored” and “Not scored.” The card now says scored quotes use their higher available score, while unscored quotes use the lightest purple.
- **F9 — P1 — established:** Help promised both scores under *prioritised* and one under each single-score order. `rowScores` may return zero, one, or two. Help now says “every available score” and qualifies missing scores.
- **F10 — P1 — established:** ⌘/Ctrl/Shift/Alt-clicking Help closed the card in the current article even though navigation belonged to the browser. The handler now closes only for an unmodified current-tab activation.
- **F11 — P1 — established:** Help said Quotes showed “what the author put best,” contradicting the authoritative contract that authorship cannot be proved. Reworded to “which passages are best put.”
- **F12 — P1 — established:** Help claimed every row’s `(i)` explains why it was chosen, although `Quote.reason` is optional. It now distinguishes the optional reason from the always-present provenance.
- **F13 — P3 — established:** `quotes.md` called the explanation “one sentence,” although it is a two-sentence paragraph. Corrected to “one paragraph.”

Plain-click navigation leaves no established timer or focus residue: the card closes immediately, route navigation unmounts the reader, and hook cleanup cancels timers/listeners. The existing test advances another second and confirms the card does not return.

### Requested mutations

| Mutation | Tests notice? |
|---|---:|
| Delete paragraph | Yes — 3 failures |
| Move below scores | Yes — 2 failures |
| Remove `onClick={onClose}` | Yes — 1 failure |
| Change Help `href` | Yes — 2 failures |

### Verification

- Three requested suites: **63/63 passed**
- Typecheck: all four projects passed; all **3,336** source files covered
- `git diff --check`: passed
- `npm run typecheck` itself was blocked before execution by the sandbox denying `tsx`’s IPC pipe. Running the same script through `node --import tsx scripts/typecheck.ts` passed.
- No browser testing performed, as requested.
- No commit made.

Changed files:

- [ProseHoverCard.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/ProseHoverCard.tsx:1687)
- [help-modes.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/src/web/help/help-modes.tsx:603)
- [quote-hover-card.test.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/tests/quote-hover-card.test.tsx:215)
- [help-page.test.tsx](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/tests/help-page.test.tsx:241)
- [quotes.md](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/project/quotes.md:402)
- [261006j plan](/var/tmp/spideryarn-worktrees/qi-c2dbrccn-tooltip-for-quotes/docs/plans/261006j-the-card-on-a-quote-in-the-prose-says-what-a-quote-is.md:41)

I did not touch the untracked review-output or browser-screenshot files.

VERDICT: ship with the fixes I made