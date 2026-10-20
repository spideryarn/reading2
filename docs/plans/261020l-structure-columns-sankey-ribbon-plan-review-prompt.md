You are reviewing a plan, read-only, for Spideryarn (repo at the current directory). Write your findings to docs/plans/261020l-structure-columns-sankey-ribbon-plan-review-sol.md (create it), numbered, each with severity (high/medium/low), what is wrong, and the change you recommend. End with a one-line verdict.

The plan: docs/plans/261020l-structure-columns-sankey-ribbon.md (read it fully; the before screenshot is docs/plans/261020l-shot-before-1440-light.png).

Context to read: src/web/StructurePanel.tsx (the two-column panel, its measuring copies and ResizeObserver), src/web/styles/structure-mode.css (`.struct-grid`, `.struct-inner`, the connector rules), src/web/layout.ts § structureColumnsBand and the STRUCT_* constants, tests/structure-band-width.test.ts, tests/structure-panel-draws-both-columns.test.tsx, docs/project/structure.md, docs/project/narrow-windows.md (the 1165px / 609px figures).

Please check especially:
1. Geometry correctness: which rects to read (beware the hidden `.struct-measure` copies also contain `.struct-col` and `[aria-current]` rows), relative coordinates, when it must re-measure (resize, crossing a part boundary, capacity changes, font load, the head row's height changing, column B header wrapping), and whether a measure loop/oscillation is possible with the existing capacity effect.
2. The "border transparent while a ribbon is drawn" approach vs alternatives, and whether a CSS hook (class/data attribute on the grid) is the cleanest way.
3. Light/dark colour choice, and interaction with the orange thumb and the "one wash" rule.
4. The gutter widening trade-off and every place the 609/1165 numbers live (docs, tests).
5. Anything simpler that gives Greg what he asked for.
6. Accessibility, and the test plan (what jsdom can and cannot prove).
