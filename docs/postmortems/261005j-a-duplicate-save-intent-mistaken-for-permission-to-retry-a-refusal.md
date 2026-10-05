# A duplicate save intent mistaken for permission to retry a refusal

Found in the quiet autosave review, 2026-10-05. Parent: [postmortems.md](../project/postmortems.md).

The shared hook queued any commit made during a pending request, then drained that queue regardless
of success. Two blurs of the same draft followed by a refusal therefore started a second request,
clearing the visible failure. If that request stalled, the reader saw *Saves as you type.* over words
whose save was already known to have failed.

The class is **a duplicate save intent mistaken for permission to retry a refusal**. The queue
conflated newer words waiting to save with the same words being requested twice. Introduced by
`bc4ac3f2d241e99da93092486ab81e0079855c80`, the original autosave hook, 2026-10-01. Existing tests
covered queued *newer* words after failure but omitted the duplicate draft.

The regression was red before the fix: it observed two requests for *Words to keep* where one was
expected. This reproduced the actual duplicate-commit sequence rather than only asserting the
status helper's copy.

The narrow, lasting fix makes queue drainage depend on success or a changed draft, matching
[`AddPurposeSession`](../../src/web/add-purpose.ts). A later explicit retry still works. Departure
writes remain best effort and are outside this queue's promise.

Countermeasures, ranked by ease against value:

1. **Test duplicate and changed intents separately** — the regression in
   [`autosaved-text.test.tsx`](../../tests/autosaved-text.test.tsx) queues the same words, rejects,
   and checks one request, visible failure, and a working later explicit retry.
2. **Failure-aware queue drainage** — preserve newer drafts without treating a duplicate request
   as authority to retry the rejected text.
3. **A backend retry protocol** — rejected: this defect is a local queue decision, and another
   protocol would not repair the missing distinction.
