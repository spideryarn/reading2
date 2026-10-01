You are reviewing a plan before it is built, in the repo at the current directory (Spideryarn, a reading app). Read-only review.

Plan: docs/plans/261001p-summary-loses-parts-and-sections-a-touch-wider.md

Read the plan, then the code it touches: src/web/modes/summary/SummaryMode.tsx, src/web/SummaryPanel.tsx, src/web/SimplePanel.tsx, src/web/params.ts (§ summary mode, deepParam, summaryParam), src/web/activation.ts (summary rows, bandTarget, subModeTarget), src/web/sub-modes.ts, src/web/last-view.ts, src/web/layout.ts (bandWidth, BandShape, fitView, notesFit), src/web/reader/Reader.tsx (fitView/notesFit band shape, summary band mounting), src/web/reader/ModeBoundary.tsx, src/web/tree.ts (showsChildren, currentEntryId), src/mode-catalog.ts summary entry, docs/project/summaries.md.

Tell me, ranked P0/P1/P2:
1. Anything the plan would break that it does not name: other readers of the code it deletes (grep), URL/last-view restore of old addresses, activation tokens (an armed `simple` token nobody claims, or the bar press), the visitor band, tests that pin the removed behaviour, the command bar sub-mode rows.
2. Whether keeping MODE_TARGET summary as `none` while the band now always shows a plain-words level is consistent with bandTarget/ModeBoundary's retire logic.
3. Whether the `roomy` band shape interacts badly with Marginalia (fitBoth/notesFit), the narrow-window band-covers-prose path, or tests that sweep widths.
4. Anything simpler that does the same job.

Be concrete: file:line and the failure scenario. Do not restate the plan.
