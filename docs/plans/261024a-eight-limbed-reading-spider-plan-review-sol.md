LOGO-PLAN-261024

**Verdict: proceed, with two nonblocking P2 findings.** No established P0/P1. The scope fits the requested asset family; no additional approval gates or platform extras are needed.

- **F1 — P2, reasoned: make anatomy-dependent animation verification explicit.** The plan promises preserved animation behavior, but [Semaphore’s clipping polygons and pivots](/Users/greg/.codex/worktrees/spideryarn-knot-reader-logo/reading2/src/web/styles/logo-animations.css:1215) target the current spider’s exact anatomy. Replacing the PNG while preserving transparency and classes could rotate fragments of the new head/book or empty space. **Smallest remedy:** explicitly remeasure those polygons and pivots for the selected app mark; inspect moving frames and the reduced-motion still, including the enlarged loader.

- **F2 — P2, reasoned: define the reproducibility boundary.** The plan requires determinism while retaining [social-card generation](/Users/greg/.codex/worktrees/spideryarn-knot-reader-logo/reading2/scripts/make-og-card.ts:28), which depends on the generated app PNG, installed Geist font and external system Chrome. A different Chrome version or OS can change screenshot bytes despite identical source assets and lockfile. **Smallest remedy:** document generation order and browser prerequisites; define byte determinism for repeated runs in the recorded environment, with dimensions, content and visual checks across environments. No new rendering framework is necessary.

The remaining constraints are sound: optical simplification at small sizes, transparent app masks, opaque install tiles, conditional theme variants, simulated critiques clearly labelled, and preserved source/prompt/selection evidence. I verified head metadata, manifest, email, animation and OG consumers against the current tree.

Read-only review completed; no files changed and no network used.