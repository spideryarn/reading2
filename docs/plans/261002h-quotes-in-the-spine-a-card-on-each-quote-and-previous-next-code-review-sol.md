P0: None.

P1:

- [Reader.tsx:1371](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/src/web/reader/Reader.tsx:1371) — A threshold-hidden Skim quote remained outlined but was absent from the hover-card map. **FIXED:** cards now derive from the actual merged prose marks in document order.
- [useQuoteMarks.ts:208](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/src/web/reader/useQuoteMarks.ts:208) — “Open in Quotes” on that quote could be cleared immediately by `hiddenSelection`. **FIXED:** `reveal` lowers the prioritised bar before opening the mode, using [QuotesPanel.tsx:550](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/src/web/QuotesPanel.tsx:550).

P2:

- [quote-hover-card.test.tsx:167](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/tests/quote-hover-card.test.tsx:167) and [spine-quote-strip.test.ts:87](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/tests/spine-quote-strip.test.ts:87) — Tests claimed mixed-hit, warm-swap, clamp, and paint-order coverage without asserting those properties. **FIXED:** added direct assertions.
- [quotes.md:344](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/docs/project/quotes.md:344), [ProseHoverCard.tsx:1618](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/src/web/ProseHoverCard.tsx:1618), and [QuotesPanel.tsx:566](/home/greg/code/spideryarn2/.claude/worktrees/fbyd2c47-quotes-spine-tooltip-nav/src/web/QuotesPanel.tsx:566) — Documentation/comments incorrectly said the prose card shared the band’s ordering and omitted Skim’s exception. **FIXED.**

No findings left unfixed.

Gates: 10 requested test files passed, 210 tests total; typecheck passed for all four projects; doc-links and `git diff --check` passed.

Files changed:

- `docs/project/quotes.md`
- `src/web/ProseHoverCard.tsx`
- `src/web/QuotesPanel.tsx`
- `src/web/reader/Reader.tsx`
- `src/web/reader/useQuoteMarks.ts`
- `tests/glossary-band-wiring.test.ts`
- `tests/quote-hover-card.test.tsx`
- `tests/quotes-step.test.ts`
- `tests/spine-quote-strip.test.ts`