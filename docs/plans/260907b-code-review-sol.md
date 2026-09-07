DO NOT LAND. Three established P1s remain.

### F6 — P1, established: focus guards move the bar without notifying the panels

(a) [`useColumnContext.ts`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/useColumnContext.ts:191) observes only `data-bars`, but the bar can move while that attribute remains `"hidden"`:

1. Focus a Hierarchy pill.
2. Scroll down past the hide threshold. `data-bars="hidden"` is set, but `:focus-within` keeps the bar and header at 44px.
3. Let the 400ms backstop clear `data-bar-moving`.
4. Move focus into the prose without scrolling.

The focus guard stops matching, so CSS moves the bar and header, but neither `startMoving()` nor the MutationObserver runs. The panel remains 44px out of step until another scroll/resize. Tabbing into an already-hidden bar fails in the opposite direction. This violates both the panel and keyboard invariants.

(b) Treat the bar’s actual transform as another movement source and observe that signal:

```ts
const controls = document.querySelector<HTMLElement>(".controls");
const onTransitionRun = (e: TransitionEvent) => {
  if (e.target === controls && e.propertyName === "transform") startMoving();
};
controls?.addEventListener("transitionrun", onTransitionRun);

// teardown:
controls?.removeEventListener("transitionrun", onTransitionRun);
```

Then in `useColumnContext`:

```ts
attributeFilter: ["data-bars", "data-bar-moving"],
```

Add a test that hides while a pill is focused, waits out the backstop, then blurs without scrolling and expects a fresh measurement.

### F7 — P1, established: the first half of a notched-device reveal still under-reserves

(a) [`stickyOffset()`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/scroll.ts:189) treats `rect.bottom <= safeTop` as fully hidden. On the test’s 47px inset, a revealing bar travels from bottom `0` to `91`; throughout bottom `0…47`, the function returns `47` although its destination requires `91`.

I reproduced the exact input with the permitted script:

```text
safeTop=47, barBottom=23.5
stickyOffset()=47
required destination=91
```

Thus a jump early in the reveal can still finish under the bar.

(b) For destination prediction, only a bar completely above the viewport is hidden:

```ts
if (rect.bottom <= 0) return safeTop;
return rect.height + safeTop;
```

Add this missing case:

```ts
poseBar(SAFE_TOP / 2, SAFE_TOP);
expect(stickyDestinationOffset()).toBe(SAFE_TOP + BAR_H);
```

### F8 — P1, established: destination prediction is now used by current-position readers

(a) `stickyOffset()` is not only used for destinations. [`measureRow()`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/keynav.ts:224), the URL position tracker, `isBlockOnScreen`, and `whereIsBlock` ask where the reader is now.

For a mid-hide bar with `safeTop=47` and bottom `69`:

```text
old/current coverage = 69
new/destination prediction = 91
row tops [0, 80, 120]:
old measured row = 0
new measured row = 1
```

Consequently, pressing ↓ during the transition can treat the next paragraph as current and skip directly to the one after it. This is a state where the new expression is materially worse than the old.

(b) Split the two meanings:

```ts
function stickyOffsetFor(destination: boolean): number {
  const safeTop = safeAreaInsets().top;
  const bar = document.querySelector<HTMLElement>(".controls");
  if (!bar) return safeTop;

  const rect = bar.getBoundingClientRect();
  if (destination) {
    return rect.bottom <= 0 ? safeTop : rect.height + safeTop;
  }
  return Math.max(safeTop, Math.min(rect.height + safeTop, rect.bottom));
}

export const stickyOffset = () => stickyOffsetFor(false);
const stickyDestinationOffset = () => stickyOffsetFor(true);
```

Use `stickyDestinationOffset()` only in `scrollToBlock()` and `scrollByScreen()`.

### F9 — P2, established: automated tests do not prove the width gate was removed

(a) [`bar-motion.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/tests/bar-motion.test.tsx:150) stubs `matchMedia().matches` to `true`. Reintroducing the old gate under any name still passes it. [`spine-width.test.ts`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/tests/spine-width.test.ts:260) only forbids the spelling `SMALL_DEVICE =`.

(b) Set the stub to `matches: false`. The current unconditional watcher still passes; any reintroduced wide-screen gate fails functionally. The regex assertion can then be removed.

### F10 — P3, established: several source comments still describe the removed gate

(a) Stale claims remain in:

- [`App.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/App.tsx:1792): says only short viewports attach the listener and laptops pay nothing.
- [`tokens.css`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/styles/tokens.css:125): says `--bar-bottom` changes only on small devices and points to the old owner.
- [`column-context.css`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/src/web/styles/column-context.css:241): says the transition comes from `narrow-window.css`.
- [`260905g`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md:40): says the Hierarchy bar stays.
- [`bar-motion.test.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/hierarchy-column-controls/tests/bar-motion.test.tsx:136): says the watcher asks the breakpoint.

(b) Replace those claims with: “The top-bar switch and listener apply at every width and are owned by `shell.css`; only the Dock’s half remains in `narrow-window.css`.”

I found no cascade regression: all moved rules remain in `layer(app)`, the guards retain higher specificity, later files do not overwrite the moved top-bar properties, and the Dock remains gated. The `.mode-band` decision is coherent, and the 24px threshold is product tuning rather than a correctness defect.

The live candidate changed during review to filter `transitionend` by both target and `"transform"`; the new bubbling test passes. I ran `tests/bar-motion.test.tsx`: 4/4 passed.