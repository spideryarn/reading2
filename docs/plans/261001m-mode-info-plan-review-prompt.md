You are reviewing a plan before it is built, in the repo at the current directory (read-only review).

Plan: docs/plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md — read it first; Greg's report is quoted at the top.

Read the code it rests on: src/web/ModeSurface.tsx, src/web/BandAbout.tsx, src/web/Tooltip.tsx, src/web/relative-time.ts, src/web/styles/mode-band.css (.mode-band, .band-head, .band-about), src/web/Tweets.tsx (Provenance, ThreadCounts), src/web/FaqPanel.tsx and src/web/CitationsPanel.tsx (current BandAbout use), tests/every-mode-draws-its-surface.test.tsx, tests/mode-surface-changes-no-markup.test.tsx, docs/project/new-mode.md (the "No description line in the band" rule), docs/project/design-css-overview.md § Dates.

Questions:
1. Is an absolutely-positioned (i) in the band's top-right corner, rendered by ModeSurface as the first DOM child, sound? Any layout, focus-order, a11y, Outline-measurement or Search-zero-slack problem? Is the --band-about-room padding approach for each mode's top row a good one, or is there a simpler robust way to keep the icon from overlapping controls?
2. Is the per-mode table's line between "moves into the (i)" and "stays" right? Anything that should stay visible that the plan moves, or vice versa?
3. Is the guard test (every band has exactly one .band-about, Referee exempt) sound, and is it phrased so it can go red?
4. Anything simpler that gives Greg what he asked for?
5. Any risk in the new-mode.md -> mode.md rename touching dated plan docs?

Give findings ranked P0/P1/P2 with file:line evidence, and a verdict. Be concise.
