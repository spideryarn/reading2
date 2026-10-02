You are reviewing built code in the Spideryarn repo (this worktree), and you may fix what you find.

The plan is docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish.md. Read it first, including
§ What GPT Sol's plan review changed: you reviewed the plan earlier
(docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish-plan-review-sol.md). Check that each
of your eleven findings was handled the way the plan says.

The change is `git diff e23212480080d63d76ec4eac1fa4c7d2553d33eb` (the base this branch started
from), including uncommitted work in the tree. It is also saved as
docs/plans/261002e-mode-corner-icons-and-gutter-icon-polish-code-review.diff. In short:

1. The corner. `ModeSurface` gains `profile`; the badge is the band's second direct child after the
   (i). In mode-band.css: `--band-corner-btn` and `--band-corner-*`, `--band-about-room` grows via
   `.mode-band.has-about:has(> .prof-badge)`, and `.band-head` is floored at the corner's height.
   narrow-window.css sets 2rem on a coarse pointer. Summary, Glossary, Quotes, Ideas and Tweets pass
   their badge as `profile`; the trailing slots of SortBar/RankBar and ThreadHead's children went.
2. The gutter. Every control carries `data-tip` instead of `title`, and BlockLinkCard.tsx's
   delegated card serves them (`GUTTER_CONTROL`, `TipNote`, a MutationObserver on `data-tip` for the
   open one, no `aria-describedby`). gutter.css has one shared hover/focus colour rule, a
   `row-gap: max(0.25rem, 4px)`, and thresholds moved to 52/3.25, 80/5 and 108/6.75, plus the
   negated one-slot query. `.block-chat.has:hover` was re-added after the blue.
3. Tests: tests/gutter-control-card.test.tsx (new), tests/every-mode-draws-its-surface.test.tsx
   (`PROFILED` sweep and the no-badge check), tests/gutter-target-size.test.ts and
   tests/block-gutter.test.tsx updated.

Real-browser evidence, Playwright on this box with Chrome at 390, 820 and 1440 px:
- In all five profiled modes, the badge and the (i) have identical tops and sizes (32px on a
  coarse pointer, 24px otherwise), with a constant gap.
- With a mouse on the bookmark, its colour went from oklch(0.63 0 0) to rgb(219,138,69).
- The slot pitch went from 24px to 28px.

Look hardest at:
- Specificity and source order in gutter.css. Does any state now get the wrong colour or
  opacity? Cases: the one-slot marked-row block, `.failed`, `.block-chat.has` at rest, a hover, and
  a touch `row-active` row.
- Whether the new thresholds change any row's behaviour you think is wrong. Does layout.ts, or
  anything else, compute gutter heights from slot counts?
- BlockLinkCard: the effect that now re-runs on every `setShown` from the reword observer. Any
  loop, leak or stale closure? Focus-visible behaviour on a gutter button that is pressed with the
  mouse (it would gain focus).
- The corner: a band where `profile` is given but the band has no `mode`/`about`; Search,
  Outline and Structure's fit; RTL is not a concern.
- Anything in the docs edits (docs/project/mode.md, tooltips.md, design-css-overview.md) that is
  now false.

Fix what you find inside these files. Run `npx vitest run` on the test files named above and
`npm run typecheck`. Report each finding with severity (P0-P3), file:line, and what you changed or
why you didn't. Report anything wider for me to decide. End with a verdict: ship / fix then ship /
rethink.
