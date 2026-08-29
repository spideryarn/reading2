Verdict: **BLOCKED.** I found two data-integrity failures.

1. **Duplicate note text rotates identities.** [`mintNoteId`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:644) appends order-based counters for identical notes such as “Ibid.” Inserting another identical note above them changes `hash → hash-2 → hash-3`.

   Reproduction: the unchanged Alpha and Beta passages both reminted; worse, the new note inherited the first old note body’s block id, and the first old note inherited the second’s. Comments can move to the wrong logical note.

2. **The migration fallback is not directionally safe.** New and legacy keys share the same namespace. A legacy text can spell `n[spya-note-…]prose`, so [`legacyKey`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:475) can collide with a stamped previous block’s new key.

   I reproduced:

   - Previous: `Tail` citing note A.
   - Current: literal `n[A]Tai` followed by marker `l`, citing note B.
   - The current legacy text becomes `n[A]Tail`, matching the previous new-style key.
   - The changed paragraph received the old id.

   With the unchanged `Tail`/note-A paragraph later in the document, the earlier fallback stole its id and the exact match minted. [`taken`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:548) prevents two claims, but cannot prevent the wrong first claim.

Fix this by:

- Giving legacy and new keys disjoint namespaces or structural encoding.
- Building legacy buckets only from parsed, genuinely unstamped previous blocks.
- Completing all new-key exact matches before running any migration fallback.

On content sensitivity: it is explicitly intended by the current plan and [`withoutNoteControls`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:396), but I do not think it is worth the cost. Editing a note should remint the note body block, not every unchanged passage citing it.

There is no perfect answer from two snapshots: “note edited” and “old note replaced at the same location” can be observationally identical. But a practical non-circular identity exists:

- Preserve the author’s original target anchor as a second continuity signal.
- Match notes first: unchanged content hash survives renumbering; unchanged source anchor survives wording edits.
- If both change, mint; if ambiguous, mint.
- Assign the reconciled persistent note identity before matching citing passages.

That handles ordinary insertions, typo fixes, and repoints. Simultaneous renumbering plus editing remains an honest limitation.

Other checks:

- **No-op guarantee:** exact only when none of the three strings occurs in `html`. It is not airtight for semantic “no stamps”.
- **Fragment parsing:** pipeline-written blocks are one `outerHTML` element, so normal matching agrees. Multiple roots use only the first element; leading/trailing text and later stamped elements are ignored. A text-only fragment falls back to the supplied text.
- **Gate:** not equivalent to parsing. Attribute names in prose/comments cause false positives; uppercase raw attributes cause false negatives. After parsing, “no actual stamps found” should return the original text.
- **Ordering:** different order and repeated citations are encoded correctly.
- **Invalid ref values:** the node is removed but contributes no identity. Stage 2 should prevent this, but corrupt/direct input collapses distinct controls instead of failing safely.

Verification: the focused suite currently passes **16/16**, but it lacks the duplicate-“Ibid.” insertion and legacy/new namespace-collision cases. No files were changed.