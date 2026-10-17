You are reviewing CODE in the Spideryarn repo (this worktree), and you may fix what you find.

The work: plan docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md (read it all, including "After GPT Sol's plan review" — your own earlier review is docs/plans/261017d-figures-plan-review-sol.md — and "After the eval"). Skim's route (src/skim.ts, prompt skim/14) can now stop at a figure between quotes. A figure is stored in `Skim.figures` beside the quote `stops`, follows one quote (`after`) and is walked in that quote's own pass; `walkOf` (src/skim-passes.ts) merges them into one walk keyed by quote id or figure block id; the band (src/web/modes/skim/SkimMode.tsx, src/web/SkimPanel.tsx, src/web/skim-route.ts) walks the merged list. The pass-size repair (`growPasses`/`repairSizes`) now plans with figures counted; `validateFigures` and `trimFigures` are new. The eval is docs/investigations/261017b-skim-figures-as-stops-measured.md.

The scoped diff (src, tests, scripts) is docs/plans/261017d-figures-code-review.diff. Read the touched files in full where you need context.

Look hardest at:
1. Correctness of validateFigures / trimFigures / growPasses-with-figures / buildSkim ordering: can a stored route violate its own invariants (figure depth ≠ its anchor's depth, two figures after one quote, a figure on a pass the quotes do not offer, walked passes not growing, a figure whose anchor is not on the route)? Note buildSkim validates figures twice: once against the pre-repair route (only to count per pass), once against the final route.
2. Can `trimFigures` loop forever or drop the wrong figure? Is `grows` right for a route with an absent More?
3. The client: stop keys (quote id vs figure block id), `?stop=` deep links, arrival/flash (a figure has no passage), the door's cue, pips, follow-scroll and tooltip state keyed on `SkimRow.key`, the missing-figure row, the visitor band (which must stay quote-only — src/public/dto.ts is a listed security defence: do NOT edit it).
4. Freshness: skimInputHash now includes figures; loadSkim (src/store/pg.ts) compares hashes only for the current version. Any path where figures are computed from blocks without HTML (e.g. a store read that strips HTML) and so the hash silently differs between write and read?
5. The prompt text in SKIM_SYSTEM section 5 and the user message: contradictions with the code (e.g. anything still implying a figure has its own depth or can go before the first stop).
6. Tests that could not fail, or that pin the wrong thing.

Fix what is clearly a bug, inside these files, with a test that fails without the fix. Do not edit src/public/dto.ts, any security defence, .env files, or the database. Do not run the paid eval. Run `npm run typecheck` and `npx vitest run tests/skim tests/public-dto.test.ts` after any change.

Then write your report: numbered findings, each with severity (high/medium/low), file:line, what is wrong, and either "FIXED: <what you changed>" or "NOT FIXED: <why / what you recommend>". End with a one-line verdict: SHIP, SHIP-AFTER-FIXES (the fixes you made), or DO-NOT-SHIP.
