The 1Q diagnosis is correct. The main plan defect is stage 2: explanation intent belongs to the turn, not the thread.

## 1. Diagnosis

Confirmed.

- `.blk-cmt` renders a bookmark, uses `--highlight` → `#DB8A45` orange, and opens `first.id` in the existing `CommentDialog` ([BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/BlockGutter.tsx:393), [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/styles.css:10264)).
- `.block-chat.has` is the counted blue control, using `--chat-mark: oklch(0.72 0.12 235)` ([BlockGutter.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/BlockGutter.tsx:429), [styles.css](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/styles.css:10293)).
- `chatAboutBlock` always clears `?thread=` and creates a draft, while `helpAboutBlock` first looks for an existing thread ([App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/App.tsx:2506), [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/App.tsx:2573)).
- “Previous comment and model response” independently identifies chat: current comments do not carry new model responses.

One nuance: `.block-chat.has` turns orange while hovered, but is blue at rest. That does not weaken the diagnosis.

## 2. Persisted metadata

**F-01 — P1 — `from_help` is on the wrong row and breaks retry semantics.**

The plan says explanation is per-turn, but persists it on `chat_threads`. More importantly, it proposes refusing `help` on retries. Retrying the first help answer would therefore lose the pedagogical instruction and become an ordinary chat answer. That is user-visible wrong behaviour.

Persist `help?: true` on the initial user `ChatMessage` and as `chat_messages.help`, not on the thread. Then:

- `withTurn` marks the user request.
- `withRetry` already returns that same stored user row, so the route derives `help` from `user.help`.
- `withEdit` currently spreads the original user row, naturally preserving its origin.
- Follow-up user rows have no flag.
- Counting explanation requests is a query over message rows.
- A future thread-level summary can derive “began with help” from its first message without duplicating stored state.

This follows the existing rule that the route asks from authoritative stored rows rather than the request body, as it already does for kind and stance.

**F-02 — P1 — “no backfill” is false.**

The `?` already shipped and has been used. At least two help-question wordings have existed. Existing help requests would receive `false`, so the new metadata would be wrong precisely for the requests that prompted 1R.

The migration needs a preflight `SELECT`, followed by a narrow backfill of first user messages in whole-block anchored chat threads whose text ends with either historical `HELP_QUESTION`. Record the matched count and inspect the rows before updating.

**F-03 — P1 — the stated validation does not enforce thread-origin semantics.**

If the thread-column design were retained, merely refusing retry/edit is insufficient. An ordinary later send carrying `help:true` could receive the help prompt while `upsertThread` silently retains `from_help=false`. Prompt truth and stored metadata would disagree.

The message-level design removes this problem. The wire should still be `help?: true`, with runtime validation accepting only absent or literal `true`; retries and edits should derive it from storage rather than accept it from the client.

A migration-free alternative does exist: infer help from the stored question text. I would reject it. It couples type to copy, misclassifies an ordinary reader who types the same sentence, and splits history every time `HELP_QUESTION` changes. A structured request log would provide operational counting, but not metadata on the reader’s stored request. So one migration is justified—just on `chat_messages`, not `chat_threads`.

## 3. Chip selection, caching, and invariants

**F-04 — P1 — selection chats should not outrank whole-block chats.**

The count including selection threads does justify opening one when no whole-block thread exists. It does not justify letting a newer three-word selection displace the paragraph conversation.

Use this order:

1. Newest whole-block chat.
2. Otherwise newest selection chat on the block.
3. Otherwise a fresh whole-block draft.

Also positively filter `kind === "chat"`. That keeps the reading-view mark invariant explicit rather than relying solely on route correctness.

**F-05 — P1 — the proposed copy promises more than the action provides.**

“Your conversations … (3)” suggests access to the set, while the click opens one. The singular ARIA label also hides the visible count from screen-reader users.

Use truthful parallel copy such as “Open a conversation about this paragraph (3 total)” for both `title` and accessible name. Keep the no-chat copy unchanged.

Prompt caching is otherwise sound. A constant `helpSection()` in the final user message is below the explicit article breakpoint; `systemFor`, the article message, kind, and tools need not change. The strongest regression assertion is:

```ts
cachedText(helpMessages) === cachedText(ordinaryMessages)
```

Keeping `kind: "chat"` and the existing anchor preserves the “every reading-view mark is a chat” rule.

## 4. Stage landability

**F-06 — P2 — the stages are not fully independently landable as described.**

- Stage 1 can land after fixing selection priority and removing the Plus.
- Stage 2 is underspecified across its type/store/export seams, so it cannot yet claim green parity.
- Stage 3 should consume the stored user-message flag, including on retry/edit.
- Deferring all documentation to stage 4 leaves earlier behavioural commits knowingly stale. Move the relevant `web-client.md` update into stage 1 and the chat/prompt documentation into the metadata-and-prompt stage.

For cleanliness, I would combine stages 2 and 3. They are one vertical mechanism: wire flag → stored request metadata → authoritative prompt selection. That avoids an intermediate commit containing plumbing with no consumer.

## 5. Missing scope

**F-07 — P2 — stage 2’s file list is too conditional.**

For the recommended message-level field, explicitly name:

- `src/types.ts` — `ChatMessage.help?: true`
- `src/store/contracts.ts` — turn input
- `src/chat.ts` — `withTurn`; retry/edit preservation
- `src/db/schema.ts` — `chat_messages.help`
- `src/store/pg-chat.ts` — `toMessage` and `messageRow`
- `src/routes.ts` — validation, store input, and `converse({help: user.help})`
- `src/web/useChat.ts` and `src/web/ChatDialog.tsx` — wire propagation
- `src/store/export.ts` — hand-written rollback projection
- `tests/helpers/seed-reader-state.ts` — hand-written Postgres seeding
- migration SQL, snapshot, and journal

`export-bundle.ts` and `article-rows.ts` carry all selected columns automatically, but need a positive export test. `ThreadSummary` is unnecessary unless the metadata is actually shown in the reading view.

The database-backed round-trip, migration, and export tests require Greg’s Postgres run; the plan should name that handoff explicitly.

**F-08 — P2 — the stage 1 test is too narrow.**

Add pure helper cases for:

- newest whole-block thread;
- whole-block preferred over a newer selection;
- newest selection as fallback;
- non-chat kinds ignored;
- no match.

Keep the click-level regression test as the red proof of 1Q.

**F-09 — P2 — stage 3 lacks an answer-quality acceptance check.**

The actual instruction should be decided in the plan, not during implementation. Reuse the proven principles in [explain.ts](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/explain.ts:184):

- briefly orient the reader to what this block is doing, not summarise the article;
- identify the missing prerequisite or earlier argument;
- use one worked example or analogy only when it clarifies;
- map it back to the author’s vocabulary and block IDs.

A byte test proves placement, not pedagogy. Add a small live evaluation over a dense argument, an unfamiliar term, and a case whose prerequisite is earlier in the article.

## 6. What to cut

**F-10 — P2 — cut the Plus button.**

The reopened thread’s composer already satisfies “add new comments to the same block.” Starting a separate whole-block conversation was not requested and requires new header UI and callback plumbing. Add it only after someone needs separate conversations rather than follow-ups.

**F-11 — P2 — cut the conditional help label.**

The conversation list already has a kind-label surface for Remember threads ([ChatPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/feedback-comment-chip/src/web/ChatPanel.tsx:784)), so the plan’s “if” definitely adds a visible help tag. 1R asks for metadata, not presentation. Store and export it; do not add UI yet.

Keep the chip copy change, but make it truthful. Keep stage 3. Keep persisted metadata, redesigned per message.

Checks: 171 targeted tests passed. All three TypeScript projects passed direct `tsc --noEmit`; the `npm run typecheck` wrapper itself was blocked by this sandbox’s `tsx` IPC permission. No Postgres-backed tests were run.

**Verdict: build it with these changes.**