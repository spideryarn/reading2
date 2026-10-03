The rung-3 floor addresses the reported Entropy case, but the plan leaves one requested behavior unmet and inherits two scrolling defects. No P0 findings.

1. **F1 — P1: Excluding deeper trees leaves the “lowest-level heading” request unmet.**  
   [Plan:91](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md:91), [outline.ts:306](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/outline.ts:306).

   On a depth-4 tree, rung 3 shows the depth-2 parent’s headings and gist. The reader’s lowest-level section is depth 3, so its heading, siblings and summary remain absent. Moving between those subsections also leaves the drawn `currentId` unchanged, preventing follow-along. This directly contradicts the quoted request, even though it is an existing limitation. Open the current branch down to the actual section depth and show that section’s siblings and gist.

2. **F2 — P1: Placing the current row a third down can clip a summary that would fit.**  
   [Plan:62](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md:62), [OutlinePanel.tsx:405](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/OutlinePanel.tsx:405).

   If the part block exceeds the viewport, the fallback inherits Expanded’s positioning. In a 300px list, a 250px current row placed 100px down loses its final 50px, although the complete heading and summary could fit. Prefer the third-down position only within the range that keeps a fitting row fully visible. For a row taller than the viewport, make its heading visible and allow scrolling through the remainder.

3. **F3 — P1: Home/End can select a row without revealing it.**  
   [Plan:102](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md:102), [OutlinePanel.tsx:466](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/src/web/OutlinePanel.tsx:466).

   Read the first section, manually scroll the overflowing list away from its beginning, then press Home. Home selects the first part and jumps to its start, but if that remains the same current section, `currentId` does not change and follow-along never runs. The active descendant stays offscreen. A boundary follow can also reveal the current section while hiding its selected part row in an oversized block. Explicit keyboard navigation needs to reveal its target independently of passive follow-along, using the list’s own scroll position.

4. **F4 — P2: The verification plan needs cases that distinguish these failures.**  
   [Plan:108](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/docs/plans/261003k-structure-fisheye-list-always-shows-the-current-sections-and-summary-and-scrolls.md:108), [outline-panel.test.tsx:34](/home/greg/code/spideryarn2/.claude/worktrees/fbs46j8f-fisheye-shows-section-detail/tests/outline-panel.test.tsx:34).

   The one-part fixture cannot prove sane scrolling after an old part collapses and another opens. Add stubbed-geometry cases for multiple parts, a tall-but-fitting current row, Home/End after manual scrolling, fisheye manual-position preservation, and hidden-to-visible recovery. Assert the complete target bounds are inside the viewport; `scrollTop > 0` alone can pass with the summary clipped.

The remaining choices are sound:

- **Keep the two-column face unchanged for this report.** Its fixed rung B already supplies the current gist. Its windowing can hide siblings, so this is a scoped list-face fix, not a guarantee for every Structure layout.
- **Remove the clamp.** The remaining functional consumers are the component, stylesheet and `OUTLINE` markup assertion already named in the plan. Scrolling replaces its original purpose; reinstating truncated titles would undermine both this request and Greg’s earlier feedback.
- **No current part, Notes and missing gists are safe exceptions.** Draw the available headings, follow Notes as its single row, and omit absent summaries. Preserve the paragraph refusal when the band covers the prose.
- **Keep measuring copies independent of scroll state.** The plan’s descendant selector would also apply scroll padding to hidden copies, making measurements depend on the previous fit. The live stylesheet now uses `> .outln-list`, which avoids this. Classic scrollbars narrow the overflowing visible list, but do not invalidate the floor decision: it is already pinned to rung 3, and follow geometry must come from visible rows.
- **Independent wheel/touch scrolling is appropriate.** On phones, passage jumps already step the band aside. Verify touch cancellation, tooltip dismissal and scroll chaining at list boundaries in a browser.

The permitted test file passed **22 tests** against the changing live worktree. jsdom can prove selection and follow arithmetic with meaningful stubs; only a browser can prove wrapping, actual summary visibility, scrollbar width, flex sizing and native gestures. The rung floor plus the existing scroller remains the simplest approach.

**Verdict: revise before approval—address F1–F3 and strengthen the targeted verification.**