You are reviewing a plan (read-only) in the Spideryarn repo, in the worktree you are running in.

Plan: docs/plans/261018m-skim-figure-stops-cross-to-visitors.md. Read it first.

Context: Greg (the owner, an admin) answered "A" to docs/user-feedback/questions/q-gq0f4k.md, permitting exactly one field to be added to the public (visitor) DTO: Skim's figure stops. The public DTO (src/public/dto.ts § publicSkim, src/public-types.ts § PublicSkim) is a listed security defence (docs/project/security-map.md). The precedent is docs/plans/261012a-skim-pass-intros-cross-to-visitors.md. The owner-only feature is docs/plans/261017d-figures-as-stops-of-their-own-in-the-skim-route.md; SkimFigureStop is in src/types.ts; walkOf in src/skim-passes.ts; VisitorSkimBand in src/web/modes/skim/SkimMode.tsx; figure validation in src/skim.ts (cueOf, around line 1400).

Please check:
1. Is anything in a figure stop ({blockId, depth, cue, after}) private or about a person, beyond what already crosses (stop cues, intros)?
2. Is the field-by-field copy right, and does anything else (a select in src/store/public-reader.ts, an export, a cache key, an etag, the public page's server render, the MCP) need to change for a visitor to actually get it?
3. Will the visitor client actually draw and step to figure stops with only the walkOf change? Anything in SkimPanel / RouteWalk / useSkimMode that is owner-gated for figures?
4. Are the tests enough to have gone red without the change, and to catch a future spread of the whole object?
5. Any doc or comment that says visitors get no figures that the plan misses (grep for it).

Write your findings as a numbered list, each with severity (P1/P2/P3), file:line, and the fix. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES, or REWORK. Do not edit any files.
