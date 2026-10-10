You are reviewing CODE in the Spideryarn repo at the current working directory, and you may FIX what you find inside this stage (edit files directly). Report anything wider for me to decide.

Plan: docs/plans/261010d-every-annotation-card-opens-its-mode.md (and its plan review, docs/plans/261010d-plan-review-sol.md — you wrote that; check its findings were taken correctly).
The scoped diff: docs/plans/261010d-code-review.diff (b2f8edcf4..HEAD over src/ and tests/). Docs changed too: docs/project/tooltips.md (new section "Every card on a mode's mark has a way into its mode"), citations.md, glossary.md, quotes.md, sources.md.

Check in particular:
1. OpenInMode in src/web/ProseHoverCard.tsx and its three callers (TermCard, CiteCard, QuoteCard): correctness, the card closing before/after the press, accessibility (button name, icon aria-hidden), visitor paths (no citation button for a visitor; Skim's TermChip, which also renders TermCard with onOpen — does the new label or anything else break there?).
2. Reader.tsx: openTermAndLand (does termFocus survive the mode change into glossary — check focusesLeft in item-focus.ts and the effect order in Reader), quoteCard's onOpenInQuotes via showBand (deps correct, any history entry pushed twice?), onOpenCitedWork={owner ? openBibliographyWork : null}; the second-tap commit path in ProseHoverCard (onOpenTerm on touch) now also sets focus — fine?
3. VisitorGlossaryBand focus wiring.
4. CSS: .prose-card-foot-wraps / .prose-card-acts renames — any selector elsewhere (src/web/styles/*.css, tests) still naming the old classes; the cite foot now wraps — does `.prose-card-cite-foot` have rules that conflict?
5. Tests: do the new tests actually fail without the change (they were mutation-checked for glossary landing and visitor focus; check the citation and quote ones by reasoning)?
6. Docs: anything false in the new tooltips.md section against the code.

Run `npm run typecheck` and the touched test files (npx vitest run <files>) after any fix. Write your findings numbered C1.. with severity, evidence (file:line), and what you changed (or what you recommend). End with a one-line verdict: APPROVE, APPROVE WITH FIXES (made), or CHANGES NEEDED.
