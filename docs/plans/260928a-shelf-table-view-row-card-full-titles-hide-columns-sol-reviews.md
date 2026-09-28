# GPT Sol's four reviews of plan 260928a

The plan: [260928a-shelf-table-view-row-card-full-titles-hide-columns.md](260928a-shelf-table-view-row-card-full-titles-hide-columns.md), whose Log says what was done with each finding. Verbatim answers, 2026-09-28.

## The plan (read-only)

P-1 — P1: Removing `Details` does lose a previously reachable fact.

Evidence: The plan says the only non-row fact in `Details` is the exact date and excludes `siteName` from the new card (`docs/plans/260928a-shelf-table-view-row-card-full-titles-hide-columns.md:64-71`). But the title metadata line is truncated (`src/web/library-columns.tsx:247-249`, `:286-302`), while `Details` presents the complete site name as “From” (`src/web/ShelfEntry.tsx:280-291`). A long byline can therefore hide the site name visually; removing `Details` makes it unreachable.

Fix: Either let the metadata line wrap too, or retain `From: <siteName>` in the row card. Add a narrow-browser case with a long byline and site name.

P-2 — P1: The existing Table control tooltip will become false.

Evidence: The planned table gains the gist and hideable columns (`plan:49-62`, `:88-113`), while its current tooltip promises “every column at once” and “No blurb” (`src/web/ShelfControls.tsx:248-258`). Stage 2 touches this file but does not mention correcting that copy.

Fix: Update `VIEW_TIPS.table` and its surrounding comments as part of stages 1–2, with a test preventing those two claims from returning.

P-3 — P1: The proposed table-wide `TooltipGroup` nests another group and cannot guarantee one open card.

Evidence: The plan wraps the table in a group and promises one card at a time (`plan:73-77`, `:119-123`). Every `Actions` cell already contains its own `TooltipGroup` (`src/web/ShelfEntry.tsx:690-800`). Nested providers maintain independent current members, so a title card in the outer group and an action card in the inner group can coexist—especially when the title remains focused while an action is hovered.

Fix: In table rows, make `Actions` inherit the table-wide group instead of creating its own; retain its private group in cards view. Test title→action and action→title transitions, including focus plus hover.

P-4 — P1: Hiding a column from its own context menu creates a keyboard focus dead end.

Evidence: The menu removes the header that invoked it (`plan:94-98`), and the focused element is normally the sort button inside that `<th>` (`src/web/lib/DataTable.tsx:479-509`). The existing actions menu explicitly prevents Radix focus restoration when its action removes/replaces the trigger (`src/web/ShelfEntry.tsx:907-914`, `:950-958`); the plan has no equivalent.

Fix: Prefer cutting right-click from v1. If retained, specify `ContextMenu.Trigger asChild` around the `<th>`, preserve the nested sort button, and restore focus to the stable Columns control or an adjacent visible header after hiding. Test Shift+F10/Menu-key → Hide → meaningful focus.

P-5 — P2: “Every hidden column returns to the card” is impossible for Actions.

Evidence: The plan makes Actions hideable (`plan:97-98`) while promising every hidden column’s value in the card (`:60-62`). Actions is five interactive controls, not a value (`src/web/library-columns.tsx:235-240`), and ordinary tooltip panels deliberately take no pointer input (`docs/project/tooltips.md:448-455`).

Fix: Make both Article and Actions non-hideable. Otherwise narrow the promise explicitly and acknowledge that Actions must be restored through Columns or reached by switching to cards.

P-6 — P2: The planned tests do not pin the two load-bearing visibility claims strongly enough.

Evidence: The plan tests only that `/admin` has no hide affordance and that a hidden value appears in the card (`plan:125-128`). Hidden sorting currently can work because chips enumerate all leaf columns (`src/web/lib/DataTable.tsx:320-326`) and the shelf still reads the primary value from the row model (`src/web/Library.tsx:260-280`), while only rendering visible cells (`src/web/lib/DataTable.tsx:427-439`). But none of that is tested after visibility is introduced. Likewise, “no menu” does not prove `/admin` retained every header, cell, and sort behavior (`src/web/AdminPage.tsx:300-316`, `:383`).

Fix: Add tests that hide the active primary column and assert order, missing-last behavior, chip state, and sort direction remain unchanged; assert `/admin` keeps the same headers/cells and still sorts. Keep visibility optional and do not filter the column-definition array.

P-7 — P2: The tooltip tests omit the documented jsdom mechanics that stop them lying.

Evidence: Stage 1 lists hover, focus, and one-card assertions (`plan:121-123`), but opening requires native `mouseenter`, closing requires bubbling `mouseout` plus two `act` phases, and re-hover inside a group requires a third wait (`docs/project/tooltips.md:293-328`).

Fix: Put that event/`act` recipe directly into the stage and copy the helper pattern from `tests/dock-mode-tooltips.test.tsx`; count portalled cards under `document.body`, not only the render host.

P-8 — P2: The new Columns label may make the phone controls row overflow.

Evidence: “Columns · 2 hidden” joins a non-wrapping inner control group (`plan:90-93`; `src/web/ShelfControls.tsx:56-81`). The outer controls row wraps, but that inner Unread/view group currently remains one indivisible flex item. The narrow-window contract requires unpredictable-width rows to wrap and explicitly checks document overflow (`docs/project/narrow-windows.md:8-36`).

Fix: Let the right-hand control group wrap, or use a compact count badge. Browser-check at both 390px and 320px and assert `documentElement.scrollWidth === clientWidth`.

Verdict: Revise before building; the opt-in TanStack visibility design can preserve `/admin` and hidden sorting, but the current plan has four P1 interaction/content defects, including a real loss from removing `Details`.

## Stage 1 code

- **S1-1 — P1 — FIXED:** `VIEW_TIPS.table` promised every article had a blurb and multiple exact dates, and said hidden values “move” into the card even though date facts are already there. Reworded truthfully at [ShelfControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/ShelfControls.tsx:267). Added a red-first regression test at [shelf-table-row-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-row-card.test.tsx:382).

- **S1-2 — P2 — FIXED:** The wrapping test stayed green after mutating away both `wrap-anywhere` classes, leaving unbroken titles/bylines able to regress into horizontal overflow. Strengthened the test to require the classes at [shelf-table-row-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-row-card.test.tsx:352); the mutation then failed before restoring production.

Verification:

- Stage 1 suite: 21/21 passed.
- Link/ref handover suite: 4/4 passed.
- Nested-group mutation failed correctly with two open cards.
- `git diff --check` passed.
- No commit created.

**Verdict: Stage 1 is ready; no remaining findings.**

## Stage 2 code

- **S2-1 — P2 — FIXED.** The Columns menu opened on touch `pointerdown`, so beginning a page scroll on the control opened it. Radix toggles at [index.mjs](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/node_modules/@radix-ui/react-dropdown-menu/dist/index.mjs:77). Added completed-tap handling matching `ShelfActionsMenu` at [DataTable.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/lib/DataTable.tsx:442), with the red-first regression test at [shelf-table-hide-columns.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-hide-columns.test.tsx:372).

- **S2-2 — P2 — FIXED.** After Radix’s 700 ms header long-press opened the context menu, lifting the finger also clicked the nested sort button and reordered the shelf. Radix only clears its timer on `pointerup`; it does not cancel the subsequent click ([index.mjs](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/node_modules/@radix-ui/react-context-menu/dist/index.mjs:97)). Added a one-gesture click guard at [DataTable.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/lib/DataTable.tsx:631), reproduced by the red-first test at [shelf-table-hide-columns.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-hide-columns.test.tsx:504).

All other requested claims were verified, including `/admin` isolation, stable state identities, storage failures, hidden sorting, focus behavior, valid table children, row-card values, and Columns naming/count/no-`title`.

Checks: focused Vitest 25/25; Biome clean; all four TypeScript projects pass directly. The `npm run typecheck` wrapper itself hit a sandbox-denied `/tmp` IPC socket. No commit made; existing `.review/` left untouched.

Verdict: **Stage 2 is ready with two P2 touch defects fixed.**

## Stage 3 code, and across the plan

- S3-1 — P2 — FIXED: `library.md` falsely said every hidden value “moves” into the card and implied any junk storage clears all hidden columns. Added and valid Last-opened dates are already present; mixed valid/obsolete IDs preserve valid IDs. The section now follows the documentation policy, preserves Greg’s verbatim quote, and points to code for mechanics. Evidence: [library.md](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/docs/project/library.md:561), [library-columns.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/library-columns.tsx:457), [shelf-hidden-columns.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/shelf-hidden-columns.ts:20). Tests: row-card, hide-columns, doc-links.

- S3-2 — P2 — FIXED: `VIEW_TIPS.table` still semantically promised all five data columns despite persisted hiding. It now describes only columns the reader chose to show. Red-first test added. Evidence: [ShelfControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/ShelfControls.tsx:266), [shelf-table-row-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-row-card.test.tsx:391).

- S3-3 — P2 — FIXED: Columns lacked the rich `ControlTip` carried by the neighbouring view controls. Added a grouped card explaining the hidden count and unchanged sorting; it dismisses before the portalled menu opens. Red-first test added. Evidence: [DataTable.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/lib/DataTable.tsx:444), [ShelfControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/ShelfControls.tsx:65), [shelf-table-hide-columns.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-hide-columns.test.tsx:384).

- S3-4 — P2 — FIXED: `useSortedTable` claimed visibility state and its handler must be passed together, but its type allowed half-controlled state that silently disabled hiding. A union now rejects that state. The compile-time test failed red with an unused `@ts-expect-error`, then passed. Evidence: [DataTable.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/lib/DataTable.tsx:204), [shelf-table-hide-columns.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-hide-columns.test.tsx:114).

- S3-5 — P3 — FIXED: Cross-stage comments still said the table showed “every column and no blurb,” described only two shelf controls, and misstated obsolete-ID handling. Corrected narrowly. Evidence: [ShelfEntry.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/ShelfEntry.tsx:100), [ShelfControls.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/ShelfControls.tsx:10), [Library.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/Library.tsx:25).

- S3-6 — P3 — FIXED: The jsdom regression test’s title overstated what it proves. It now explicitly pins the structural classes; the comment retains the browser measurement as the layout evidence. The diagnosis is sound: `sr-only` is absolutely positioned, and `relative` makes the overflow box its containing block. It creates no stacking context without `z-index`. Radix menus and tooltips are portalled, `/admin` has no positioned/sticky DataTable descendants, and AdminFeedbackList does not use DataTable. Evidence: [DataTable.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/lib/DataTable.tsx:591), [shelf-table-row-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/tests/shelf-table-row-card.test.tsx:372), [Tooltip.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/Tooltip.tsx:255), [AdminPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/shelf-table-view/src/web/AdminPage.tsx:373).

Checks: 48 focused tests passed; 14 doc-link tests passed; full typecheck passed; focused Biome lint passed. No wider findings, and no commit made.

Verdict: READY — all stage-3 and cross-stage findings were fixed, with no reported blockers.
