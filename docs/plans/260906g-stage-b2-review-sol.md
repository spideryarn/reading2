## Verdict: refuse

F10, F22, and F23 are established P1s. All three produce user-visible movement/history inconsistent with the selected question.

### Findings

**F10 — P1 — established: the same-block bug survives in traversal**

This is the same finding, so I am reusing F10.

`isBlockOnScreen` requires the entire row to fit between the bars ([scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/scroll.ts:666)). A paragraph taller than the viewport can never satisfy that predicate. Consequently, stepping between two comments in that paragraph calls `scrollToBlock` and jolts to its top ([comment-jump.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/comment-jump.ts:102)), contradicting the no-jolt contract in [comments.md](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/comments.md:375).

I reproduced a row crossing the reading line with `top=-300`, `bottom=1200`: `isBlockOnScreen` returned false and the step scheduled a glide from `scrollY=1000` to `700`.

The drawer’s behavior is the accepted F10 trade: it opens the dialog, then `beginJump` aborts without movement or a push. That is defensible because the dialog is visible feedback. The traversal path does not pass through that abort and remains wrong.

Smallest fix: treat a target row crossing the reading line as “already here” in the shared comment decision, then add a real-scroll tall-row test.

**F22 — P1 — established: an on-screen step does not stop the glide that is about to carry it away**

When the target is currently on screen, `passageToBringIntoView` returns `null`, so neither caller enters `scrollToBlock` ([comment-jump.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/comment-jump.ts:53)). But `scrollToBlock`/`glide` is also where an existing animation is cancelled; `cancel` is private ([scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/scroll.ts:411)).

Concrete sequence:

1. A movement to question A starts the 200ms glide.
2. While passing its previous question B, B is comfortably on screen.
3. Press Prev. `?note=` changes to B, but the visibility guard does nothing else.
4. The old glide continues to A and leaves B off screen.

I reproduced this directly: halfway through the glide B was at `top=200`; after Prev, `glideTarget()` remained A; at completion B was at `top=-300`.

Smallest fix: expose a narrowly named scroll-cancellation function and invoke it when a comment target is already visible. The test must use the real glide rather than the current `scrollToBlock` mock.

**F23 — P1 — established: selecting an orphan comment pushes without moving**

Orphan comments are explicitly retained and sorted to the end of the list ([comment-nav.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/comment-nav.ts:24), [comments.md](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/comments.md:608)). For their missing row:

- `isBlockOnScreen` returns false.
- `jumpToComment` invokes `jumpTo`.
- `beginJump` pushes `?at=<missing block>`.
- `scrollToBlock` finds no row and returns without movement.

I reproduced `history.length` changing from 1 to 2 while the scroll count stayed zero. The resulting chip offers a return from a journey that never happened.

The test misses this because its mock records every `scrollToBlock(id)` invocation as a scroll, whereas the real function returns at its missing-row guard ([comment-jump.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/tests/comment-jump.test.ts:44), [scroll.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/scroll.ts:529)).

Smallest fix: make the shared lookup distinguish `missing`, `visible`, and `offscreen`. Missing should open the dialog only; it must neither push nor scroll.

**F24 — P2 — established: the seventh closure labels a comment ID as a block ID**

`openCommentDialog` declares `id: BlockId` ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/App.tsx:2917)), but TableView supplies IDs read from `data-comment` and `Comment.id` ([TableView.tsx](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/web/TableView.tsx:1368)). It compiles only because `BlockId` is currently an alias for `string` ([types.ts](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/src/types.ts:32)).

The behavior is otherwise correct: both the inline mark and gutter button are controls attached to the visible block, so opening the dialog without movement or a push is right.

Smallest fix: declare the callback parameter as `string`—or `CommentId` if that type is introduced later.

**F25 — P3 — established: `url-state.md` still calls gist clicking “the one exception”**

[url-state.md](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/url-state.md:349) says the sole push-producing scroll exception is clicking a gist. Drawer question selection is now another deliberate jump and push.

Smallest fix: describe the exception as “a deliberate jump” and give gist and drawer selection as examples.

**F26 — P3 — established: two sentences in `comments.md` overstate the implementation**

[comments.md](/home/greg/code/spideryarn2/.claude/worktrees/back-to-where-you-jumped-from/docs/project/comments.md:396) says arrows “replace `?note=` … and write no history”; they do write history with `replaceState`, but add no entry. Line 405 says both paths ask `isBlockOnScreen` “first”, whereas both call `setNote` first.

Smallest fix: say “add no history entries” and “check visibility before moving.”

### Requested checks

The six named App call sites are wired correctly today:

- Both owner and visitor drawer closures call `openCommentFromDrawer`.
- All four owner/visitor Prev/Next closures call `stepToNeighbouringComment`.

There is no cheap honest type-level guarantee here: both intents ultimately consume the same comment ID and perform side effects. A discriminated action would make intent clearer but cannot stop a caller choosing the wrong discriminant. Strong nominal/capability types would require redesigning the component boundary. The cheap protection is an App-level wiring regression test.

The nuqs same-tick claim is correct for ordinary paths. Its global queue stores updates by key, and any queued push upgrades the combined flush. It also queues a setter when the new value equals the current value. Therefore:

- Off-screen selection: `note` and `at` land in one pushed entry.
- On-screen selection: only `note` is replaced; no entry is added.
- Selecting the same comment again while it remains visible: a same-URL replace, no added entry.
- Selecting it again after scrolling away: one combined push.

F22 and F23 are the exceptions where the history operation succeeds but the physical movement does not match it.

Eight focused suites passed: 236 tests. The two direct DOM reproductions above also passed. No files were changed.