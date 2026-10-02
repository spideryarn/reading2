You are doing the code review of commit 6343ec26c in the Spideryarn repo (cwd, a git worktree). See it with `git show 6343ec26c` (or `git diff HEAD~1 HEAD` if HEAD is still that commit).

The plan, including your own earlier plan review and what it changed, is docs/plans/261002h-quotes-in-the-spine-a-card-on-each-quote-and-previous-next.md. Read it first.

The house workflow: **fix what you find inside this change**, directly in the working tree (do not commit, do not run any git command that changes history, the index or other files — no stash, reset, checkout, restore, clean). Report anything wider than this change for me to decide. Keep fixes minimal and in the surrounding code's style (comment density, naming).

What to check hardest:
1. src/web/reader/Reader.tsx — `quoteRail` from `proseMarked`, `hitBlocks` via `railFound`, `steppable`/`goToQuote`/`quoteKeys`/`quoteCard`, the `useArrowNav` handler order (skim ?? quiz ?? quotes), `bandJump` vs `jumpTo`, and the `QuotesBand`/`VisitorQuotesBand` `steps` prop. Is any memo dependency wrong, any identity churn that re-renders `memo(TableView)` or `Spine` on scroll?
2. src/web/reader/useQuoteMarks.ts — `steppable`, and whether the `hiddenSelection` effect or a stale `?quote=` can fight stepping.
3. src/web/ProseHoverCard.tsx — `read` (quote keys), the `openDelay`, `QuoteCard` (scores, reason in the model's voice, ‹ › at ends, open in Quotes), the label, the `divided` change. And src/web/useHoverCard.ts `arm`'s new `"cold"` path: any route where a cold open now uses the wrong delay, or a warm swap is slowed.
4. src/web/QuotesPanel.tsx — `stepQuote`, `QuoteStepper` (labels, disabled state, live region, tooltips via the moved `StepTip`), the scroll-into-view layout effect (hooks order, CSS.escape, list not scrolling the page), the foot fragment for owner and visitor and its interaction with ModeSurface's foot (should render nothing extra when there are no quotes).
5. Spine.tsx / spine-marks.ts / spine.css — the strip, its clamp, paint order.
6. Tests: tests/quote-hover-card.test.tsx, tests/quotes-step.test.ts, tests/spine-quote-strip.test.ts, and the updated tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx and tests/glossary-band-wiring.test.ts. Do they assert the claim or a weaker one?
7. Docs: docs/project/quotes.md § In the spine, on a card, and one at a time; keyboard.md § ← / → in Quotes; tooltips.md; src/web/help/*. Anything stated that the code does not do?

Gates you can run: `npm run typecheck`, and `npx vitest run <files>` for the test files above and tests/skim-panel.test.tsx tests/keynav-horizontal.test.ts tests/citation-hover-card.test.tsx tests/doc-links.test.ts tests/help-page.test.tsx. Do not run the full suite (the box is shared).

Write your answer as: findings ranked P0/P1/P2 with file:line, and for each whether you FIXED it (and how) or LEFT it (and why). Then list exactly which files you changed. Be concise.
