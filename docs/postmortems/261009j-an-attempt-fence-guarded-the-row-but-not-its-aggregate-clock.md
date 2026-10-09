# An attempt fence guarded the row but not its aggregate clock

Nothing reached a reader. Code review of the uncommitted delete-from work found that a late chat
finish could leave the deleted rows gone but move the conversation's `updated_at` back to the late
call's time. The sidebar would then sort and label the conversation by activity it no longer held.

Up: [postmortems.md](../project/postmortems.md).

## What happened

`ChatStore.finish` made two writes under the article lock: it moved the thread clock, then tried to
finish the answer under the answer's attempt fence. A sweep can end an attempt, after which pruning
that settled turn is valid. When the old model call eventually returned, the fenced message update
matched zero rows but the unconditional thread update had already landed.

The same shape was possible after a retry: the old attempt could not overwrite the new answer, but
could still reorder its conversation. The plan review called `finish` attempt-fenced; that was true
of `chat_messages` and false of the aggregate metadata beside it.

The behavior began in `79ea868c5` (*Put the reader's conversations, searches and lookups in rows*,
2026-08-26). A later parity test positively required an unmatched finish to move the clock. The
delete-from operation made the contradiction visible because it deliberately restores the clock to
the retained tail.

## A fence around the primary row is not a fence around its derived writes

This is a **partially fenced compound write**: the identity token protected the answer but not the
thread metadata derived from storing that answer. Transaction and lock boundaries did not help;
they made each writer atomic without making the unconditional half conditional on the same fact.

The schema already gave the right rule: `chat_threads.updated_at` is bumped on every **stored**
message. A rejected finish stores no message, so it owns no clock update.

## Why nothing went red

The attempt-fence tests asserted that stale answer text did not land. One explicitly records that it
does not inspect `updatedAt` (`tests/chat-live-turn.test.ts`). The store test encoded the opposite
behavior as filesystem parity, so it would have failed on the correct fix. The plan's route tests
covered the timestamp immediately after pruning, not a stale writer arriving afterwards.

The Postgres regression could not be watched red during review because this sandbox could not reach
the local database (`connect EPERM 127.0.0.1:54362`). The old statements and the old store assertion
make the failure deterministic; the new route regression remains to be run where Postgres is
reachable.

## What would have caught it, ranked by ease against value

1. **Assert every effect of a rejected fenced write** — answer row and aggregate clock. The store
   assertion now says a rejected finish leaves `updatedAt` alone, and the delete-from route test
   exercises a finish after pruning.
2. **Put dependent writes behind the same success predicate** — done in `ChatStore.finish`: the
   thread clock moves only when the fenced message update returns a row.
3. **A database trigger deriving the thread clock from message rows** — rejected. Pruning moves the
   clock backwards and rename deliberately does not move it; encoding all of that in triggers would
   split the chat rules between TypeScript and SQL for little extra protection.

## The long-term fix

The review fix is also the long-term one: perform the fenced message update first and update the
thread clock only when it landed. The old filesystem-parity behavior was not a product promise; it
was an implementation accident preserved by a test after the filesystem store stopped being the
source of truth.

## The thing I would tell myself

I would not call a write fenced after checking only the row that carries the token. I would list
every statement in the transaction that claims the attempt happened, and make each one depend on
the same accepted result.
