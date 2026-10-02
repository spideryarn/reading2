The direction is sound, but the plan is not ready to build unchanged. No P0 findings; three P1s need resolving.

## Findings

### P1 — Bar appearance is a layout change, but `layoutKey` will not change

The experimental setting begins as `on: false` and may become true asynchronously ([experimental-store.ts:89](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/experimental-store.ts:89)). An owner can also toggle it while reading. That mounts or removes a 44px, in-flow sticky element immediately above the table ([shell.css:482](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/shell.css:482)).

However, `layoutKey` contains only horizontal-layout facts ([Reader.tsx:506](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/Reader.tsx:506)). Bar presence must become part of it, because:

- `useReadingPosition` uses `layoutKey` specifically to re-anchor the saved section after reflow ([useReadingPosition.ts:67](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/useReadingPosition.ts:67)).
- Structure’s `useColumnContext` remeasures on `layoutKey`, scroll, resize, or table resize ([useColumnContext.ts:48](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/useColumnContext.ts:48)). Moving the whole table down does not resize the table, so its `ResizeObserver` is insufficient.
- `OnScreenLinksStyle` has the same problem: its effect is keyed on `enabled` and `layoutKey`, while its observer sees size changes, not a changed top position ([OnScreenLinksStyle.tsx:40](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/OnScreenLinksStyle.tsx:40)).

As written, turning the feature on can leave Structure highlighting the pre-bar section while the newly mounted breadcrumb measures the post-bar section. On-screen link highlighting can also remain stale until the next scroll or resize.

Compute bar presence before `layoutKey` and include it in the key, or explicitly invalidate all three consumers.

### P1 — The “band covers” predicate mishandles `bandAway`

The plan proposes:

```ts
experimental.on && !(bandOpen && fit.modeW === 0)
```

But a covering band can step aside while remaining mounted. In that state `.mode-band` is `display: none` ([narrow-window.css:391](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/narrow-window.css:391)), the prose is visible, and `bandOpen && fit.modeW === 0` remains true. The existing correct definition of “the band is actually over the prose” includes `!bandAway` ([Reader.tsx:518](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/Reader.tsx:518)).

Therefore, after following a band link on a phone, the owner would read the prose without the supposedly always-present breadcrumb.

This cannot be fixed entirely casually: making the bar appear in the same render as `bandAway` changes layout during a jump, while the URL write is deferred by about 50ms ([useReadingPosition.ts:245](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/useReadingPosition.ts:245)). Either:

- arrange for the bar to appear after the jump’s position has settled, or
- explicitly document “hidden for the whole lifetime of a covering mode, including while its band has stepped aside” as a deliberate v1 exception.

The current rationale—“there is no prose under the bar”—is false in `bandAway`.

### P1 — “Same sampler” would actually mean duplicate samplers

Structure already calls `useColumnContext` inside `StructureBand` ([StructureMode.tsx:193](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/modes/structure/StructureMode.tsx:193)). A breadcrumb component calling the hook itself creates a second independent scroll listener, rAF, full section-rect scan, resize listener, and `ResizeObserver` ([useColumnContext.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/useColumnContext.ts:54)). `useReadingPosition` already performs another section-rect scan on scroll, with a comment recording that this class of work was once 38.1% of script time on a long article ([useReadingPosition.ts:146](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/useReadingPosition.ts:146)).

Thus an experimental reader in Structure gets three position samplers, and the two `useColumnContext` instances can publish on different frames. That is shared machinery, not the “same sampler.”

Run one `useColumnContext` instance at their nearest common owner—enabled when either crumbs or Structure needs it—and pass `focusRow` to both. That is both cheaper and a literal guarantee that they cannot disagree.

### P2 — The integration and documentation matrix is missing

The plan’s tests cover path arithmetic and the leaf component, but not the risky wiring:

- owner, switch off: no `.controls`;
- owner, switch on: bar and crumbs;
- owner, side-by-side band: bar remains and is pinned;
- owner, covering band and `bandAway`;
- visitor: existing chip/bar unchanged;
- asynchronous experimental-setting load and a mid-read toggle;
- CSS guard presence and bar-dependent `layoutKey`.

I found no tracked test directly asserting that an owner has no `.controls`; the larger risk is the many comments and docs that currently encode that assumption:

- [Reader.tsx:1947](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/reader/Reader.tsx:1947)
- [shell.css:674](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/shell.css:674)
- [shell.css:737](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/shell.css:737)
- [PublicChrome.tsx:81](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/PublicChrome.tsx:81)
- [narrow-windows.md:161](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/docs/project/narrow-windows.md:161)

`barHasContent` no longer exists in `layout.ts`; references to it are historical leftovers. The plan’s docs list should include correcting these owner/visitor claims.

### P2 — “Before the first section” needs an explicit answer

`activeSectionIndex` deliberately clamps to the first eligible section ([position.ts:101](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/position.ts:101)), and `useColumnContext` falls back to row zero ([useColumnContext.ts:77](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/useColumnContext.ts:77)). Consequently, while the focus line is still in a tall masthead, the breadcrumb will usually claim the first section rather than show no location.

That matches Structure today, so it is defensible. But the planned “row before the first section” test should state that expected behaviour plainly. Also decide what happens when the path has no drawable labels; `showBar` currently depends on feature eligibility rather than a non-empty path, so an owner could receive a blank 44px bar.

## What is sound

Reusing `.controls` is mechanically sound after the layout invalidation is fixed:

- It is scoped as a direct child by `controlsBar()` ([scroll.ts:18](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/scroll.ts:18)).
- `stickyOffset()` will measure the owner’s bar correctly.
- `--bar-bottom` already moves the mode band, zero-height table head, spine, overflow fade, and marginalia head together.
- In a side-by-side band, `.controls` starts after `--mode-w`, so it sits over the prose side rather than over the band ([shell.css:522](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/shell.css:522)).
- With Marginalia, it spans the prose plus marginalia region—not strictly prose only—but `.marg-head` correctly moves below it ([marginalia.css:185](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/styles/marginalia.css:185)).

The guard change is correct if `.crumbs` is added as another argument to the existing second `:has(...)`:

```css
:root:has(BAR):has(
  BAR:focus-within,
  BAR > .crumbs,
  :where(.reader.band-covers) .mode-band
)
```

`BAR > .crumbs` and `BAR:focus-within` both contribute `(0,2,0)`, so the selector remains `(0,4,0)`. Do not add it as a third chained `:has()`, which would raise specificity. Suppressing crumbs and the owner bar under an actually covering band also lets the existing no-bar rule put the band at `--safe-top`, as intended.

`buildSummaryTree(..., sectionDepth(geometry))` is the right path source:

- `sectionDepth` is the same depth `buildSections` uses ([position.ts:52](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/position.ts:52)).
- `nodeLabel` gives the same title/nav-label and voice as Structure.
- `buildSummaryTree` stops at the requested depth and collapses apparatus into one unnumbered leaf ([tree.ts:510](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/tree.ts:510)).
- Folding belongs in the position sampler, not `crumbPath`; `useColumnContext` already skips hidden section starts ([useColumnContext.ts:74](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/useColumnContext.ts:74)).

On unusually deep trees, the breadcrumb may show more nested levels than Structure’s two-column face, whose “current section” is only a direct child of the current part ([structure.ts:528](/home/greg/code/spideryarn2/.claude/worktrees/fbm3pteb-headings-breadcrumb/src/web/structure.ts:528)). That is reasonable, but the plan should say “the same source tree,” not literally “the path Structure draws.”

Overall: keep the `.controls` design and `buildSummaryTree` path, but fix the layout invalidation, settle the `bandAway` behaviour, and share one position sampler before implementation.