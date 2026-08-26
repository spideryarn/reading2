The plan is not ready to build. Four parts need redesign first.

## Blocking problems

### 1. Stop-then-delete is not a safe cancellation operation

`stopChat()` only fences one `Live` entry in one Node process. Its `await live.done` does guarantee that the specifically named writer has finished when it returns `{stopped:true}` (`src/routes.ts:1099`). It does not make the subsequent DELETE atomic.

A concrete loss:

1. Tab A stops the first answer.
2. `stopChat` awaits that writer and returns.
3. Tab B appends a second turn.
4. Tab A sends DELETE.
5. DELETE removes both turns. It does not call `settleThread` and has no expected-tail guard (`src/routes.ts:2022`).

Other broken cases:

- Before `begin`, current `stopWanted` first sends the provisional id and later fire-and-forgets the real stop (`src/web/useChat.ts:646`, `src/web/useChat.ts:937`). A `stopAndDiscard` awaiting the first request would see `{stopped:false}` and delete while the real stream continued.
- `{stopped:false}` conflates “already finished”, “wrong attempt”, and “the writer is in another server” (`src/routes.ts:1106`). Only the first is safe to treat as settled.
- With two filesystem servers, their process-local queues can load/save in the order `A load → B delete/save → A stale save`, resurrecting the thread.
- Postgres prevents resurrection through its FK and attempt fence, but a different server cannot abort the model call. It can only delete the rows and cause the later `finish` to update nothing.
- A concurrent sweep on another process can clear the Postgres attempt or, with filesystem storage, participate in the same stale-file overwrite. It is not a cancellation fence.
- The SSE reader can process already-buffered frames after the DELETE response. The client must suppress those frames immediately when cancellation begins, not only remove the thread after both requests finish.

Build one server operation such as `cancelFirstTurn(threadId, messageId, attempt, expectedTailId)`. It should:

1. Verify that this is still exactly the first turn and the named attempt.
2. Abort and await any matching local writer.
3. Recheck under the conversation/store lock.
4. Conditionally delete only if the tail is unchanged.
5. Return 409 if another turn or attempt appeared.

For Postgres, the final check and delete must be one transaction. Cross-process model abortion requires shared cancellation signalling; otherwise state plainly that it is best-effort while deletion remains safe. The client needs a reversible `cancelling` tombstone immediately, then either commit the removal or refresh on 409.

### 2. Lifting the existing `useChat` wholesale creates both a race and a render storm

There is a specific race already documented in `ChatBand`: sending before the initial GET finishes inserts optimistic rows, then `refresh()` replaces the entire array with the older server result (`src/web/useChat.ts:503`). The handoff waits for `loaded` precisely because otherwise every later delta targets a thread that disappeared (`src/web/App.tsx:1092`).

After this plan:

1. Article mounts and starts the chat GET.
2. Reader quickly selects text and presses Ask.
3. `send()` inserts the anchored thread.
4. The original GET returns without it and overwrites `threads`.
5. The answer streams invisibly.

There is also a serious performance regression. Each token calls `setThreads`. If that state lives in `Reader`, each token rerenders the whole reading view. `TableView` maps every block and calls `annotateHtml` during rendering (`src/web/TableView.tsx:500`). Chat-mark resolution would also depend on the changing thread array. Long articles will repeatedly parse and annotate every paragraph while an answer streams.

Build `?anchors=1` now, or a separate thread-summary endpoint. Keep:

- Lightweight thread metadata and anchors in the reading view.
- Full transcripts lazy-loaded for the selected floating thread or chat mode.
- Streaming transcript state below the `Reader`/`TableView` render boundary.
- One cache/coordinator that merges mutations into both representations.

The “two sources of truth” concern is real, but the full-fetch alternative already creates two worse bugs.

The auto-start effect should be narrowed to deliberate arrival in full chat mode. It must not run merely because the article-level hook loaded, and it must not create an unrelated empty chat when an anchored draft or stale shared link exists. The `started` latch, handoff consumption, loaded gate, URL choice and auto-start need one owner; leaving them inside a conditionally mounted `ChatBand` while moving the state elsewhere preserves none of the old ordering guarantee.

### 3. The anchor persistence design is incomplete

The proposed TypeScript shape does not encode its own three legal states. Use a discriminated union:

```ts
type ChatAnchor =
  | { blockId: BlockId }
  | { blockId: BlockId; quote: string; start: number };
```

Then retain `anchor?: ChatAnchor`, never `anchor: undefined`. With `exactOptionalPropertyTypes`, every Postgres mapper, optimistic object and request builder must conditionally spread absent fields.

Concrete missing seams:

- `src/store/export.ts` currently exports thread fields individually and would omit the anchor (`src/store/export.ts:279`).
- `src/store/import.ts` inserts thread fields individually and would discard it on import (`src/store/import.ts:632`).
- Import must mint any referenced `block_identities` row, as it already does for comments (`src/store/import.ts:596`).
- `pg-chat.ts` needs conditional reconstruction in `threadsFor` and insert-only columns in `upsertThread` (`src/store/pg-chat.ts:139`).
- The proposed migration name is already taken: `drizzle/0011_reader_profile.sql` exists.

The roundtrip test is structural/canonical equality, not literal byte equality, although it will still catch `null` versus absent. Add explicit assertions for all three anchor forms.

“Later anchors are ignored” is wrong. If a caller supplies an anchor for an existing thread, silently appending creates a user message about passage B inside a thread structurally anchored to A. Reject it with 409, or accept only byte-identical anchor replay if an idempotency case requires that. Retry and edit do not call `withTurn`; `streamChat` must reject `anchor` alongside `retry` or `edit` rather than silently ignoring it.

The three SQL checks are necessary but insufficient. They still allow malformed ids, empty quotes and impossible offsets. Format/existence belongs in the FK; quote/start matching belongs in route validation against the authoritative rendered block.

Use a composite FK `(article_id, anchor_block_id) → block_identities`. Do not use `ON DELETE SET NULL`. The plan’s premise is false: re-extraction removes a revision block, not its identity. Identities are explicitly never deleted (`src/db/schema.ts:379`), which is exactly why comments survive (`src/db/schema.ts:530`).

### 4. The model has no durable concept of the anchor

The plan creates two independent sources: structural anchor columns and a formatted first message. They can diverge immediately if the reader edits the first message; `withEdit` permits that and leaves the thread anchor unchanged.

They also diverge after a long conversation. Chat sends only the latest 20 turns (`src/converse.ts:215`). Once the first message falls out, the model no longer receives the anchor, although the UI and database still say the thread is tied to it.

Make the structural anchor canonical:

- The request sends `{anchor, question}` separately.
- The server validates the anchor and synthesises the visible first message.
- `converse` receives the structural anchor on every turn.
- Render it in the final variable user block, after the article cache breakpoint, so `articleWithIds` remains byte-identical (`src/converse.ts:467`).
- Either prohibit editing the generated anchor prefix or let editing change only the reader’s question.

The full selected quote can exceed `MAX_QUESTION_CHARS = 4000` (`src/routes.ts:1124`). Selecting a long paragraph would therefore open a thread optimistically and receive 413. Anchor length and question length need separate limits.

Finally, selected article text is untrusted content. Copying it into the reader’s user message promotes an article’s prompt injection into something that looks like the reader’s instruction. Delimit it explicitly as quoted article data and tell the model it is not an instruction.

## Should fix before building

### One overlay state, and one chat id

`?chat=<id>` adds no information. Reuse `?thread=<id>` everywhere:

- `mode=chat` means render that thread in the band.
- Any other mode means render it in the floating panel.
- A pre-send anchored draft remains local because no persisted thread exists yet.

A single overlay controller should own `none | comment | chat-draft | chat-thread`. Independent `note` and chat state can both be present in a pasted URL or during batched URL updates, despite “opening one closes the other”.

Keep `thread` as `replace`, matching the documented browsing rule (`src/web/params.ts:243`). Consequently Back does not step through floating panels; that is the existing deliberate `note` behaviour. A deleted thread in a shared link should, after loading confirms absence, clear `thread` with `replace` and show “conversation no longer exists”. It must not trigger auto-start and silently retarget the URL to an unrelated chat.

### Dodging must belong to the shared floating shell

`CommentDialog` owns its own pointer listeners and hides during a prose drag (`src/web/CommentDialog.tsx:91`). The newly mounted `ChatDialog` did not see that drag’s `pointerdown`.

Use one floating-shell selection state:

- Hide the current panel while a drag is active.
- On invalid selection or `pointercancel`, restore it.
- On valid mouseup, replace it atomically with the anchored draft.
- Remove the existing `removeAllRanges()` call; otherwise the selected words disappear before a persisted chat mark exists (`src/web/App.tsx:852`).

### Overlapping marks need an interaction design

`annotateHtml` can create one element with both `cmt` and `chat`, but that does not make both artefacts reachable.

Currently `TableView` opens the first comment from `data-comment` (`src/web/TableView.tsx:337`). Choosing chat first would merely make the comment unreachable instead. Also, the single element has only one `::after`, already used by the comment marker (`src/web/styles.css:1273`).

An overlap needs a chooser listing both artefacts, or one combined marker that opens such a chooser. Test click and keyboard behaviour, not merely the generated classes.

Index blocks by id before resolving anchors. The current comment path does `blocks.find` plus DOM parsing for every comment (`src/web/TableView.tsx:241`); adding every chat thread to that path amplifies it.

### “Comments are closed” is not enforced by the server

Deleting `useComments.ask` closes the UI path, but `POST /api/comments/:slug` still calls `commentStore.create` for any fresh client-supplied id (`src/routes.ts:382`). A stale client or direct request can still create a new explanation.

Split retry/deepen into an existing-comment endpoint, or make the retained POST require that the id already exists. Otherwise “no way to make a new one” is only a current-component convention.

### Add privacy and validation requirements

The anchor quote is article prose. Current logging does not record request bodies, which is good, but the plan should require:

- No quote in validation errors, structured logs, tooltip diagnostics or SQL parameter logging.
- A canary test proving the quote never appears in logs.
- Server validation with `isSpideryarnId`, article membership, nonempty quote, offset bounds and exact quote match.
- React text rendering only; never interpolate the quote into HTML attributes or `dangerouslySetInnerHTML`.

The new columns inherit `chat_threads` ownership and eventual table RLS; they do not need column-specific RLS. RLS is currently deferred, so every new summary/cancel endpoint must remain behind the same API authentication and owner boundary.

## Worth considering

- Define whether the gutter count includes all chats anchored to the block or only block-only chats. It should probably count all, or the number contradicts the selection marks beside it.
- `opacity:0` leaves an invisible mouse target. Gate pointer events while hidden, while restoring both opacity and pointer events on hover and `:focus-visible`.
- A fixed-height `ChatDialog` is sensible for a transcript, but wasteful for the initial ask box. Use the stable height after sending.
- Add concurrency tests for: cancel before `begin`, new turn between stop and delete, attempt replacement, `{stopped:false}` from another server, sweep during cancel, and buffered SSE frames after deletion.

## Direct answers to the plan’s five questions

1. **Foreign key?** Yes: composite FK to `block_identities`, with no `SET NULL`. Re-extraction never deletes the identity.

2. **Lift `useChat` or build anchors now?** Build the lightweight anchor/thread-summary read now. Do not lift the full transcript/streaming state into `Reader`.

3. **Separate `?chat=`?** No. Use the existing `?thread=`; `mode` already determines whether it is full-band or floating.

4. **Anything wrong with stop-then-delete?** Yes. `{stopped:true}` fences only one named writer in one process, while the two requests leave a destructive race. Use one conditional server operation.

5. **Can a new comment still be created?** Not through the intended React selection path after `ask` is removed, but yes through the unchanged POST route. If “museum” is a contract, enforce it server-side.