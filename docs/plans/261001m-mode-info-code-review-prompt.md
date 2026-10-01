You are reviewing code before it is pushed, in the repo at the current directory. You may edit files to fix what you find (workspace-write). Do not run git commands that change history or the index (no commit, stash, checkout, restore, reset). Other agents may be viewing a dev server from this tree.

The work: every reading mode's band gets an (i) in its top-right corner, holding the mode's description, counts, caveats and provenance (who wrote it, when — exact plus "ago" — how long). Greg's report and the design are in docs/plans/261001m-every-mode-gets-an-i-in-its-top-right-corner.md (read it, including "What landed"); your own plan review is docs/plans/261001m-mode-info-plan-review-sol.md; the brief the per-mode subagents followed is docs/plans/261001m-stage2-brief.md.

The diff against dev is docs/plans/261001m-mode-info-code-review.diff (64 files). Key files: src/web/ModeSurface.tsx (`mode`, `about`), src/web/BandAbout.tsx (`AboutMode`, `AboutMade`), src/web/styles/mode-band.css (corner and --band-about-room), the mode panels (Tweets, Faq, Citations, Glossary, Ideas, Quotes, Timeline, Debate, Quiz, Diagram, Trajectory, Summary, Structure, Outline, Search, Chat), their stylesheets, docs/project/mode.md § Every band has an (i), and the tests: tests/band-about.test.tsx, tests/every-mode-draws-its-surface.test.tsx (the guard), tests/mode-surface-changes-no-markup.test.tsx.

Look for:
1. Correctness: anything visible that was moved but should have stayed (live status, failures, something the reader acts on, a caveat needed to read the rows), or moved text that now appears nowhere; provenance shown to a visitor or fabricated; AboutMade's date/duration handling; a mode that loses its (i) in some state; the guard test being weaker than it claims (can it go red?).
2. Accessibility and layout: the absolute (i) first in DOM; the clearance padding per mode's top row; Outline's measured inset; z-index; the Diagram live region that replaced the old control's accessible name.
3. Leftovers: dead CSS, dead helpers, stale comments or docs that describe the old placement (grep for traj-about, ScatterNote, gloss-sort-trail, quotes-discarded, dbt-foot, "Written by").
4. Anything simpler.

Fix what you find inside this scope, keeping edits small and in the surrounding style; run `npx tsc --noEmit -p tsconfig.json` and the affected test files with `npx vitest run <files>` after your fixes. Report anything wider for the lead to decide. Write findings ranked P0/P1/P2 with file:line, what you changed for each, and a verdict.
