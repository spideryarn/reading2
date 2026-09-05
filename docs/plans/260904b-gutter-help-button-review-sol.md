## Verdict

I would not let stage 3 be built as written. The product decisions are workable, including one-click spending and reusing the chat panel, but the plan misses several hard implementation constraints:

1. the route rejects anchored non-`chat` threads;
2. the database rejects `kind = 'help'`;
3. the proposed sending primitive is not available from the gutter;
4. the double-tap mitigation is not race-safe;
5. detached pending-state reconciliation is substantially more work than the plan acknowledges.

Stage 1 is independently shippable after correcting its vertical arithmetic and prose-width consequences.

## Ranked findings

### 1. Blocker: an anchored `help` request is currently rejected twice

The chat route explicitly permits anchors only when `wantedKind === "chat"` in [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/routes.ts:2270). A request containing both `kind: "help"` and `{ blockId }` will return 400 before reaching the model.

Postgres also constrains `chat_threads.kind` to `chat`, `remember`, or `candidates` in [schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/db/schema.ts:2908) and the corresponding migration.

The plan needs:

- an additive migration widening that check;
- the schema definition updated in parallel;
- an explicit route rule admitting anchored `help`;
- request tests proving anchored help succeeds and inappropriate anchored kinds still fail.

Without these changes, the core feature cannot work.

### 2. Blocker: “send via `onSendNew`” is not an implementation seam the gutter can use

`onSendNew` is a callback closed over the `useChat` instance inside `ConversationBand` in [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:4157). That component is not mounted while the reader is simply viewing the article. `ChatDialog` owns a separate `useChat` instance.

The code deliberately avoids hoisting streaming chat state into `Reader`, because each token would rerender `TableView`. Therefore the plan must name an actual isolated launch mechanism, such as:

- a `ChatTarget` variant that tells `ChatDialog` to auto-send exactly once after mounting; or
- a small launcher/controller component that owns `useChat` without putting streaming state above `TableView`.

This also needs an exactly-once test covering React remounts/Strict Mode. “Open the draft and immediately call `ask()`” is not sufficiently specified.

### 3. Blocker: adding `ThreadKind` has silent failures beyond the exhaustive checks

The compiler will identify some omissions:

- exhaustive `systemFor` in [converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/converse.ts:774);
- `Record<ThreadKind, string>` titles in [useChat.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/useChat.ts:301);
- `ConversationKind = Exclude<ThreadKind, "candidates">` in [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:3806), which will accidentally admit `help` where a reading `Mode` is expected.

It will not catch these:

- [export.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/store/export.ts:610) exports every non-remember thread as `"chat"`, silently losing `help`;
- [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/App.tsx:1906) opens the overlay only when the target thread is exactly `"chat"`, so “press again to open the existing help thread” will fail;
- [ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:185) does not send a target kind, while its optimistic summary hardcodes `"chat"`;
- labels and several negative/default string comparisons will treat help as ordinary chat silently.

The summary endpoint itself returns `thread.kind` generically, so it is fine once persistence is fixed. `noUncheckedIndexedAccess` will not protect the default branches and string comparisons.

### 4. High: the 2 × 2 choice is right, but the stated vertical arithmetic is wrong

The proposed horizontal arithmetic is good:

- `--text-pad-l: 3.7rem` = 59.2px at the normal 16px root;
- `.blk-gutter` at `3rem` = 48px;
- two 24px columns fit exactly, leaving about 5.6px on each side.

A 2 × 2 pad is the smallest sensible arrangement for four 24px targets. A single column would need roughly 100px of row height; four across would consume roughly 100px of measure.

Vertically, however, the current gutter begins around 9.15px from the top: one block pad plus `.2rem`, from [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:9398) and [tokens.css](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles/tokens.css:200). A 52px grid plus comparable bottom breathing room requires roughly 67px, not 56px.

A simpler option the plan has missed is a 48 × 48 grid with no explicit row gap. Enlarging the targets from roughly 15px to 24px already increases the visible glyph separation substantially. If a 4px row gap remains, the floor/top positioning must be recalculated and browser-measured before implementation.

### 5. High: the row-height floor should not literally apply to every row

Four slots are not “always occupied”:

- visitors have only the permalink;
- bookmarks are conditional;
- owners normally have permalink, chat, and help, plus bookmark when present.

CSS can reserve an empty grid cell, but visitor rows do not need a two-row floor. The floor should be tied to the owner/help-pad capability unless uniform visitor spacing is an explicit design choice.

`height` on these `<td>` elements acts as a minimum in the current table layout, which is why the existing `.has-marks` rule works. Content or rowspans can still make the row taller.

The heading rules need to be rewritten deliberately:

- ordinary headings currently bottom-anchor the gutter;
- commented headings switch back to top anchoring in [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/styles.css:9467).

Once owner headings are floored, leaving those selectors untouched will preserve inconsistent placement and can cause overflow with the plan’s 56px floor. Test ordinary headings, first headings, bookmarked/commented headings, and long headings separately.

### 6. High: the one-click deduplication is not safe against two taps in one render

“An existing help thread opens instead of sending” handles later presses after state has rendered. It does not handle two events in the same tick: both handlers can observe the old summaries and mint separate thread IDs.

The existing composer guard is local to the active composer and cannot be reused directly by a gutter button. The gutter launch path needs a synchronous latch/ref keyed by block, set before any asynchronous work or state update, with a test that invokes the handler twice synchronously.

If “one help thread per block” is a durable invariant across stale tabs, client deduplication is insufficient; it needs server/store idempotency. If it is only an accidental-double-tap safeguard, the synchronous latch is probably proportionate.

### 7. High: the Cancel diagnosis is right, but the proposed one-component fix is incomplete

On a new thread’s first answer, `ChatDialog` classifies the state as `firstAnswer`, and its header X calls `cancelAndDiscard`, `onDropped`, and `onClose` in [ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:229). The server then aborts if possible and deletes the thread. So yes: clicking X destroys the answer.

A help-kind check in `ChatDialog` is the correct locus, but two controls must change:

- header X must mean close/detach for help;
- the footer Stop control is currently hidden during `firstAnswer` in [ChatDialog.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/ChatDialog.tsx:345). If the header stops being Cancel, help otherwise has no cancellation control at all.

Escape already closes without discarding.

Use a target-level help discriminant rather than only `thread?.kind`, because the stored thread may not yet be loaded during the “Starting…” interval.

### 8. High: the orange pending indicator is not “nearly free”

The existing `.dock-count.pending` is the Comments badge, driven by pending comments in [Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/Dock.tsx:863). The dock receives no chat-summary pending state.

`ThreadSummary` also contains no pending field, its endpoint returns only kind/turn metadata, and `useChatAnchors` fetches summaries once rather than polling. If the panel is closed and its hook unmounts, nothing currently clears an optimistic orange state when the detached response finishes.

The plan needs to decide:

- which dock control owns the help count—probably Chat, not Comments;
- how pending status reaches it;
- how completion reconciles after the streaming component has detached.

That likely requires a persistent background completion signal, summary polling/refetch, or a server-exposed pending state. Reusing the CSS class is trivial; the state lifecycle is not.

### 9. Medium: widening changes prose geometry, but not through the 731px breakpoint

I found no JavaScript literal for the gutter width in `TableView`, `position.ts`, or the search-hit geometry. Positioning is based on live DOM rectangles.

However, [layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/layout.ts:88) says `PROSE_ALONE_MAX_REM` includes the left and right padding so that a lone prose column preserves its intended line measure. Increasing the left padding by 1.6rem without increasing that cap reduces the maximum inner prose measure by 1.6rem. If preserving the wide-view measure is intended, the cap should rise correspondingly.

Conversely, keeping `PROSE_MIN` unchanged deliberately removes 25.6px from the text at narrow/multicolumn widths. That appears consistent with Greg’s accepted tradeoff.

The 731px media query is based on `GIST_MIN + PROSE_MIN + SPINE_W`, not `--text-pad-l`. `tests/spine-width.test.ts` does not inspect the gutter padding, so it is not a meaningful gate for this CSS change unless `PROSE_MIN` also changes.

The plan also has the direction backwards: larger left padding moves the prose right within its cell, not left. The search-hit bar remains at the cell’s left edge, so it becomes visually farther from the prose even though its geometry does not break.

### 10. Medium: detached generation mostly works, but its guarantee starts only after the request reaches the server

The current lifecycle is sound after the server creates the pending row:

- closing the panel detaches callbacks but does not abort the client request;
- the server deliberately continues model work after an HTTP disconnect;
- completion or failure is stored;
- a later mount scans unresolved pending rows and polls for recovery.

Consequences by case:

- **Close panel mid-stream:** continues and persists; reopening may poll rather than reattach to token-by-token streaming.
- **Navigate to another article in the SPA:** the old controller can continue independently.
- **Background tab:** generally continues; browser timer throttling matters less because the server owns the work.
- **Lock phone or close the tab:** transport may disappear, but the server still finishes if it already accepted the request and wrote the pending row.
- **Failure before the server accepts the request:** only optimistic client state existed, so “walk away” is not guaranteed.
- **Press help on a second block:** launches another model call in parallel.

There is no meaningful per-user/article chat concurrency cap; serialization is principally per thread. I would not make a concurrency cap a release blocker, because one-click spending was explicitly accepted, but the plan should record that several blocks can spend concurrently and add at least the per-block synchronous guard.

### 11. Medium: the example human message will not contain the claimed opening quotation

`askAboutBlock` only inserts quoted text when its `quote` argument is supplied in [chat-handoff.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/web/chat-handoff.ts:55). `ChatDialog.ask()` currently supplies that only for selection anchors, not whole-block anchors.

Therefore the plan’s example containing the block’s opening words will not result automatically. The help launcher must pass the opening explicitly while retaining the structural `{ blockId }` anchor. Add an exact-message test.

### 12. Prompt/cache decision is sound, with one necessary explicit branch

`anchorSection` feeds the final user message below the cached article breakpoint in [converse.ts](/home/greg/code/spideryarn2/.claude/worktrees/gutter-help-button/src/converse.ts:1124). That is the right place for the help addendum and does not invalidate the system/article prefix cache.

`webSearchTool(kind)` branches specially only for `candidates`; help will receive the same tool definition as chat. No tool-array change is necessary.

But `systemFor` is exhaustive. It needs an explicit `help -> SYSTEM` branch so the system bytes remain exactly identical. Add a test comparing help and chat system content, article cache blocks, and serialized tool definitions; only the final user addendum should differ.

## Staging

Stage 1 can ship independently, after correcting:

- the vertical floor/top calculation;
- owner-versus-visitor flooring;
- explicit grid placement so conditional bookmarks do not move the other buttons;
- the lone-column maximum-width decision.

Stage 2 is coherent as a temporary two-step preview, provided the UI does not imply it already sends.

Stage 3 is too broad. I would split it into:

1. `ThreadKind` wire/storage work: type, migration, validators, export, route anchor policy, cache tests.
2. Exactly-once launch: isolated sending seam, canned message, synchronous per-block guard, existing-thread reopening.
3. Detached lifecycle: Close versus Stop, pending-status transport/reconciliation, dock behavior, and browser lifecycle testing.

## Test evidence

I ran:

```text
npx vitest --configLoader runner run \
  tests/spine-width.test.ts \
  tests/chat-unmounted-turn.test.ts \
  tests/messages.test.ts
```

All 3 files and all 41 tests passed. The ordinary Vite config loader first failed because this review workspace disallowed creating its temporary config directory; the runner loader avoided that unrelated write.

Those results support the existing detach/recovery and message behavior, but none currently covers the proposed `help` kind, exactly-once launch, Close-versus-Stop behavior, or detached pending badge. No files were changed.