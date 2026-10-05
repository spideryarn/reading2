# Detaching navigation also detaches draft confirmation

Up: [postmortems.md](../project/postmortems.md).

Caught during review of `eaf3a3fee`; no evidence this reached readers. Send a claim's question,
leave Chat before acknowledgement, and let the server confirm a corrected thread id. The
pending origin remained under the guessed id instead of following confirmation of the real
thread. Returning to Chat could then mistake that stale guess for an unconfirmed conversation.

The class is **data acknowledgement attached to a navigation callback's shorter lifetime**.
The controller deliberately clears `onThreadId` on detach: a late server response must not
repoint the URL after the reader has left. But `eaf3a3fee` also used that callback to transfer
draft origin to a corrected id. The UI lifetime was therefore made responsible for data that
outlives the UI. The server and detached controller knew the real id while the durable draft
store continued to hold an unconfirmed guess.

`eaf3a3fee` introduced the origin-transfer work inside `onThreadId`; the detach behavior
predates that change and protects navigation correctly. Tests covered correction while Chat
remained mounted and departure without a correction. They did not cross those two boundaries.

The regression in
[conversation-band-origin.test.tsx](../../tests/conversation-band-origin.test.tsx),
`forgets a pending guess when the server corrects its id after leaving Chat`, releases a
corrected acknowledgement only after unmount. Before the fix it expected the guessed id's
pending origin to be `undefined` and received the claim origin. After the fix, all 17 tests
in that file passed, including the absent-guess and explicit-other-selection controls.

The durable fix adds a data-only `onConfirmed` callback, separate from UI navigation. Its
controller map survives detach and is pruned when the operation finishes. The accepted `begin`
acknowledgement invokes it for both corrected and unchanged ids. On correction, draft words
move to the confirmed id and the saved destination follows only if it still names the guess;
the acknowledged pending origin is cleared. The rendered source comes from the server's row.
`onThreadId` remains detachable and only handles navigation.

Countermeasures, ranked by ease against value:

1. **Delay a corrected acknowledgement until after unmount.** Added here. One controlled
   regression establishes whether durable data bookkeeping survives when navigation should not.
2. **Separate callbacks by ownership lifetime.** A small second callback closes the gap without
   retaining a component's state setter or inventing a new persistence layer. The completed
   operation still prunes both maps.
3. **Keep all navigation callbacks after detach.** Rejected: it would fix the draft transfer by
   restoring the older defect where a late response changes what the reader is viewing now.

The lesson is to preserve acknowledgement work while detaching navigation. Sharing an event
does not mean two callbacks share an owner or a lifetime.
