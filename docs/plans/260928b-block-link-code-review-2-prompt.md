# Code review, round 2 — 260928b block links (stage 2, and the stage-1 fixes)

Candidates, in this worktree:

- **b50c33d6** — stage 2: the pure go-there buttons in ClaimsPanel (×3), CriteriaPanel (placement) and SketchView become `BlockRef` links; CSS in referee.css and diagram-sketch.css; tests/block-link-migration.test.tsx, tests/referee-gap.test.tsx, tests/referee-claims-panel.test.tsx; the plan's "Stage 2 — what landed" section.
- **09c161fd** — the fixes a previous reviewer (you, round 1) wrote into stage 1. They are unreviewed code by someone else: check them as such.

`git show <sha>` for each. Plan: docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md. Round 1: docs/plans/260928b-block-link-code-review-1-sol.md.

You may FIX what you find inside these two commits — narrowly, red test first where behavioural — in the working tree (do not commit). Report, do not fix, anything wider. `npx vitest run <file>` works; `npm run typecheck` may fail in your sandbox on a tsx IPC socket — if so, say so and I will run it.

Attack independently:

- Stage 2: does each migrated link look and behave as the button did (CSS cascade against prose.css's `.block-ref` id-chip rules — font, size, opacity, line-height, colour, hover, focus ring, wrapping of a long quote inside an inline anchor; stylesheet load order in design-css-overview.md)? Any nested interactive content, or a parent click handler that now also fires? Keyboard: Space no longer activates a link — any caller whose tests or UI relied on that? The missing-block span inside these panels — does it render sensibly for a stale quote?
- Were the kept-as-button decisions right (each reason is in the plan)? Is there any pure go-there button the inventory missed (grep `onJump(` across src/web for `onClick={() => onJump(`)?
- The Sketch link inside the Enlarge `<dialog>`: the builder reports the block card is portalled to body, under the top-layer dialog, so invisible there. Is there a small correct fix (e.g. the card portals into the open modal dialog when the anchor is inside one), or should it be left and recorded?
- The round-1 fixes: correctness, any regression, tests that share an assumption with the code.

Severity: P0 data loss/security/broadly unusable; P1 user-visible wrong behaviour or contract violated; P2 design/maintainability; P3 prose. ID each (F1…), file:line, fixed (red→green) or recommended. End with a verdict.
