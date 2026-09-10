No P0s. I found four P1s and three smaller plan gaps.

1. **P1 — `389px` is not the same threshold as the existing layout.**

   The current query is against the container’s content box, while the proposed constant is against its border box. Structure has `1.5rem` total horizontal padding ([structure-mode.css:52](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/structure-mode.css:52)), and the existing query switches at 364 content pixels ([structure-mode.css:91](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/structure-mode.css:91)).

   At a 20px root size, the equivalent bordered band threshold is therefore `364 + 30 + 1 = 395px`, not 389. The repository explicitly says the root size is not locked and records a previous bug caused by equating px and rem at 16px ([layout.ts:39](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/layout.ts:39)).

   There is a second disagreement even at 16px: `.band-covers` removes the right border ([narrow-window.css:326](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/narrow-window.css:326)), making the old threshold 388px rather than 389px. At a 20px root it is 394px.

   The border-box choice does prevent a face-induced oscillation: the outer width comes from `--mode-w` or the cover rule and neither face changes it ([mode-band.css:28](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/mode-band.css:28)). But the stronger claim that it cannot disagree with the page is false. Derive the threshold from the rem spacing and actual border state, or convert every mirrored spacing value to px. Test a non-16px root and both bordered/cover states.

2. **P1 — rung 1 still assumes its rows fit, so wrapped titles can hide part of the document.**

   The higher rungs genuinely use rendered `scrollHeight`, but the fit initializes `best` to rung 1 and retains it when no candidate fits ([OutlinePanel.tsx:212](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/OutlinePanel.tsx:212)). `outline.ts` states the underlying assumption directly: “every part, one line each — if this will not fit, nothing will” ([outline.ts:20](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/outline.ts:20)).

   Because the panel deliberately hides overflow and never scrolls ([outline-mode.css:15](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/outline-mode.css:15)), an oversized rung 1 clips later parts. Thus the plan’s “nothing overflows that did not before” claim ([plan:126](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/plans/260910g-structure-mode-subsumes-outline.md:126)) contradicts its acknowledgement four lines later.

   This needs an explicit fallback/product decision, not only evidence from today’s corpus. Test synthetic numerous, long titles in a short band and at a large root font.

3. **P1 — removing only `-webkit-line-clamp` does not fully remove the clamp.**

   The rule contains both `-webkit-line-clamp: 1` and `line-clamp: 1` ([outline-mode.css:209](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/styles/outline-mode.css:209)). The implementation instruction names only the prefixed declaration ([plan:124](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/plans/260910g-structure-mode-subsumes-outline.md:124)). Remove both; otherwise the stylesheet still requests a one-line clamp in engines supporting the unprefixed property.

4. **P1 — the reverse-mode inventory misses the sharing inventory’s untyped Outline rows.**

   `sharedInventory` now derives its mode rows by iterating `MODES` ([shared-inventory.ts:102](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/shared-inventory.ts:102)), but its independent test still names Outline in three stringly typed places:

   - the always-shared list ([shared-inventory.test.ts:162](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/shared-inventory.test.ts:162));
   - the arc’s owning row ([shared-inventory.test.ts:281](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/shared-inventory.test.ts:281));
   - `navLabelStatus`’s owning row ([shared-inventory.test.ts:308](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/shared-inventory.test.ts:308)).

   These should become Structure. They are an additional non-typechecked table beyond the four listed in the plan ([plan:114](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/plans/260910g-structure-mode-subsumes-outline.md:114)).

5. **P2 — the first-frame conclusion is supported by the current code, but not by the plan’s stated reason.**

   A `ResizeObserver` callback does not “run in a layout effect” as the plan says ([plan:78](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/plans/260910g-structure-mode-subsumes-outline.md:78)). The safe pattern is a synchronous measurement inside `useLayoutEffect`, followed by registering the observer.

   The current implementation does exactly that: `measure()` runs before `new ResizeObserver(...)` ([StructureMode.tsx:177](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/modes/structure/StructureMode.tsx:177)), matching Outline’s established pattern ([OutlinePanel.tsx:225](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/OutlinePanel.tsx:225)). Therefore I found no current first-paint flicker route, provided that synchronous read remains. Correct the plan and test the initial narrow render without manually firing the observer.

6. **P2 — legacy URLs create two intentional nonvisual disagreements.**

   I found no reader-visible disagreement in the requested surfaces:

   - client and server both canonicalize through `modeFromParam` ([params.ts:333](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/params.ts:333), [read-address.ts:56](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/read-address.ts:56));
   - the tab and reading-view Dock receive canonical `structure` ([Reader.tsx:312](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/reader/Reader.tsx:312), [Dock.tsx:2271](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/Dock.tsx:2271));
   - last-view restore preserves the raw pair but reparses it canonically on arrival ([last-view.ts:246](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/last-view.ts:246));
   - visitors may read Structure ([visitor.ts:176](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/visitor.ts:176));
   - the command bar has `outline` as a Structure alias ([mode-catalog.ts:407](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/mode-catalog.ts:407)).

   However, feedback stores the raw `location.href` containing `mode=outline` ([FeedbackButton.tsx:195](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/FeedbackButton.tsx:195)) alongside diagnostics whose mode is canonical `structure` ([Reader.tsx:460](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/reader/Reader.tsx:460)). Also, the Dock’s metadata/tweets path still uses an exact `MODES_UI` lookup rather than `modeFromParam` ([Dock.tsx:843](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/src/web/Dock.tsx:843)). That has no visible effect now because those links have no checked state and Structure is no longer experimental, but the plan should call these intentional exceptions rather than claim one meaning “everywhere.”

7. **P2 — two backward-checklist residues should be named explicitly.**

   `new-mode.md` calls out the stylesheet manifest and the independent silent-mode test ([new-mode.md:334](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/project/new-mode.md:334)). The Outline stylesheet correctly remains because the face remains, but its manifest comment says the two stylesheets will be “deleted together when the comparison … is over,” which is now false ([styles-entry-is-imports-only.test.ts:164](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/styles-entry-is-imports-only.test.ts:164)). The `SILENT` table also still names Outline ([every-mode-says-which-passages-it-marks.test.ts:97](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/tests/every-mode-says-which-passages-it-marks.test.ts:97)); typechecking should catch that one, but the plan’s checklist should name it.

The promotion argument is sound. Greg’s newer instruction explicitly says to remove Outline because Structure subsumes it ([plan:5](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/plans/260910g-structure-mode-subsumes-outline.md:5)); leaving Structure behind the switch would remove the requested experience from ordinary readers. `new-mode.md` requires the catalog flag, test policy and owning documentation to move together ([new-mode.md:163](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/project/new-mode.md:163)), so the docs stage should explicitly remove Structure’s old row and now-contradictory paragraph in [experimental-features.md:177](/home/greg/code/spideryarn2/.claude/worktrees/structure-outline-merge/docs/project/experimental-features.md:177).