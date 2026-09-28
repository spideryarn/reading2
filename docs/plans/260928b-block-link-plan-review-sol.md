## Findings

**F1 — P1 — Flash completion is underspecified and the timeout alternative is incorrect.**  
Evidence: the plan permits either a completion hook or waiting `SCROLL_MS` ([plan:85](/home/greg/code/spideryarn2/.claude/worktrees/block-link/docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md:85)). But `glide` can end through wheel, touch, pointer cancellation, replacement by another scroll, an instant reduced-motion branch, a sub-pixel early return, or a missing row ([scroll.ts:641](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/scroll.ts:641), [scroll.ts:653](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/scroll.ts:653), [scroll.ts:737](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/scroll.ts:737)). A timer cannot distinguish those outcomes and will flash after an interrupted jump or miss instant/no-distance behavior.

The already-there branch also returns without cancelling a previous glide ([keynav.ts:340](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/keynav.ts:340)); a search press while another glide passes through that block could start the flash and then keep carrying the block away.

Concrete fix: make `scrollToBlock` expose an explicit settled/cancelled/not-found outcome or success callback. Fire success synchronously for instant and sub-pixel arrivals, on the last animation frame for a completed glide, and never after cancellation or a missing row. Cancel any in-flight glide before flashing the already-there target. Test all of those paths; remove the timeout option from the plan.

**F2 — P1 — In several supported layouts the proposed flash is absent or hidden for its whole lifetime.**  
The plan targets only `tr[data-block] td.text` ([plan:93](/home/greg/code/spideryarn2/.claude/worktrees/block-link/docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md:93)), but `td.text` is rendered only when `showText` is true ([TableView.tsx:1712](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/TableView.tsx:1712)). Block ranges remain clickable in outline mode, where there is no prose cell. On narrow screens most mode bands cover the entire article ([narrow-window.css:326](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/styles/narrow-window.css:326)); only Trajectory currently steps its band aside ([narrow-window.css:368](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/styles/narrow-window.css:368)). A Search, Glossary, Ideas, or Claims jump can therefore complete and exhaust its 1.2-second flash behind the full-screen band.

Concrete fix: decide the product behavior before building. Either:

- defer the pending flash until a prose cell is both mounted and exposed;
- make all passage jumps from a covering band step it aside, with a clear route back; or
- define and test a visible outline-mode fallback.

The current iPad browser step should explicitly test a covering band and outline mode, not merely an iPad viewport.

**F3 — P1 — Much of group B is not “only go to this passage,” contrary to the inventory.**  
Search selects the exact hit before jumping ([SearchMode.tsx:393](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/modes/search/SearchMode.tsx:393)); Ideas and Timeline select the exact occurrence ([IdeasPanel.tsx:437](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/IdeasPanel.tsx:437), [TimelinePanel.tsx:700](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/TimelinePanel.tsx:700)); one Criteria row does the same ([CriteriaPanel.tsx:1494](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/CriteriaPanel.tsx:1494)). Trajectory updates its route, may hide the band, and supports a disabled missing-stop state ([TrajectoryMode.tsx:304](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/modes/trajectory/TrajectoryMode.tsx:304), [TrajectoryPanel.tsx:252](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/TrajectoryPanel.tsx:252)). Those are controls under the plan’s own rule at lines 58–60, yet all are listed for migration and Trajectory is explicitly promised at line 178.

For modified anchor clicks, those side effects would not run: a new Search tab would lose the exact-hit ring, and a Trajectory link would preserve the old `stop` in its `href`. Anchors also have no native `disabled`. Ideas and Timeline additionally style `> button`, so merely retaining the class will not retain their appearance ([ideas.css:147](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/styles/ideas.css:147), [timeline.css:167](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/styles/timeline.css:167)).

Concrete fix: enumerate the migration rather than deciding it ad hoc:

- Migrate the three pure Claims links, the pure Criteria placement at line 1441, Sketch, and ProseHoverCard.
- Keep Search, Ideas, Timeline, the composite Criteria result, and Trajectory as buttons; they receive the flash through `beginJump`.
- For Mirror, preserve its existing provenance tooltip rather than silently replacing it with the generic card.

**F4 — P1 — A Floating UI instance per `BlockRef` is unsafe on long articles.**  
Every `Tooltip` mounts `useFloating` plus its interaction hooks ([Tooltip.tsx:125](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/Tooltip.tsx:125)). The project already uses one delegated floating panel when a page can have hundreds of triggers. `TableView` renders `BlockRange` repeatedly ([TableView.tsx:1688](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/TableView.tsx:1688)), Glossary emits one ref per occurrence ([GlossaryPanel.tsx:1394](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/GlossaryPanel.tsx:1394)), and literal search returns every occurrence without a cap ([search-hits.ts:327](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/search-hits.ts:327)). The plan would add a hook stack per link to precisely the long-document tree whose rerenders were previously optimized away.

Concrete fix: make the Reader-level provider own one delegated/virtual-reference block tooltip, with lightweight data attributes or registration on each anchor. At minimum, benchmark mount and hover behavior on the existing 2,046-block fixture and establish a budget before accepting per-link instances.

**F5 — P2 — The context shape needs a stable, precomputed metadata index.**  
The plan proposes two lookup functions calling `sectionIndexContaining` ([plan:102](/home/greg/code/spideryarn2/.claude/worktrees/block-link/docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md:102)). That resolver maps all sections on each call ([position.ts:128](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/position.ts:128)). An inline context object or fresh closures would also wake every `BlockRef` consumer whenever Reader rerenders, bypassing `TableView`’s memo boundary; Reader already documents dozens of position-driven renders ([Reader.tsx:1288](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/reader/Reader.tsx:1288)).

Concrete fix: build one memoized `Map<BlockId, {text, section}>` in linear time and use that map itself as the stable context value. React context is otherwise a reasonable seam, and React portals retain it.

**F6 — P1 — An id-wide `aria-label` would destroy the accessible name of migrated quote links.**  
The plan says the id remains “in `aria-label` territory” while adding arbitrary `children` ([plan:111](/home/greg/code/spideryarn2/.claude/worktrees/block-link/docs/plans/260928b-one-block-link-component-with-a-rich-tooltip-and-a-flash-on-arrival.md:111)). On a migrated Claims or Sketch link, `aria-label="spya-…"` overrides the visible quotation or “Go to this passage,” so a screen-reader user hears an opaque identifier instead of the link’s visible purpose.

Concrete fix: use the short/full id as the accessible name only for the default id-chip rendering. When `children` are supplied, let their text name the anchor; expose section/preview through the tooltip’s `aria-describedby`. For the missing-block span, put the unavailable explanation in visible or screen-reader text—the proposed non-focusable span cannot expose a hover/focus-only tooltip to keyboard users.

**F7 — P2 — `beginJump` is a defensible scope, but it is not “every deliberate jump.”**  
Back/Forward, pasted links, and initial arrival use the restore effect and call `scrollToBlock(..., "auto")` directly ([useReadingPosition.ts:53](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/reader/useReadingPosition.ts:53)). The Return chip deliberately uses `history.go` ([ReturnChip.tsx:80](/home/greg/code/spideryarn2/.claude/worktrees/block-link/src/web/ReturnChip.tsx:80)). Trajectory stepping/depth changes, comment Prev/Next, keyboard, swipe, and `BlockNav` also bypass `beginJump`. Conversely, `beginJump` will flash non-link controls such as glossary selection and diagram nodes.

Concrete fix: state the scope accurately as “history-pushing in-place jumps,” and decide explicitly whether Return/deep-link arrival should flash. If the requirement is specifically “pressing a block link,” the current scope plus deliberate control flashes is reasonable; if it is “every arrival,” `beginJump` alone cannot implement it.

I found no production caller that clearly needs an absent current-article id to remain a working link. The proposed missing-id non-link rule is consistent with stale Glossary/Citation data and the existing block-id contract.

## Verdict

**Build with changes:**

1. Specify a cancellation-aware scroll-settlement API; no timer fallback.
2. Resolve hidden/unmounted prose behavior before implementation.
3. Correct group B to exclude composite controls.
4. Use one shared tooltip instance, or prove per-link cost on the long fixture.
5. Memoize a precomputed block metadata map.
6. Preserve child-derived accessible names.
7. Define the flash scope precisely and test its exclusions.