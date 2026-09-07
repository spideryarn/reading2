Request changes; do not build yet. F1–F3 are established P1s.

The central cascade suspicion is cleared: the proposed selectors retain the required specificity, and no later stylesheet redefines `--bar-bottom` or `--bar-hide` for the reading root. The later narrow `.controls` rules change padding and overflow only.

### F1 — P1 — established: `.ctx-panel` would lag during ordinary scrolling

(a) The proposed permanent `transition: top 0.18s` is not limited to bar changes. `useColumnContext` measures the header every scroll frame and updates `ColumnRect.top` whenever it changes ([useColumnContext.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/useColumnContext.ts:128)). Near the masthead, that top settles over roughly the first 150px of scrolling ([useColumnContext.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/useColumnContext.ts:31)); React writes each new value inline ([ContextPanel.tsx:214](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/ContextPanel.tsx:214)).

Consequently, the planned transition ([plan:131](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md:131)) retargets on every early-page scroll frame, making the panel chase the column even though `data-bars` has not changed.

There is a second problem at a genuine bar flip: `place()` uses the panel’s currently interpolated rect ([ContextPanel.tsx:151](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/ContextPanel.tsx:151)). Once the panel finishes moving 44px, nothing places the current entry again, so it can finish off the documented 40% focus line ([column-context.md:71](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/project/column-context.md:71)). This is not two `top` assignments; it is one transitioned assignment combined with list placement based on its old visual position.

(b) Replace the second and third Stage 1 bullets with:

> `.ctx-panel` must not receive a standing `transition: top`: its measured inline `top` also changes during ordinary early-page scrolling. Scope the transition to an ephemeral bar-motion state set only when `data-bars` flips, and clear it after the panel transition settles. Re-place the list from the destination `rect.top`, and verify it again at `transitionend`.
>
> The browser pass must additionally scroll through `0–159px` without changing `data-bars` and assert every panel’s top remains equal to its `<th>` bottom. After both hide and reveal settle, assert the unclamped current entry is still centred on the 40% focus line.

### F2 — P1 — established: a jump during reveal can land under the bar

(a) The plan calls deep-link clearance “free” because `stickyOffset()` measures the transformed rect ([plan:179](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md:179)). That is only correct at rest.

On upward scroll, `watchBarVisibility` removes `data-bars` ([scroll.ts:310](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/scroll.ts:310)), starting the 180ms transform transition ([shell.css:473](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/styles/shell.css:473)). Halfway through, `stickyOffset()` returns the partially revealed `rect.bottom` ([scroll.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/scroll.ts:91)), and `scrollToBlock()` calculates its destination once from that smaller value ([scroll.ts:529](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/scroll.ts:529)). `markOurScroll` suppresses reactions to the jump; it does not stop the CSS transition already running. The bar therefore finishes at 44px over a target placed, for example, at 22px.

(b) Replace the deep-link done-condition with:

> Test a deep link and keyboard jump at rest and halfway through both the hide and reveal transitions. `stickyOffset()` must reserve the larger of the bar’s current coverage and its destination coverage, because `markOurScroll` prevents a new state change but does not stop an in-flight CSS transition.

### F3 — P1 — established: the overflow fade still animates under reduced motion

(a) The overflow fade is included in the planned `transition: top` list and visibly occupies the trailing 2rem of an overflowing table ([table.css:235](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/styles/table.css:235)). The global reduced-motion list omits it ([narrow-window.css:721](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/styles/narrow-window.css:721)). The plan adds `.ctx-panel` to that list but does not close the existing omission, then extends the fade’s motion to laptops.

(b) Add both visible additions to the reduced-motion block:

```css
.reader:has(table.zoom.overflowing)::after,
.ctx-panel {
  transition: none;
}
```

They can instead be branches of the existing selector list.

### F4 — P2 — established: the phone claim and browser matrix omit landscape

(a) “There are no panels on a phone” and “390px changes nothing observable” are true only of the measured portrait width ([plan:115](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md:115)). The small-device query also matches by height. At 844×390, it matches `max-height: 620px`, while 844px exceeds the 732px needed for one gist plus prose and spine: `176 + 544 + 12` ([layout.ts:62](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/layout.ts:62), [layout.ts:72](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/layout.ts:72)). A landscape phone can therefore have a `.ctx-panel`, and Stage 1 changes an already-live phone path.

(b) Replace the 390px claim with:

> At 390×844 there are no panels, so only the non-panel chrome is checked. Also test 844×390 in Hierarchy: the height query hides the bars while the width can fit a gist panel, making this the existing small-device panel path.

Add 844×390 to Stage 3’s matrix.

### F5 — P3 — established: the stated phone percentage is wrong

(a) [The plan says](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/plans/260907b-the-top-bar-leaves-while-you-read-at-every-width.md:47) 44px is a third of 390px. It is 11%; the former 124px three-bar stack was approximately a third.

(b) Replace it with:

> **44px is 11% of a 390px phone viewport and 5% of a 900px laptop viewport; the former 124px three-bar stack was nearly a third of the phone.**

The permitted baseline test passed: `tests/bar-visibility.test.ts`, 9/9. It covers `stepBar` arithmetic only, not these planned CSS and timing paths.