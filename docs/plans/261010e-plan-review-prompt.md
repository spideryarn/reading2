You are reviewing a PLAN (read-only) in the Spideryarn repo at the current working directory.

Plan: docs/plans/261010e-every-annotation-card-opens-its-mode.md. Read it first, then check it against the code:
src/web/ProseHoverCard.tsx (CiteCard, TermCard, QuoteCard, the card's selectors, tapSelector), src/web/useHoverCard.ts,
src/web/annotate.ts, src/web/reader/Reader.tsx (openBibliographyWork, openTermInGlossary, openOrigin, showBand,
quoteCard, the ProseHoverCard props near line 4717), src/web/item-focus.ts, src/web/CitationsPanel.tsx (focus prop),
src/web/TableView.tsx (onOpenComment, onOpenChat), docs/project/tooltips.md, citations.md, glossary.md, quotes.md, controls.md.

Answer:
1. Is the survey table accurate and complete? Any mark drawn on the prose that it misses or mis-describes?
2. Will each wiring do what the plan claims (lands the row in view, works when the band is "away", works on a phone where the band covers the prose, Back behaviour, visitors)? Name concrete failures.
3. Is "Open in <Mode>" shown also in its own mode the right call? Any case where the press would do nothing or something surprising?
4. Stage 2 (cards on mark.cmt and mark.chat): is it feasible within ProseHoverCard's delegated machinery — is the comment/thread data in reach, how does it interact with the click that opens the dialog, touch (tapSelector must NOT gain them), focus/keyboard, overlap with term/cite/quote on the same words? Should it be cut?
5. Anything simpler.

Write findings numbered F1.., each with severity (high/medium/low), evidence (file:line), and a recommended change. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK.
