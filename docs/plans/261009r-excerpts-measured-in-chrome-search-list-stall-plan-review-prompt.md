# Plan review: 261009r — a Search list formats only the rows a reader can see

You are reviewing a PLAN, read-only. Repo: this worktree. Read:

- docs/plans/261009r-excerpts-measured-in-chrome-search-list-stall.md (the plan, with the measurements)
- docs/plans/261009k-excerpts-keep-maths-and-formatting.md (the change that caused the regression)
- src/web/Excerpt.tsx, src/web/excerpt-html.ts, src/web/SearchPanel.tsx (§ Results, § Hit), src/web/reveal-once.ts (an existing IntersectionObserver idiom)
- The measurement script: /tmp/claude-1000/-home-greg-code-spideryarn2/354d9ca7-e53d-40f6-8491-44708949bc24/scratchpad/measure-copy.mjs

Questions:
1. Do the numbers support "a real regression of ~0.8 s on the longest task"? Is the method sound (dev build, alternating, longtask observer)? Anything that would make the comparison unfair?
2. Is lazy formatting of Search rows via one shared IntersectionObserver the simplest right fix? Is capping rows really the wrong call here? Any better option?
3. Correctness traps: the list scrolls inside the band (nested scroll container) — will root=viewport IO fire correctly? scrollMargin support? Rows hidden (display:none band, closed mode), React StrictMode double effects, unmount/observer cleanup, re-render when `found` changes (new query: does a reused row keep its "seen"? keyed by f.key), keyboard/screen-reader users, the HitCard tooltip.
4. Does the failing test described actually go red on current code and pin the right thing?
5. Anything missing from the plan.

Write a findings list (F1, F2, …), each with severity and a concrete suggested change, then a verdict: proceed / proceed with changes / rethink.
