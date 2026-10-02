Review this plan, read-only: docs/plans/261002e-sharing-mark-tooltip-separates-state-from-action.md
Research behind it: docs/research/261002b-tooltip-text-state-versus-action.md

Code it touches: src/web/Tooltip.tsx (ControlTip), src/web/Masthead.tsx (SharingMark, ArchiveMark), src/messages.ts (SHARING_* around lines 3495-3660, ALWAYS_SHARED/NEVER_SHARED ~4100-4250), src/web/BlockGutter.tsx (~585-600), src/web/TableView.tsx, src/web/reader/Reader.tsx (~2680-2720), src/web/ProseHoverCard.tsx (~1986), src/web/shared-inventory.ts header, tests/masthead-sharing-mark.test.tsx, tests/block-gutter.test.tsx.

Check especially:
1. Is every factual claim in the new card text TRUE against the code (what a shared link carries, listed publicly, confirmation before anything goes, where the padlock link lands, what the Metadata page shows at its top)? A false sentence in a tooltip is the commonest defect here.
2. Is the `notesBy` prop the right seam for the visitor wording, or is there an existing owner/visitor signal BlockGutter should use instead? Any caller that would show the wrong words?
3. Does the visitor actually receive comments in the gutter (so the bug is real)?
4. Anything in the plan that contradicts docs/project/tooltips.md's ControlTip rules.
5. Simpler alternatives.
Give findings as a numbered list with severity (P0-P3), file:line evidence, and a concrete fix. Say explicitly if you find nothing.
