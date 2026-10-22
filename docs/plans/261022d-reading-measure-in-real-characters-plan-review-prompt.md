You are reviewing a plan before it is built, in the Spideryarn repo (this worktree). Read-only.

Plan: docs/plans/261022d-reading-measure-in-real-characters.md
Research behind it: docs/research/261022a-reading-measure-line-spacing-and-paragraph-spacing-evidence.md
Owner doc for the rule: docs/project/typography.md

The core change is `--reading-measure` from `65ch` to `56ch` in styles/tokens.css, because in-browser
counting showed 65ch holds a median of 70 real characters in Source Serif 4 (the author face), and
the admin who filed the report wants 45–65 when there is room.

Please check, against the code:
1. Every consumer of `--reading-measure` and of literal `65ch` (grep src/, styles/, tests/): does
   anything break, misalign or overflow at 56ch? In particular the masthead/title boxes in
   src/web/styles/narrow-window.css that centre a measure-wide box on the prose axis, the gutter's
   `right:` arithmetic in gutter.css, footnotes.css, quiz.css and skim.css, and `.prose`'s
   `clamp(45ch, 90vw, var(--reading-measure))` — note 45ch is now close to 56ch; any width where the
   45ch minimum now beats the measure, or overflows a narrow cell?
2. Is leaving `PROSE_ALONE_MAX_REM = 49` (src/web/layout.ts) right, or does anything (centring,
   mastheads, Marginalia beside Plain, the band crossover) assume the prose fills most of that cap?
3. Is 56ch the right number given the measurements (zero 8.82px, average char 8.19px at 17px;
   median 70 / p90 75 / max 80 at 65ch)? Is a median-60 target the right reading of the request?
4. Anything in the "not changing" list that the evidence or the request says should change.
5. Anything the plan misses (tests that pin a px width derived from 65ch, docs that quote 65ch as
   current, the /design page).

Answer with: a verdict line (`VERDICT: go` / `VERDICT: go with changes` / `VERDICT: stop`), then
numbered findings, each with file:line evidence and a suggested fix. Be concise.
