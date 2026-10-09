# Delete a chat question, and everything after it

Report `spya-mx423m` (#517, SPIDERYARN-READING2-FX), Greg, 2026-10-09, filed from Chat on the
Attention paper — an admin's suggestion, so it is built
([feedback-reports.md § Who sent it](../project/feedback-reports.md#who-sent-it)):

> There should be a way to delete a chat message. Like, I accidentally said, "Where should I
> start?" twice in this chat, and I want to remove the second one. I guess it would delete anything
> following.

Queue item `qi-j4vfcasm`. Up: [plans.md](../project/plans.md).

## What the reader gets

A **bin beside the pencil** on each of the reader's own questions. Press it once and it turns red
and says *"Press again to delete this question, its answer and the N messages after it"*; press
again within a few seconds and they are gone. It is the same two-press button the conversation's
own delete already is (`ArmedDelete` in `src/web/ChatPanel.tsx`), so it looks and behaves like the
control that does the same job one level up
([controls.md § Controls that do the same job look the same](../project/controls.md#controls-that-do-the-same-job-look-the-same)).

```
  ┌─────────────────────────────────────────┐
  │                  Where should I start? ✎  │   ← first question: pencil only
  │ Start with § 3, the model architecture… │
  │                  Where should I start? ✎ 🗑│   ← press 🗑 twice: this row,
  │ As I said, § 3…                         │      this answer, and all below go
  └─────────────────────────────────────────┘
```

### The decisions, and the simpler option each passed over

1. **Questions only, not answers.** Deleting an answer alone leaves a question with nothing under
   it, which reads as a bug; a bad *last* answer already has **Answer again**. Greg's case is a
   question. Deleting a question takes its answer and everything after, as he guessed.
2. **Not on the first question.** Deleting it would leave an empty conversation, and the
   conversation's own delete is already in the header (Learn's is Start over). Offering a second
   way to delete the whole thing from a row, with a different confirm, is a second path to keep
   right for no gain. *Passed over:* making the first row's bin call the thread delete — cheap for
   Chat, but Learn's and the guide's header deletes have their own flows (Start over begins a fresh
   conversation), and routing a row into those is exactly the braid to avoid.
3. **Everywhere the pencil is offered**, which is every kind that draws `Turn`: ordinary chats, the
   guide, Explore, Tutorial, Learn, and the dialog (`ChatDialog`). One component, one rule; the guide
   is where Greg hit it. The prop is **required** (value or `undefined`) on `ChatPanel` and
   `Conversation`, so a new caller has to decide (review F6).
4. **Only on a settled conversation, and not while anything is moving.** Hidden while an answer is
   arriving (with the pencil, `canEdit`), while a Live session is running in the conversation (its
   next exchange is appended against the tail it last saw, review F4), and unless `settled` in
   `useChat.ts` says the server has named the conversation and nothing of this tab's is out for it
   (review F3). That last also means one delete at a time. The server refuses any thread with a
   `pending` message. *Passed over:* stopping the stream first, as edit does via `settleThread`; a
   delete is never urgent enough to abort an answer the reader is watching.
5. **Two presses, not Undo.** Undo needs the rows kept somewhere (a soft-delete column on every
   read path, or a client-side hold-and-send-later with its own failure modes). The two-press
   button is what the conversation delete uses and what the report notes asked for ("a confirm or
   an Undo").
6. **A hard delete**, the same one an edit already performs on every turn under the edited
   question (`edit` in `src/store/pg-chat.ts`, `gt(ordinal, kept)`). Checked what hangs off a
   message, and GPT Sol checked again: **nothing in the database references a chat message id** —
   no foreign key, no column in `ai_calls` (cost rows are keyed by call and owner, so the spend stays
   counted, which is right: it was spent), URL state names threads and blocks, not messages, and
   "asked terms" are the glossary's, not chat's. The thread's `gist` is cleared in the same
   transaction, as edit does. **`updated_at` goes back to the kept tail's `createdAt`** — the time
   that turn was asked, which is what `updated_at` was set to then — so the list's "last message"
   and its order describe a message that still exists. (The first draft left it alone, on rename's
   reasoning; review F5 pointed out rename does not change the last message and this does.)
7. **Guarded by the tail, always**: the client sends the last id it could see, the server refuses
   (409) if the conversation has moved on, and a body without one is a 400. Edit's guard is optional
   for old tabs; a new route has none (review F1).

## How

### Server

- **`withDeleteFrom(threads, threadId, messageId)`** in `src/chat.ts`, pure, beside `withEdit`:
  refuses an unknown thread or message, an answer, the first message, and a thread with any
  `pending` message. Returns the kept thread, the index and the count.
- **`ChatStore.deleteFrom(slug, threadId, messageId, { expectedTailId })`** in
  `src/store/contracts.ts` and `src/store/pg-chat.ts`: one transaction under `lockArticleRow`, read
  inside the lock, `requireTail`, `withDeleteFrom`, `delete … where ordinal >= index`, `updated_at`
  and the gist set, the list read back inside the transaction (rename's reason). Logs ids and the
  count, never text.
- **`POST /api/chat/:slug/:threadId/delete-from`**, body `{ messageId, expectedTailId }`, under
  `inTurnOrder(slug/threadId)` like the thread DELETE. POST with a body rather than DELETE, matching
  its neighbours `cancel`, `stop` and `hint-opened`.

### Client

A new operation, `PruneOperation` (`kind: "prune"`), through the chat state machine the way the
others go (`src/web/chat/model.ts`, `reduce.ts`, `effects.ts`, `controller.ts`, `project.ts`,
`useChat.ts`):

- **It records the ids it deletes**, read off the screen at the press — the question and every row
  below it — and the last of them is the tail it sends.
- **It draws** those rows away, because it can be withdrawn: a refused delete puts them back by
  dropping the operation, the rule that makes an edit's discard a projection (`project.ts` header).
- **Success filters exactly those ids out of `base`**, drops the gist and moves `updatedAt` by the
  server's rule (`prunedAt`). It does not take the server's copy of the thread: a send the reader
  started after the press is in `base` and not in that copy, so a snapshot would delete it (review
  F2, which proposed merging the snapshot; filtering by id needs no snapshot at all). **Failure**
  drops the operation and says why above the conversation.
- A delete of the whole conversation supersedes it, as it does every operation on that thread.
- `Turn` gets an `ArmedDelete` (sized 12) beside the pencil when `onDeleteFrom` is given, and
  `Conversation` gives it from the second question on.

**One edge left as it is:** a send that failed before the server named its rows can leave a
question with an id the server never stored. A delete that names it, or names it as the tail, is
refused with "Reload before deleting.", and the reload is the right fix: those rows are not saved.

### Help and docs

- `src/web/help/pages/modes/chat.md`: two sentences beside the pencil's (and the help chatbot's
  corpus regenerated).
- A signpost to this plan from reading-view-overview.md, where chat's plans are listed.

## Tests

- `tests/chat-delete-from-route.test.ts` (Postgres, through the route): rows at and after the
  question gone and rows before kept, another conversation untouched, `updated_at` back to the kept
  tail and the gist gone, asking again afterwards, and refusals with nothing deleted for a stale
  tail, a missing tail, an answer, the first question, a pending answer, an unknown id and somebody
  else's article.
- `tests/chat-prune-reduce.test.ts`: the command and its tail, what is drawn, success and refusal,
  a thread delete winning, and over every order of success or failure, a later send and a late list,
  that a deleted row never comes back while the delete stands and a later send is never taken with
  it. Probed: swapping success for a cut at the question's position (what a snapshot would do) turns
  that last case red.

## Not done

- No Undo (decision 5). No deleting a single answer (decision 1). If either is wanted later, each is
  its own small plan.

## Reviews

- Plan: GPT Sol, [261009o-plan-review-sol.md](261009o-plan-review-sol.md) — seven findings, all
  taken (F2 in a simpler form, above).
- Code: GPT Sol, [261009o-code-review-sol.md](261009o-code-review-sol.md), which fixed what it
  found; each fix read and kept. The two worth knowing:
  - **`finish` now moves `updated_at` only when its fenced update lands.** It used to move the
    clock even for a stale attempt — a choice made for parity with the filesystem store, which is
    gone. A late finish after a sweep and a delete would have dated the conversation by an answer
    that no longer exists.
    [261009j](../postmortems/261009j-an-attempt-fence-guarded-the-row-but-not-its-aggregate-clock.md).
  - **`prune.started` checks `isSettled` itself**, rather than trusting that the bin was drawn
    only when it was: a render is a snapshot, and an armed bin can be pressed after the state moved.
    [261009k](../postmortems/261009k-a-render-gate-did-not-guard-the-event-it-displayed.md).
  - Smaller: focus moves to the previous question's pencil before the row goes; the armed wording
    names the answer separately ("this question and its answer"); the held row keeps the bin's
    place. (Its `aria-label` and `aria-pressed` were taken back out: `title` is already the
    accessible name and changes when armed, a delete is not a toggle, and the header's bin has a
    recorded DOM baseline in tests/mode-surface-changes-no-markup.test.tsx.)
