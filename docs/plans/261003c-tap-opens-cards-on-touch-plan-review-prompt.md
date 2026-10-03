You are reviewing a PLAN (read-only; do not edit files) in the Spideryarn repo, in the current working directory (a git worktree).

Plan: docs/plans/261003c-tap-opens-structure-row-cards-and-the-reading-time-card-on-touch.md. Read it first, in full.

Then read the code it touches, and check its claims against the code rather than against the plan's prose:
- src/web/useTapReveal.ts (the hook it reuses), and its callers src/web/CitationsPanel.tsx and src/web/CitationInvestigation.tsx
- src/web/StructurePanel.tsx (Row, RowCard, the TooltipGroup) and src/web/OutlinePanel.tsx (Row)
- src/web/Tooltip.tsx (controlled vs uncontrolled, mouseOnly, useFocus/useDismiss, the delay group)
- src/web/Spine.tsx § bandClick / takeRailPress, and docs/postmortems/260828g-spine-hover-cards.md (the shared-state trap)
- src/web/BlockLinkCard.tsx (the delegated card; READING_LINE; over/out/show/arm)
- src/web/styles/gutter.css (§ reading time `.blk-gutter > span.blk-read`, the (hover: none) reveals, the state marks), src/web/BlockGutter.tsx, and src/web/TableView.tsx § isBlockSelectionTap / NOT_A_BLOCK_SELECTION
- docs/project/touch.md (the tap rules and its traps: a lift fires the hover events; a tap's pointer events and its click can disagree; on iOS 18.2 and later a finger's click has pointerType "mouse")

The questions I most want answered:
1. Is a per-row useTapReveal inside a TooltipGroup safe from the 260828g trap? Is there any way a hover-opened card, or a close from the delay group, leaves a row's state wrong, or a second tap fails to jump on an iPad?
2. The order of events on a real touch tap on the reading line. Does a click listener on document reliably fire for a tap on a 5.6px absolutely positioned span with pointer-events:auto, inside a gutter that is pointer-events:none? Does the existing `over` (touch → close()) or `out` (→ close timer) race my show? Is there anything else that would close it straight away (a useDismiss elsewhere, the selection-tap code, ProseHoverCard)?
3. Option (b), widening the strip: is it sound? Which gutter children are visible on a non-active row under (hover: none)? List them exhaustively from the CSS. Is there a less fragile exclusion than a :has() that lists the marks? Or should I take (a), or a different idea entirely?
4. Closing on scroll inside useTapReveal, through a capture-phase scroll listener on document: any problem? For example, scroll events fired by the tooltip opening, by the row's scrollIntoView, or by the band's windowing.
5. Anything the plan misses: accessibility, the "here" row that has no card, the measuring copies, windowed rows unmounting.

Write your answer as a numbered list of findings, each with a severity (P0/P1/P2), its evidence (file:line), and the fix you recommend. End with a one-line verdict.
