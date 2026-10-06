# A new conversation stored under another id than the tab guessed (qi-6m5d6hfx)

Up: [plans.md](../project/plans.md).

Status: 2026-10-06. Built and code reviewed; the review's fixes are committed.

## The job

The Overseer's queue item, verbatim:

> Bug: a new conversation stored under a different id than the tab guessed is counted twice in the
> paragraph until reload. GPT Sol finding left open by dev-reds-1005 (fada977ff); written up in
> docs/postmortems/261005q. When the server stores a new conversation under a different id from the
> tab's optimistic guess, the paragraph's count includes it twice until a reload. Reconcile the
> guessed id with the stored one when the response lands; red test first.

Background, in plain words. When a reader asks about a paragraph from the floating chat dialog, the
tab invents the new conversation's id and tells the reading view at once
([`ChatDialog.tsx`](../../src/web/ChatDialog.tsx) § `ask`, `onCreated`), so the paragraph's mark and
count are drawn before the server answers. The server names the conversation in the stream's first
frame, and the chat store follows ([`controller.ts`](../../src/web/chat/controller.ts) § `named`).
The reading view's summary list ([`useChatAnchors.ts`](../../src/web/useChatAnchors.ts)) was never
told.

**When the server overrules the floating dialog's guess.** A message uses the guessed id in
this article ([`chat.ts`](../../src/chat.ts) § `taken`, `withTurn`), including either message
minted for this turn: those ids are reserved before the conversation's id is checked. A guess that
is an existing *conversation's* id is not overruled: the turn is appended to that conversation
(`targetOf`). The first draft of this plan, and the postmortem's paragraph, had this wrong and
reasoned from "another conversation holds the guessed id"; the plan review corrected it.
The collision rate depends on the article's message count, rather than being one in a million
for every send; see [`ids.ts`](../../src/ids.ts) § `mintId` for the id space. Other callers can
also receive another id for invalid input or a single-thread-kind redirect; the floating dialog
sends a minted id and the default chat kind.

## What the red test showed, which is more than the queue item says

A new case in
[`question-press-answer-does-not-loop.test.tsx`](../../tests/question-press-answer-does-not-loop.test.tsx),
whose stub server stores the conversation under its own id. Seen red on four assertions:

1. **The dialog closes when the first frame arrives.** `?thread=` moves to the real id, the list
   has a row only under the guess, and the dialog is drawn only for an id the list has a chat row
   for ([`Reader.tsx`](../../src/web/reader/Reader.tsx) § `overlay`). The reader's answer streams
   into a dialog that is not there.
2. It comes back as a new dialog when the answer stops, because that is when the list is asked for
   again and the real row arrives.
3. (A stub artefact: the remounted dialog fetches the thread, and the stub serves no messages.)
4. **The paragraph then says 2.** The guessed row was never named by the server, so since
   `fada977ff` it stays (`unseen`) beside the real one until a reload.

## The fix, as built

- `useChatAnchors` gains `rename(from, to)`: the row under `from` becomes the row under `to`, in
  place. If a row under `to` is already there (a refetch named it first), the `from` row just goes.
  `to` takes `from`'s place in `unseen` (unless an answer has already confirmed `to`), and is always
  recorded as written for a list request in the air, so that request cannot remove the renamed row,
  unless the reader deleted the stored id after the guessed row was added (the code-review fix below).
  It does nothing for an article the hook has left.
- `ChatDialog` calls a new required prop `onRenamed(guess, real)` from the send's **`onConfirmed`**,
  the acknowledgement that survives the dialog closing, and moves any words typed while waiting to
  the real id there too (`drafts.moveThread`). Navigation stays in `onThreadId`, which stops when
  the dialog goes. For a typed send the controller calls the two in that order in one tick, so
  the list and the address change in one commit.
- `Reader` wires `onRenamed` to `chatAnchors.rename`. The prop is required, so a second caller of
  `ChatDialog` cannot forget it; nine test files that mount the dialog gained a no-op for it.

## The simpler options passed over

- **`drop(guess)` then `add(real)` from the dialog, no new operation.** It would work for this
  collision. Passed over because the row would move to the end of the list, and because the
  bookkeeping for a request in the air (`written`, `unseen`, `dropped`) would be two steps a caller
  has to get in the right order rather than one the hook owns.
- **Do not draw anything until the server names the conversation.** Passed over where the
  optimistic row was first written: the reader asks and the words they selected go blank for a
  round trip.
- **Draw the dialog from the chat store's thread rather than a summary row.** The postmortem names
  it as the larger repair. It would fix symptom 1 but not the count, and it changes a rule
  (`kind === "chat"`, positively) that exists for a reason.

## GPT Sol's plan review, and what became of each finding

Six findings, no P0. Read-only (`--sandbox review`).

1. **P1, taken.** Reconciling inside `onThreadId` misses a dialog closed before the first frame:
   `detach()` clears that callback, the guess stays, and the refetch adds the real row beside it.
   Moved to `onConfirmed`. Test: *counts one conversation when the dialog was closed before the
   server named it*.
2. **P1, not taken, reported.** An older turn's `onThreadId` still navigates after the reader has
   moved the same dialog to another paragraph, clearing the newer draft and repointing `?thread=`.
   True, and it predates this work: `onThread(real)` has always been called there. The repair
   (navigate only if the dialog still shows that guess) also has to separate the comment's
   `noteThread` correction from navigation in `Reader`, which is a second change to a second file.
   It needs an id correction *and* a paragraph change inside one round trip.
3. **P1, taken.** Words typed while waiting are kept under the guess. `drafts.moveThread` in
   `onConfirmed`. Test: *keeps what the reader typed while waiting*.
4. **P2, not taken, reported.** `Conversation` is keyed by `thread.id`, so the correction remounts
   it (scroll position, an open editor), and a Marginalia card the reader collapsed reopens. Also
   older than this work, and only on an id correction.
5. **P2, taken.** The premise about *why* the server overrules a guess was false; see above. The
   hook's comments, this plan and the postmortem now say what `chat.ts` does. A test that modelled
   "another conversation under the guessed id" was removed, because the server cannot produce it.
6. **P2, taken.** A surviving row must get `written.add(to)` even if its id was previously
   confirmed. It did; now a test holds it there:
   *survives a request in the air even under an id an older answer once listed*.

Sol also confirmed, from nuqs's source, that the rename and the address change batch into one
commit, and that `chatOpenBlock` and the card host need no migration of their own.

## Tests, and what was seen red

- The dialog-level cases (three) mount the real `App`. The first was red before any fix. The other
  two were written after the fix and seen red by putting the plan's first version back (rename in
  `onThreadId`, no draft move).
- The original hook-level cases (eight) in
  [`chat-anchors-refresh.test.tsx`](../../tests/chat-anchors-refresh.test.tsx). All red when
  `rename` did not exist, which proves little, so three were also seen red by mutation: without
  the move in `unseen`, without the unconditional `written.add(to)`, and without the article guard.

## Code review, 2026-10-06

- **P1, fixed by the reviewer.** A refetch can name the stored id before the original
  stream does. Deleting that stored conversation and then receiving the delayed name restored
  its row; during a request, `rename` also erased the deletion record. The hook now remembers
  deletions made after each local addition until it is listed, renamed or dropped. An explicit
  newer addition supersedes a deletion. The two *keeps a later deletion of the stored id*
  cases were seen red on the restored row, then green. Controls cover historical ids and a
  newer addition. Root cause: [a late identity acknowledgement must not undo a newer
  deletion](../postmortems/261006a-a-late-identity-acknowledgement-must-not-undo-a-newer-deletion.md).
- **P2, factual corrections.** The server reserves the turn's message ids before checking
  the guess; the fixed probability was unsupported. The postmortem pointed to `onThreadId`
  rather than the actual `onConfirmed`. The synchronous callback claim is scoped to typed sends.
- The original typed-words case was independently seen red by removing only `moveThread`:
  after `begin`, the composer was empty. The existing case therefore exercises the real draft
  handover. A new StrictMode case accepts the current article's rename after repeated effects;
  the real acknowledgement is asynchronous, after those effects have completed.
- Moving only the row rename back into `onThreadId` made the original closed-dialog case
  fail with a count of two, independently of the draft move.
- The three original hook mutations were repeated independently during review: omitting the
  unseen migration, restricting the flight write to unconfirmed ids, and omitting the article
  guard each failed its intended assertion.
- **Wider, reported only.** `spoken.succeeded` retires its operation before producing `named`;
  the controller prunes its navigation callback before executing the command, and spoken
  appends install no confirmation callback. Recovery after `begin` already has the stored id,
  but losing the stream before `begin` has no recovery or identity mapping: the completion
  refetch can still leave both ids. The earlier wider findings 2 and 4 remain unchanged.

## Not checked in a browser

The shared local database cannot migrate tonight, so a dev server on current `dev` answers 500. The
case also cannot be reached by hand without forcing an id collision. The jsdom cases mount the real
`App`. A browser check at three widths is owed in principle; it would show nothing a reader sees
differently outside the collision.
