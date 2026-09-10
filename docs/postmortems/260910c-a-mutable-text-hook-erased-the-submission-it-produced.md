# A mutable text hook erased the submission it produced

Stage 2's draft hook kept the current textarea and its storage key, but a caller
submitted plain text and later called an unconditional `clear()`. If the recipient,
mount, or text changed while the request was in flight, the answer no longer knew
which draft it had accepted. The same missing provenance meant words typed before a
conversation could be verified existed only in the component that Stage 1 correctly
remounted when the target changed. Review caught both defects before deployment;
nothing reached a reader.

## What happened

Three red-first integration tests established the failures:

- moving the mounted Overseer card from conversation C to D kept C's words on screen
  but left D's Send button live;
- resolving a successful Send after a verified same-conversation relaunch left the
  already-sent stored draft restored in the new composer;
- verifying a different target after somebody typed during an unreadable collection
  remounted the pane and silently emptied the unfiled words.

A fourth test found the sibling: editing the broadcast box while its request was in
flight let the old success clear the newer text. Queue had the same unconditional
completion path as Send.

The draft implementation was introduced in `08fa8e19bb7ef5317dad1ae44254c5e967f37a7b`;
the session composer and its keyed-remount interaction were introduced in
`0e3d92c01be484b422fba7e995b989a1cec9bb2a`.

## The class: provenance erased at a mutable boundary

The hook returned a changing value and commands that acted on whatever value was
current when they ran. It did not return an identity for the value a request took.
That makes an asynchronous answer authority over state it did not submit. A component
remount is the same class from the other direction: state without an identity has no
safe place to cross the boundary, so it disappears or is guessed into the new owner.

Text equality is not enough provenance. Somebody can edit A to B and back to A while
a request is pending; only a generation distinguishes the submitted A from the later
A. A storage key is not enough either, because unverified words deliberately have no
conversation key yet.

## Why nothing went red

The hook suite thoroughly covered storage keys, refusals, caps, reloads, and immediate
Clear. The component suites covered immediate successful Send and Queue. None held a
request open while editing or remounting, so `clear()` always happened to refer to the
same text the test submitted.

Stage 1's replacement tests did exercise remounting, but two fixtures were changed to
an unverifiable conversation and continued to assert that the draft became empty.
They proved the pane remounted and its outcome cards cleared; they also encoded the
opposite of Stage 2's stronger promise for blind typing. A new verified-relaunch test
now separates the two effects: outcome cards reset while the same conversation's
stored draft returns.

Typechecking could not help because `clear(): void` was a valid API. The missing fact
was absent from the type rather than represented wrongly.

## What would have caught it, ranked by ease against value

1. **Hold one request open in every mutable composer test, then edit or remount before
   resolving it** — cheap, and now done for Send and Queue (a same-conversation relaunch while the
   request is open) and for the broadcast (an edit while it is open). The Overseer card's
   new test covers its recipient change with no request open; an edit to its box while a
   Send is in flight, which its textarea allows, is protected by the ticket but untested.
2. **Make successful completion accept a submission ticket rather than exposing
   unconditional success-clearing to callers** — done. The ticket carries a generation;
   the hook owns comparison, storage removal, and notifying a replacement mount.
3. **Give unfiled text a stable page-only slot plus its originating target scope** —
   done. It survives a keyed remount in memory, is never written to session storage,
   and becomes non-submittable when the scope differs.
4. **Disable editing for the duration of every request** — rejected. It would avoid
   one sibling but not a same-conversation remount or blind typing loss, and the
   broadcast intentionally permits preparing the next wording while a request runs.
5. **Persist every unverified draft under the row or role** — rejected. Those names
   can be reused by another conversation; survival would be bought by putting words
   in front of the wrong recipient, the failure the draft design exists to prevent.

## The long-term fix

`drafts.ts` now owns submission acceptance as well as editing and persistence. A
caller snapshots a `DraftSubmission`, sends its text, and returns that ticket only on
success. Acceptance clears only an unchanged generation, removes its exact stored or
page-only copy, and tells any replacement mount showing that generation to clear.

One limit, found by a scratch probe during verification, **is now closed** (F29 in the plan).
The generation was counted per box slot (the row, or the one Overseer card), not per
conversation: if the pane had moved to a different conversation B and somebody typed there
before A's successful answer arrived, the acceptance was declined as stale, so A's sent draft
stayed in storage and was restored if A returned. The baseline's unconditional clear removed
nothing in that case either, so it was a gap the fix left rather than one it introduced. It is
closed by a second counter per stored key, moved whenever any box decides to write or remove
that key. Acceptance now asks two questions before either counter moves: may the stored copy
go (nothing has written its key since the ticket), and may the box be cleared (the box has not
changed since). So A's answer removes A's stored copy after the pane moved to B and was typed
into, never touches B's key, and still leaves an edit made to A's own box while the request was
open, on screen and in storage. The broadcast's box counter is its stored key's counter, so its
rule is unchanged. The tests are in `tests/fleet-web.test.tsx` (Send and Queue) and
`tests/fleet-drafts.test.tsx`.

A second limit, found while closing the first, **is closed too** (F30). Typing done before any
conversation verified is sent with no stored key on its ticket; if the conversation then
verified while the request was open, the hook filed the words under A, and the success cleared
the box but left A's copy, so a reload restored words already sent. The box is only told of a
success when its own generation is unchanged since the ticket, so the words under any key it was
filed under after the send are the sent words: it now removes that key as it clears. The ticket's
own key is still decided only by the stored-key check, and an edit made after the send moves the
box's generation, so it survives in the box and in A's key.

Conversation-less typing uses a page-only key made from the box purpose and stable UI
slot. Its target scope travels with it across a remount: the same scope may later file
it under a verified conversation; a changed scope keeps it visible, unpersisted, and
unable to submit until the person clears it.

## The thing I would tell myself

If an asynchronous operation starts from mutable state, plain text is payload but not
identity. I need to decide what exact generation the answer may consume before I write
the success callback, and I need that identity to survive every remount the surrounding
design deliberately causes.
