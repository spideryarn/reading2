# Stage 3 review — enacted plans and the broadcast

Candidate: `26735b21a41936691ea8e7b9914b1a42c0a34568`.

## Findings

- **F41 — P1, established: a broadcast parent can be durably `completed` while a child is `outcome-unknown`, missing, or non-durable.**
  - **(a) Input/mutation:** a direct recipient whose coordinator result is `partial` gets an `outcome-unknown` child, after which both broadcast loops unconditionally write `completed` on the parent. A selective child-outcome write failure followed by a successful parent-outcome write leaves the same false durable claim after restart; a non-durable queued child likewise disappears while its durable parent continues to replay as complete.
  - **(b) Change:** derive the parent outcome from the expected child count, durability, and child states. Write `outcome-unknown` unless every requested recipient has durable evidence and no direct child is pending or unknown. Use the same helper in both broadcast routes, and give every skipped/refused recipient a linked `not-sent` child so missing evidence cannot be hidden by a smaller child count.

- **F42 — P1, established: the journal accepts a broadcast child with no parent link, contrary to the receipt schema's authoritative invariant.**
  - **(a) Mutation:** parse an explicit Stage 3 `accepted` record with `op: "broadcast-recipient"`, `origin: "broadcast"`, and `parentReceiptId: null`; the candidate parser accepts it. It also accepts a parent link on unrelated session operations.
  - **(b) Change:** make the parser require a non-empty parent for direct Stage 3 broadcast children, while retaining deliberately supported legacy Stage 1/2 lines and the existing parentless queued-receipt API; reject parent links on unrelated operations and reject a queue payload on a direct child. Add red-first parser tests. Parent retention is independent of child retention, so validation deliberately checks the link's shape rather than requiring the parent still to be present in the current fold.

- **F43 — P1, established: a thrown broadcast transport can put the message text in the server log and response.**
  - **(a) Input/mutation:** inject a transport that throws `new Error("transport rejected " + text)`. `routes-broadcast.ts` logged `attempt.error.message` and returned it in the recipient row; the ease-off loop returned the same unsafe error text. The focused test observed the complete broadcast in the log.
  - **(b) Change:** use a generic diagnostic for a thrown transport in both Stage 3 broadcast loops. The receipt path already used the safe generic `sendAttemptOutcome` mapping.

No P0 was found. The keyed enacted-run lookup happens before current catalogue/preview checks, durable `accepted` and `attempted` are fail-closed before effects, progress is recorded only after a judged step, box receipts use `target: null`, and replay summaries contain no message text.

## Verification and changed files

The first focused red run failed in the four expected places: an unknown child, a non-durable queued child, and a missing skipped child all left the parent completed, and the parser accepted a parentless direct child. A separate red test observed the complete broadcast text in a thrown-transport log. After the fixes:

- The exact Stage 3 gate passed: 19 files, 1,083 tests.
- A focused four-file run passed: 252 tests.
- The repository typecheck passed through its direct equivalent, `node --import tsx scripts/typecheck.ts` (all four projects, 1,962 files). The `npm run typecheck` wrapper itself could not create tsx's Unix socket in this sandbox (`EPERM` under `/tmp`).
- `git diff --check` passed.
- The full `npm test` launcher could not open the local private-lane PostgreSQL port (`EPERM 127.0.0.1:54362`); the receipt/action gate above is fully green. Targeted lint still encounters the repository's existing `noControlCharactersInRegex` diagnostic at `tools/fleet/routes-actions.ts:1093`; no new lint diagnostic was identified in the changed hunks.

Files changed by this review:

- `docs/plans/260910d-durable-action-receipts-stage3-review-sol.md`
- `tests/fleet-actions-route.test.ts`
- `tests/fleet-broadcast-receipts.test.ts`
- `tests/fleet-broadcast-route.test.ts`
- `tests/fleet-receipt-journal.test.ts`
- `tools/fleet/receipt-journal.ts`
- `tools/fleet/routes-actions.ts`
- `tools/fleet/routes-broadcast.ts`

land with the fixes above
