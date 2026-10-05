# A failed submission hides a pending origin behind a missing local thread

Up: [postmortems.md](../project/postmortems.md).

Caught while reviewing `eaf3a3fee`; no evidence this reached readers. A claim's first Send
failed before acknowledgement. Leaving Chat and returning opened a different draft with no
origin, although the pending source remained in storage under the original conversation id.

The class is **a submission safety guard that provides no resumption path for an uncertain
write**. The draft store revokes freshness on submission, whether that submission succeeds or
fails. The arrival rule correctly refuses to recreate a submitted conversation under a new id:
its write may have landed, and a new id would sever its server history. But the rule did not
provide the alternative of resuming the same id. Once the old local controller disappeared,
an empty successful load fell through to starting an unrelated chat.

The submission guard predates origins and was intentional. `eaf3a3fee` made the gap violate
the new pending-origin contract: provenance must survive a failed first Send followed by a
mode change. Its failed-send test retried in the mounted band; its mode-change test moved a
draft that was still fresh. Neither combined the two transitions.

The fix lets local `begin` resume a supplied id without writing anything. On arrival, a
missing draft with a pending origin and an uncertain prior submission is reopened under that
same id. A subsequent Send offers the same origin and joins the existing server history if
the first write actually landed. Failed loads also resume the exact id rather than inferring
absence and minting another. An already selected loaded conversation must retain the reader's
choice instead of being displaced by this restoration.

Acknowledgement after unmount must also retire a guessed identity; its separate lifetime is
covered in [the draft-confirmation postmortem](261005m-detaching-navigation-also-detaches-draft-confirmation.md).

The regression in
[conversation-band-origin.test.tsx](../../tests/conversation-band-origin.test.tsx),
`keeps the pending origin and id after a failed first Send followed by leaving Chat`, failed
because the restored id differed from the original. It also checks that the next request uses
the original id and retained origin. This reproduces the consumer failure without a database.
Controls also cover a detached id correction and an explicit choice of another loaded chat.
The independent review run after these fixes passed all 17 tests in the file.

Countermeasures, ranked by ease against value:

1. **Combine uncertain submission with departure and return in a test.** Added here. Testing
   either transition independently missed the state created by their composition.
2. **Preserve identity when resuming an uncertain write.** The local resume path is cheap and
   keeps the original guard's purpose: uncertainty must not fork a conversation's history.
   Test restoration against an explicit later reader choice as well.
3. **Treat a failed Send as never submitted and recreate freely.** Rejected: a transport failure
   cannot prove the database rejected the write. That would restore the origin while losing
   the very history the submission guard protects.

The durable design distinguishes a fresh draft that may move from an uncertain submission
that may only resume its identity. A refusal to recreate is incomplete without that safe path.
