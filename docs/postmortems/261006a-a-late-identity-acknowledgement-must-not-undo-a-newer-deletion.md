# A late identity acknowledgement must not undo a newer deletion

Up: [postmortems.md](../project/postmortems.md).

Found by GPT Sol in code review of `b7cd5bd1b`, which introduced this race, and fixed in the next commit. Never pushed without the fix.
Plan: [261005n](../plans/261005n-chat-guessed-id-reconciled-with-the-stored-one.md).

The server can store a conversation under a different id from the tab's guess. A summaries
refetch can see that stored id before the original stream's first frame arrives. The reader
can close the original dialog, open the stored conversation, and delete or discard it. The
original controller retains its confirmation callback, so the delayed first frame still
renames the guessed summary into the stored id. The deleted conversation reappears locally.

The root cause was treating acknowledgement of an older creation as a new creation.
`rename` always wrote the target id and removed its in-flight deletion record. A deletion
between list requests had no record at all. The class is **an older identity acknowledgement
overriding newer local intent**; checking only whether the target row currently exists cannot
tell a later deletion from an id deleted before this new conversation began.

The fix keeps deletions made after each optimistic addition, retiring that record when the
row is listed, renamed or dropped. Naming an id deleted after the addition removes the guess
and preserves the deletion for a current request. A newer explicit addition cancels that
deletion. The record belongs to the addition, so an id deleted before it began can be reused.
This preserves the hook's existing rule that a later server snapshot may restore a row when
the server still has it.

Countermeasures, by ease and value:

1. Done: test `add → refetch → drop(stored id) → rename` both during and between requests in
   [chat-anchors-refresh.test.tsx](../../tests/chat-anchors-refresh.test.tsx). Both were seen
   red on a resurrected row before the fix, then green. Controls preserve legitimate id reuse
   and a newer explicit addition.
2. Done: keep deletion ordering at the same boundary that reconciles identity, rather than
   asking a dialog that may already have closed to decide it.
3. Rejected for this stage: replace summaries with the full chat store. That is a wider change
   and would still need a rule about whether an older acknowledgement can undo a deletion.
