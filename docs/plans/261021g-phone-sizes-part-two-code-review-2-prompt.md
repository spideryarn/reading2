# Code review: 261021g stage 2 (the rest of the 40px targets under a finger)

Candidate: commit `f012d7bcc` in this worktree. Diff: `git show f012d7bcc`. Changed paths:
`git show --stat f012d7bcc` (24 files: components in `src/web/`, sheets in `src/web/styles/`,
`tests/touch-controls.test.ts`, new `tests/touch-targets-261021g.test.tsx`, docs). Start with
the plan, `docs/plans/261021g-phone-sizes-part-two-citations-spacing-and-remaining-touch-targets.md`
(§ Stage 2, § Plan review which overrides the table, § What landed), then
`src/web/components/ui/button.tsx`, `src/web/styles/narrow-window.css`, `src/web/styles/shell.css`,
`src/web/Masthead.tsx`, `src/web/QuizPanel.tsx`. The reading list does not limit scope.

The rule: under a finger (`any-pointer: coarse`) nothing to press is under 40 × 40px; desktop must
compute exactly as before. A Sonnet browser pass at 390×844 (touch) measured every listed control
at ≥40 (a `.tap-target` halo counts), no horizontal overflow, and desktop sizes unchanged; it then
found six stragglers, fixed after the pass and not re-measured in a browser (Quiz Answer
`.chat-send.quiz-go`, /profile Sign out in AccountSection.tsx, /profile Dictate `.prof-mic`
squeezed in a flex row, Metadata's `QUIET_BUTTON`, PageContents' Contents, Search `.srch-icon`).

## What to do

You may edit files in this commit's scope. Fix what is wrong inside this stage, narrowly and
red-first where a test can show it; report, do not fix, anything wider.

Attack independently, in particular:
- The cascade: does each new coarse rule actually win at runtime (later sheets, equal specificity
  with a later base shorthand — stage 1's C1 was exactly that; Tailwind utilities layer vs
  app-layer CSS; `twMerge` dropping or keeping classes in `Button` and at call sites)?
- Desktop unchanged: any new rule or class that leaks outside the coarse query?
- `--dock-h` arithmetic and the band corner's move from `pointer` to `any-pointer`: anything that
  reads those tokens and now lays out differently (grep them).
- The six stragglers: will each fix work (e.g. `.chat-send.quiz-go` against mode-band.css's
  `.chat-send` and the composer rules; `flex: none` on `.prof-mic` in every place it's used).
- `.tap-target` on ShelfTags/ShelfEntry: its clearance contract (`src/web/styles/tap-target.css`).
- The new tests: would each fail on a regression? The bare-2.5rem guard's regex — false negatives?

Run `npx vitest run tests/touch-targets-261021g.test.tsx tests/touch-controls.test.ts tests/tap-target.test.tsx tests/minimum-text-size.test.ts` yourself.

## Format

Findings C1, C2, … with severity P0/P1/P2/P3, file:line evidence, and what you changed. End with
one line: `VERDICT: ship` / `ship with fixes applied` / `do not ship`.
