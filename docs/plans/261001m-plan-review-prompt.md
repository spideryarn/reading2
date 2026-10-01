You are reviewing a plan before it is built, in the Spideryarn repo (read-only). The plan is
docs/plans/261001m-citations-duplicate-by-line-and-a-flash-you-can-see.md. Read it, then the code
it touches: src/web/CitationsPanel.tsx (CitationRow, ByLine, byLineOf, workByLine, shortAuthors),
src/web/flash.ts, src/web/styles/prose.css (§ the flash on arrival), src/web/styles/tokens.css,
tests/block-flash.test.ts, src/paper-evidence.ts (authorYearLabel), docs/project/citations.md.

Check: (1) is the duplicate rule right and safe — false positives that would hide a line saying
something new, cases it misses that Greg's example implies; (2) moving the hover card to the title,
especially when the title is a link — accessibility (the by-line had sr-only text), touch, and the
native title attribute; (3) whether lengthening every flash to 2.4 s breaks anything (stepping
callers, Trajectory flashing on every step, the held flash, tests, timers), and whether
`var(--flash-ms)` in `animation` works as intended; (4) anything simpler. Also check the plan's
conclusion: will these changes actually make Greg notice the flash?
Report findings as a numbered list, each P0/P1/P2 with file:line evidence and a suggested fix.
