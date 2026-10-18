You are reviewing code in the Spideryarn repo, in the worktree you are running in. You may edit files to fix what you find, inside this change only; report anything wider for me to decide.

The plan: docs/plans/261018m-skim-figure-stops-cross-to-visitors.md (read it first, including § Reviews, which records your plan review's findings and what was done). The diff: docs/plans/261018m-code-review.diff (it is `git diff HEAD` of the working tree, which also has three untracked plan files).

What it does: Greg (the owner, an admin) answered "A" to docs/user-feedback/questions/q-gq0f4k.md, allowing exactly one field to be added to the public visitor payload: Skim's figure stops. `publicSkim` in src/public/dto.ts copies each `{blockId, depth, cue, after}` field by field; `PublicSkim` gains `figures?`; `VisitorSkimBand` walks them with `walkOf(route.stops, route.figures)`. The public DTO is a listed security defence (docs/project/security-map.md).

Please check, and fix where you can:
1. Does anything beyond the one allowed field cross, or could a future field on SkimFigureStop cross unasked? Is the projection exactly what the plan says?
2. Do the tests actually go red without the change? Try it: revert the DTO change (or the walkOf change in VisitorSkimBand) temporarily, run `npx vitest run tests/public-dto.test.ts tests/skim-figures.test.tsx`, check the right tests fail, then put the code back exactly. Also try `figures: [...(skim.figures ?? [])].map(...)` (always emitting the key) and a whole-object spread, and check a test catches each.
3. tests/public-visibility-pg.test.ts runs against the local Supabase: run it, and say if it passes.
4. Anything in the visitor client (SkimPanel, RouteWalk, useSkimMode, FiguresWalk, the Reader's public path) that would still keep a visitor from seeing or stepping to a figure stop, or that behaves differently for a visitor's figure stop (e.g. memo dependencies on `route.figures`).
5. Docs and comments: anything still saying visitors get no figures (grep src/ docs/project/ src/web/help/), and whether the security-map.md record is accurate.

Gates after any fix: `npm run typecheck`, and the vitest files above.

Write findings as a numbered list, each with severity (P1/P2/P3), file:line, what you changed (if anything) or the fix you propose. End with a one-line verdict: LAND, LAND WITH FIXES (you made them), or DO NOT LAND.
