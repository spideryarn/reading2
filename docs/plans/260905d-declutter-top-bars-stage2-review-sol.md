# Stage 2 code review — the arc leaves Hierarchy

GPT Sol (`gpt-5.6-sol`, effort high), 2026-09-05, on the working tree of
[260905d](260905d-declutter-the-reading-view-top-bars.md) § Stage 2. The prompt and the diff it was
given are in the session scratchpad; the answer is reproduced verbatim below, with what was done
about each finding first.

## Dispositions

| | Finding | Disposition |
|---|---|---|
| 1 | A leaf-only column set (`?cols=3`, or Para with every gist pill off) mounts `ColumnPanels` with an empty depth set, and `useColumnContext` then measures every row on every scroll | **Accepted.** `TableView.tsx` now mounts the panels on `panels && depths.length > 0`. `panels` itself is unchanged, so swipe over a leaf-only table is untouched. Pre-existing rather than introduced — `?cols=3` already reached it — but stage 2 widened the door, because `?cols=0,3` now resolves to `[3]`. |
| 2 | Keeping the unreachable `ContextItem.text`/`step` bundle was the wrong call | **Accepted, and it was the call I asked to have challenged.** Deleted: the two fields, `Step`, `STEP_LANDMARK_PX` and the `arc` arm of `landmarkLines`, the conditional title/body/range in `ContextList`, `crumbFor`'s `"The argument"` case, `.ctx-step` / `.tip-step` in `styles.css`, and the `arc` option in `tests/context.test.ts`. Sol's argument is the decisive one: [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md) decision 7's Argument **band** carries part titles, gists and section doors — it is not this fisheye column, so preserving the implementation buys nothing. `ContextPanel`'s `navDepth` prop went with it; `depth` is what it always passes now. |
| 3 | `browser-testing.md`'s URLs exercise Plain while claiming to exercise Hierarchy | **Accepted.** `DEFAULT_MODE` is `plain` ([`src/modes.ts`](../../src/modes.ts)), so every column case now says `?mode=hierarchy` explicitly, with a line saying why. The "default three gist columns / 1120px table" paragraph was also false — auto-fit opens two at most and does not overflow — and is rewritten to say how to *ask* for overflow. |
| 4 | The depth-0 `columnPill` test asserted less than it said | **Accepted.** Removed; `columnPill(0, 3)` returns `L0`, so `not.toBe("Arg")` proved nothing. The absence is now pinned where it belongs, on `offerableGists` in `tests/layout.test.ts`. |
| 5 | Comments and CSS still describing the removed column | **Accepted.** Fixed `App.tsx`'s "the `auto` control clears it again" (there is no `auto` control, and no way back to automatic from the UI), `tree.ts` § `buildArcColumn` and `outline.ts` on "the arc column", and deleted the unreachable `td.gist.depth-0` and `.ctx-panel.depth-0`. The `--depth-0` token stays — still live. The two empty section tombstones were kept but cut to three lines each: a reader who greps for `.arc-step` should find out where it went, which git alone does not tell them. |
| 6 | `App.tsx` passed a pre-filtered list into `fitView`, whose input is documented as the full depth range | **Accepted.** `gistDepths` is the full range again and goes to `fitView`; a separate `offerableGistDepths` feeds the pills. One rule, `offerableGists` in `layout.ts`, applied by each caller for its own reason. Sol also rejected putting the rule in `parseAsDepths`, and is right: a syntax parser cannot cover auto-fit or the pill inventory. |
| 7 | `url-state.md` on a bare `?text=0`, and `granularity-zoom.md` still naming an `L3` control | **Accepted.** The `L3` control is the `Para` pill. The `?text=0` claim now says it needs `?mode=hierarchy`, and names stage 3's boot-time rewrite to `?mode=outline` as what closes it. |

## The review, verbatim

Verdict: **accept with changes**. The core removal is correct, and I found no break in arc delivery, navigation, widths, pinning, or `?cols=0,1,2` rendering. The remaining issues are one reachable performance regression, over-retained dead machinery, and misleading documentation/comments.

1. **Medium — leaf-only layouts still mount an empty fisheye system.**  
   [TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:319) sets `panels` from `columns.length > 0`, but [levels](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:343) excludes the leaf column. With `?cols=0,3`, stage 2 turns `[0,3]` into `[3]`: `depths` is empty, yet `ColumnPanels` mounts and `useColumnContext` measures every article row on every scroll. The UI can also reach leaf-only by enabling Para and disabling the gist columns. Split “has context panels” from “has swipeable navigation columns”; mount `ColumnPanels` only when a non-leaf gist depth exists, while retaining swipe on the leaf column.

2. **Medium — keeping the `ContextItem.text`/`step` tombstone is the wrong call.**  
   The unreachable bundle spans [context.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/context.ts:40), [ContextList.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/ContextList.tsx:65), [TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/TableView.tsx:383), [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:3003), and the arc arm of [context.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/tests/context.test.ts:151). Delete it, including `STEP_LANDMARK_PX`, `Step`, the conditional body/title/range behavior, `crumbFor`’s step case, and the CSS. Decision 7 does not justify preserving this implementation: the planned Argument band includes part titles, part gists, section doors, and established/here/ahead divisions, not the old Hierarchy fisheye. Git and the plan are sufficient tombstones. Keeping tests green means updating them to the live contract, not preserving an unreachable branch.

   The same applies to [ContextPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/ContextPanel.tsx:83): `navDepth` now has exactly one caller, which always passes `depth`. Remove the prop and write `depth` into `data-nav-depth`.

3. **Medium — the browser-testing instructions exercise Plain while claiming to exercise Hierarchy.**  
   [browser-testing.md](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/project/browser-testing.md:402) uses `/`, `/?text=0`, and `/?cols=1,2`; the default mode is Plain, so those URLs do not show the claimed columns or legacy outline. Prefix the relevant cases with `?mode=hierarchy`. Also replace lines 418–422: there are no longer three default gist columns, auto-fit does not produce the fixed 1120px overflowing table described there, and a browser pass following this text can silently miss every stage-2 regression.

4. **Low — the depth-0 `columnPill` test says more than it proves.**  
   [column-names.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/tests/column-names.test.ts:40) says depth 0 “has no name,” but merely asserts the result is not `Arg`; `columnPill(0, 3)` currently returns `L0`. Remove this depth-0 call entirely. Absence belongs in the `offerableGists`/rendered-pill test, not in a fallback name test. Stage 3 will delete `columnPill` anyway.

5. **Low — several comments and CSS remnants still describe the removed column.**  
   I would clean up:

   - [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/App.tsx:1694) says the leaf column is not user-toggled and is meaningless beside prose; the Para pill below does exactly that.
   - [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/App.tsx:2737) says the deleted `auto` control clears `?cols=`.
   - [tree.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/tree.ts:332) and [outline.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/outline.ts:139) still call the live projection “the arc column”; the former’s missing-`<td>` explanation no longer describes any reader.
   - [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/styles.css:966) still has unreachable `td.gist.depth-0` and `.ctx-panel.depth-0` selectors, plus empty “old arc column” and “arc while being written” sections. Keep the `--depth-0` token—it remains live elsewhere—but remove these selectors and empty sections.

6. **Low — `offerableGists` is the right seam, but the caller now violates `fitView`’s documented input contract.**  
   [layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/layout.ts:286) says `gistDepths` contains every gist depth, while [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/src/web/App.tsx:1703) passes an already-filtered list. Keep `offerableGists` in `layout.ts`; do not put this in `parseAsDepths`, which is a syntax parser and cannot cover auto-fit or the pill inventory. In App, retain the full geometry-derived list for `fitView`, derive a separately named `offerableGistDepths` for the pills, and let both callers apply the one shared rule.

7. **Low — two project-doc statements remain false, though the code behavior is assigned to stage 3.**  
   [url-state.md](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/project/url-state.md:141) says a bare bookmarked `?text=0` opens the whole-article outline; with Plain as the default it does not. [granularity-zoom.md](/home/greg/code/spideryarn2/.claude/worktrees/declutter-top-bars/docs/project/granularity-zoom.md:339) says the paragraph outline is enabled with an `L3` control, while the current pill says `Para`. Correct the prose now or explicitly mark the impending stage-3 normalization/rename. The other requested docs clearly distinguish the removed Hierarchy column from the surviving arc artefact.

I reran the five most relevant suites: 146 assertions passed across layout, key navigation, column names, context, and URL state.