Verdict: **refuse**, on established P1s F8 and F10. F9 is also an established P1 unless changing comment stepping into browser-history navigation is an explicit product decision.

### F8 — P1 — established: jumping from the top returns below the top

Stage A says every origin comes from `measureRow()` and explicitly includes a top-of-article test ([plan:181](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:181), [plan:201](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:201)).

At the top, every row can be below the reading line. Nevertheless, `measureRow()` returns row `0`, because `activeSectionIndex` initializes to zero and clamps there ([keynav.ts:217](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/keynav.ts:217), [position.ts:103](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/position.ts:103)). The transaction therefore rewrites the predecessor to `?at=<first block>`. Back runs `scrollToBlock`, aligning that first row below the sticky chrome rather than restoring `scrollY=0` ([App.tsx:1583](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:1583), [scroll.ts:528](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/scroll.ts:528)). The masthead/top is lost.

Smallest correction:

> A jump origin is `{ kind: "top" } | { kind: "block"; blockId: BlockId }`. If `window.scrollY <= stickyOffset()`, record `top`, remove `?at=` from the predecessor, and render “back to beginning”. Otherwise map `blocks[measureRow()]` to a block origin. Stage C draws no tick, or a top-edge tick, for `top`.

The test must assert both the predecessor URL and the final `scrollY=0`, not merely that a stamp exists.

### F9 — P1 — established: Prev/Next becomes the scroll-history the contract rejects

Stage B2 makes both drawer selection and dialog Prev/Next push whenever the target is offscreen ([plan:222](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:222)). The visibility guard suppresses only nearby comments. Twenty questions distributed through an article still create roughly twenty entries.

That reverses the documented behavior: comment arrows are traversal through the article and intentionally behave like key navigation, writing no position history ([comments.md:347](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/comments.md:347), [comments.md:375](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/comments.md:375)). The general URL contract says Back must not crawl through repeated reading strides ([url-state.md:343](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/url-state.md:343)).

Smallest correction: split the two intents.

- Selecting a question from the drawer is an arbitrary jump and uses the transaction when offscreen.
- Dialog Prev/Next continues to replace `?note=` and scroll without pushing.
- Any stamp already present survives those replaces, so after traversing several questions the chip still returns to the place from which the reader entered that traversal.

Tests should assert that drawer selection adds one entry, while ten offscreen Prev/Next steps add none.

### F10 — P1 — established: “same block” does not imply “no movement”

Stage A suppresses the push when measured origin and target have the same block id ([plan:194](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:194)). But current `jumpTo` performs the history write and `scrollToBlock` as independent statements ([App.tsx:1667](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:1667)).

A tall paragraph can cross the reading line while its top is well above the viewport. Clicking a search result for that paragraph deliberately calls `onJump` even when it is visible ([App.tsx:5386](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:5386)). The ids compare equal, so the plan suppresses history, but `scrollToBlock` still moves to the row’s top. There is then no chip and no way back to the prior position.

Smallest replacement wording:

> When origin and target are the same block, abort the entire jump before changing `synced`, calling the setter, or calling `scrollToBlock`.

If preserving search’s “always visibly move” behavior matters, block identity is insufficient to make that motion reversible; that requires a separately designed finer origin.

### F11 — P2 — established: the atomic implementation shape remains unspecified

The plan correctly says not to use two independent nuqs setters, but it does not say which operation performs the predecessor replacement.

Two synchronous `setAt` calls are not a transaction. nuqs stores pending updates by key with `Map.set`, so the destination overwrites the origin; any push option upgrades the combined flush to a push ([debounce-Ynq26WfO.js:134](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/debounce-Ynq26WfO.js:134)). Even `throttle(0)` schedules the flush for a later task ([debounce-Ynq26WfO.js:174](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/node_modules/nuqs/dist/debounce-Ynq26WfO.js:174)). The likely result is one destination push and no predecessor rewrite.

Specify this code shape:

> `jumpTo` arms `{ pathname, origin, target }` and makes exactly one nuqs call: the destination push. When `watchHistoryWrites` intercepts the matching armed push, that wrapper synchronously invokes its captured inner `replaceState` to rewrite the current entry to the origin, then its captured inner `pushState` with the destination URL and stamped state. It consumes the arm in `finally` and emits `NAVIGATED` once after the pair. It never calls `setAt(origin)`. An arm is matched to its expected pathname and target so an unrelated push cannot consume it.

That is logically atomic with respect to nuqs’s queue. The History API cannot provide true rollback if the second native call throws, so “written together or not at all” should be softened to “performed synchronously as one wrapper-owned operation.”

### F12 — P2 — reasoned: indefinite persistence needs an explicit escape

After a jump, ordinary scrolling repeatedly replaces the destination entry while preserving its stamp. Consequently the fixed chip and spine tick can remain for the rest of a long reading session ([plan:191](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:191), [plan:211](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/plans/260906g-back-to-where-you-jumped-from.md:211)). It remains semantically truthful, but on a phone it permanently occupies reading space after the reader has chosen to continue onward.

A better rule than another inferred hide heuristic is explicit dismissal: a small close control strips only the current entry’s stamp with `replaceState`. That cannot recreate F2 because no valid return disappears without a reader action.

On the three suspicions:

1. Rewriting `?at=` at jump time is defensible and strengthens “the URL is current”: it records a truthful, finer block immediately before leaving. It does not introduce shareable state. The top case in F8 is the exception that must be represented explicitly.
2. The `isBlockOnScreen` guard is insufficient for comment stepping; F9.
3. Never hiding is semantically sound, but explicit dismissal is safer than any section- or distance-based automatic rule.

No files were changed. I did not spend the single-test allowance: the findings are established directly by the plan and the relevant pure implementation paths, while the existing test files contain no revised implementation to exercise.