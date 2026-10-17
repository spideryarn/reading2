You are reviewing a PLAN (not code) in the Spideryarn repo, at docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md.

Context: Skim mode walks a paper's Quotes in three passes (Gist, More, Most). The route is planned by one model call in src/skim.ts (prompt version skim/13), validated by validateRoute / growPasses / growthFailure / introsOf / buildSkim. The client walk is src/skim-passes.ts, src/web/skim-route.ts, src/web/modes/skim/SkimMode.tsx (useSkimMode), src/web/SkimPanel.tsx, and the separate Figures walk src/web/modes/skim/FiguresWalk.tsx + walk.ts. Figures are found by src/figures.ts (figuresOf). Types in src/types.ts (SkimStop, Skim, SkimDrops). Store freshness in src/store/pg.ts loadSkim. Public DTO src/public/dto.ts (publicSkim) is a listed security defence we must not edit. Docs: docs/project/skim.md; prompting rules docs/project/prompting-guide.md.

Greg chose: figures as stops of their own between quotes (1B), with a cue saying why the figure is there, chosen by the model (2A). Read the plan and the code it touches. Review for:
1. Correctness holes: anything in the plan that would break existing routes, the growth rule, the walk (keys, ?stop= links, the door, arrival/flash, pips, carried stops), freshness/staleness, or the visitor band.
2. The data model choice (a separate `figures` list anchored by `after: quoteId`, versus a union inside `stops`). Is the anchor rule sound given validateRoute's dedupe (shallowest occurrence wins) and growPasses (moves stops between depths, keeps order)? Edge cases: figure before any quote, anchor quote moved to another depth, anchor dropped.
3. The pass-length decision (figures count toward walked length; quote targets unchanged; trimFigures backstop). Does trimFigures always terminate and always yield a passing route? Does introsOf/movedIntro need to know about trimmed figures?
4. The prompt/schema plan (anyOf items, required cue on figures, FIGURE_CAPS, "named beside" computation). Anything that will make the model worse at the quote route it does today?
5. The eval plan: is it enough to call this measured? What's missing?
6. Anything simpler that gives Greg the same thing.

Be concrete: cite file:line. Number your findings, give each a severity (high/medium/low), and say what you'd change. Do not edit any files. End with a one-line verdict: SHIP-AS-PLANNED, SHIP-WITH-CHANGES, or RETHINK.
