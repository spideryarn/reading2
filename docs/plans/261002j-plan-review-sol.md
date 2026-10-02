No P0s. I found three P1s that should be resolved before building, plus two P2 copy/coverage issues.

## P1

1. **“No stored field needed” does not satisfy Greg’s requested distinction: what the reader wanted.**

The checkbox choice is local UI state ([AnnotateDialog.tsx:314](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/AnnotateDialog.tsx:314)). The comment is created without that choice, and only after the save succeeds does Reader open a chat draft ([Reader.tsx:2928](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:2928)). If the reader checked *Also ask*, then closes the draft before sending—or chat creation fails—the stored comment is indistinguishable from one where they deliberately chose no AI.

Therefore:

- If the label means **intent** (“wanted an AI response”), a stored provenance field is required.
- If it means **outcome** (“this comment has/started a conversation”), no new field is needed, but the plan should say it is changing the requested distinction and use outcome-based copy.

The current derivation also mishandles valid edge states:

- Saving with an empty body and *Also ask* is expressly allowed ([AnnotateDialog.tsx:330](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/AnnotateDialog.tsx:330)). Once linked, it has `threadId` but no `body` or `answer`. `commentKind` calls it `comment-ai` ([comment-nav.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/comment-nav.ts:214)), but the margin drops it before deriving the kind ([notes.ts:287](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/marginalia/notes.ts:287)).
- Legacy `pending`/`done`/`error` rows were explanations, not chats; older rows may have no reader words ([types.ts:2890](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/types.ts:2890), [types.ts:2957](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/types.ts:2957)). Calling all of them “Comment + AI chat” is inaccurate.
- `threadId` remains after its conversation is deleted ([comments.md:193](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/docs/project/comments.md:193)), so “+ AI chat” can appear with no conversation to open.

At minimum, distinguish legacy AI explanations and change the margin exclusion to exclude `commentKind(comment) === "bookmark"`, rather than every row without body/answer.

2. **A slow bookmark response can overwrite whatever the reader opened meanwhile.**

The planned/current path awaits the POST and then unconditionally calls `setNote(id)` ([Reader.tsx:2043](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:2043)). There is no foreground-intent token.

Consequences:

- Bookmark A, then open existing comment B: A’s response replaces B.
- Bookmark A, then bookmark another block: whichever response arrives last wins, not the most recent press.
- Bookmark, then open chat: the new `note` is hidden because chat wins the overlay; closing chat can reveal the delayed comment dialog unexpectedly.

The gutter’s token cannot prevent this: it checks only after `onBookmark` resolves ([BlockGutter.tsx:766](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/BlockGutter.tsx:766)), while Reader has already performed `setNote` inside that promise.

The failed-write path itself is sound: the optimistic row is removed and `null` returned ([useComments.ts:592](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/useComments.ts:592)); retry retains the id. Same-block double presses are coalesced. What is missing is a Reader-wide “this is still the latest surface-opening intent” guard, invalidated when another comment/chat/editor is opened.

3. **Focus will not return to the bookmark’s replacement mark.**

`create` inserts the optimistic row synchronously ([useComments.ts:543](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/useComments.ts:543)), which replaces `.blk-bookmark` with `.blk-cmt` ([BlockGutter.tsx:593](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/BlockGutter.tsx:593)). Because the dialog waits for server confirmation, its original opener is already gone when it mounts.

`CommentDialog` then commonly records `<body>` as the opener. Since body remains connected, cleanup tries to focus it and returns before the Comments-button fallback ([CommentDialog.tsx:221](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/CommentDialog.tsx:221)). Closing therefore loses the reader’s gutter position.

Use the replacement `.blk-cmt` in the same `tr[data-block]` as the fallback. `ChatDialog` already has the analogous gutter fallback pattern ([ChatDialog.tsx:331](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/ChatDialog.tsx:331), [ChatDialog.tsx:497](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/ChatDialog.tsx:497)).

The iPad keyboard part otherwise looks right: focus goes to the close button, not either text field. The planned 390px Playwright check does not exercise `(hover: none)` or the soft keyboard, so add a focus-restoration component test and at least touch emulation.

## P2

4. **Question marginalia currently inherits a tooltip that describes a comment.**

Questions are grouped into `CommentNote`, which selects `comment-own` ([MarginaliaColumn.tsx:352](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/marginalia/MarginaliaColumn.tsx:352)). That tip says “A comment you left” and promises an AI answer underneath ([tips.ts:58](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/marginalia/tips.ts:58)). A question instead offers *Open the conversation*. Add a question/mixed tip or make the shared tip accurately cover both.

5. **The visitor claim in the plan is too broad.**

A public comment has neither `threadId` nor `status`, but it can carry a legacy `answer` ([public-types.ts:790](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/public-types.ts:790), [public-types.ts:823](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/public-types.ts:823)). Since `commentKind` checks `answer`, such a visitor row becomes “Comment + AI chat,” contrary to plan line 78. Conversely, an empty-body modern comment linked to private chat projects as a bookmark. The docs should describe those actual projections rather than “Comment whatever it was.”

## Questions in the margin

This part otherwise checks out:

- Owner-only gating is sound: visitors receive no chat summaries, and the margin passes `askedList` only on the owner arm ([Reader.tsx:1827](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:1827)).
- A question whose block is gone is skipped by the block-index check ([notes.ts:296](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/marginalia/notes.ts:296)).
- `openAskedFromDrawer` is safe from the margin in current modes: Remember switches to Chat; Chat uses its band; other modes use the floating dialog ([Reader.tsx:1810](/home/greg/code/spideryarn2/.claude/worktrees/fb9c-9h-comments-without-ai-reply/src/web/reader/Reader.tsx:1810)).

## Simpler option

There is no materially simpler route that gives exactly the planned one-press bookmark plus immediate editing. Reusing `AnnotateDialog` would avoid the delayed-open race, but would no longer store the bookmark in one press and would require widening its selection-only anchor model.

The simplest sound version is the current product shape with:

- a Reader-wide stale-intent guard;
- focus fallback to the replacement gutter mark;
- outcome-based labels, unless Greg confirms he wants intent stored;
- the empty-body linked-comment and legacy-explanation cases handled explicitly.

I wrote nothing to the tree.