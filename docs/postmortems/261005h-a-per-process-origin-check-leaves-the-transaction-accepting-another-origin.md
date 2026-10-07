# A per-process origin check leaves the transaction accepting another origin

Up: [postmortems.md](../project/postmortems.md).

Caught while reviewing `eaf3a3fee`; no evidence this reached readers. Two servers could both
observe that a conversation did not yet exist. After one created it, the other accepted a turn
with a different origin and began answering it, even though the contract requires refusal.
The stored origin stayed unchanged; the refused input was silently accepted instead.

The class is **a process-local check mistaken for a transactional invariant**. The origin
check in `streamChat` ran under `inTurnOrder`, which orders requests inside one process.
`pgChatStore.begin` then read the real thread snapshot under the article-row lock and called
`withTurn`, but that function only assigned origin when creating a thread. Its existing-thread
branch ignored the offered origin. The lock serialized writes correctly while leaving the
decision made before that lock unenforced. Thread-kind validation already had the missing
transactional backstop; origin validation copied the route's anchor check instead.

`git blame` and the scoped diff identify `eaf3a3fee` as the introducing commit: it added the
route check and the insertion-only origin field together. The commit aimed to make a thread
remember the Debate claim that started it. The existing route regressions verified serial
requests through one process, so they agreed with the process-local check. Typechecking cannot
distinguish a locked fresh snapshot from a stale precheck.

The review fix checks an offered origin against the resolved existing thread in `withTurn`,
before minting messages, using `sameOrigin`. Missing and different stored origins throw
`ChatConflict`; an identical resend and an ordinary follow-up remain accepted. Since the
Postgres store calls this inside its locked transaction, this closes the interprocess gap.
The error contains no claim words. This is the durable fix, rather than another route read.

The two regressions in [chat-origin-transaction.test.ts](../../tests/chat-origin-transaction.test.ts)
model the second transaction after another writer created an originless or differently sourced
thread. Both were seen fail with `expected function to throw an error, but it didn't`, then all
three cases passed after the guard, including identical-origin and originless-follow-up controls.
The actual two-process database race was not run in this network-disabled review environment.

Countermeasures, ranked by ease against value:

1. **Exercise the write decision against a snapshot changed after its precheck.** Cheap pure
   regressions, added here. This tests the boundary that actually owns the invariant without
   requiring timing, servers or a database.
2. **Put reference-dependent refusal in the locked write decision.** One guard here, matching
   the thread-kind backstop already present. A route may improve the error response, but it
   cannot substitute for the decision made against the persisted snapshot.
3. **Add two-process database race tests for every immutable field.** Useful additional coverage,
   but rejected as the first remedy: more infrastructure and timing would test the same missing
   predicate less directly. The pure regression catches the defect on every ordinary test run.

The lesson is to follow a new invariant all the way to the transaction that writes it. A lock
around the write does not protect a decision made earlier in a different process.
