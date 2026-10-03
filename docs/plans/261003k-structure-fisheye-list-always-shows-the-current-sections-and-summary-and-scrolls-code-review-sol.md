No P0 or P1 findings.

- **P2 — fixed:** [OutlinePanel.tsx:382](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/OutlinePanel.tsx:382): follow-along could hide Home/End’s selected heading after the jump opened a part. Red-first tests now cover immediate, deferred and intermediate section updates.
- **P2 — fixed:** [structure.md:71](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/docs/project/structure.md:71): documentation overstated the floor’s guarantee. Help and comments now reflect the deferred deeper-subsection limitation.
- **P2 — left for you:** [keynav.ts:372](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/keynav.ts:372) centres jumps; [useColumnContext.ts:70](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/useColumnContext.ts:70) samples at 40%. A different sampled destination can leave the reveal pending. Resolving that shared contract exceeds this review’s scope.

Verification: **136 targeted tests passed; 17 mutations caught**. Typecheck passed through `node --import tsx`; the npm wrapper hit sandbox IPC restrictions. Lint reported two complexity advisories, no errors. No fit loop, live clamp consumer or selector defect found.

Browser evidence remains necessary for wrapping, scrollbar width, flex sizing, actual jump landings and gestures. Findings are recorded in the plan. No commits or git-state changes.

**Verdict: scoped fixes verified; approval pending browser landing and scrolling evidence.**