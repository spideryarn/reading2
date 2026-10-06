**Verdicts: A — build with changes; B — build with changes; C — build with changes.** All three are worth building. A has a demonstrated hole that prevents deleting its fallback as proposed. B needs a precise retry policy. C’s reuse of the queue is sound, but its context value and integration tests need tightening.

Read-only review completed; no files edited. I ran a small, unpaid probe against the current labels planner.

**F1 — P1, established — A’s splitting rule does not guarantee askable batches.**

The 2,032 threshold is correct **for an isolated set**, but the planner budgets the combined batch. `MIN_BATCH` is 13. A short preceding set can prevent closing before the large set; a short trailing batch can be merged backwards into it. Both paths are reachable in [labels.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/labels.ts:740).

The probe returned:

| Sibling-set sizes | Planned batch sizes | Unaskable |
|---|---|---|
| `[2032]` | `[2032]` | No |
| `[1, 2032]` | `[2033]` | Yes |
| `[2032, 1]` | `[2033]` | Yes |
| `[2032, 12]` | `[2044]` | Yes |

None of those neighbouring sets would be split by A. Therefore, after the proposed change, an unaskable plan remains reachable. Removing the structure checks would preserve the model tree but let its labels job fail before asking that batch.

**Required change:** make askability an invariant of the **final batch plan**, including the floor and tail merge. A simple approach is to window individually unaskable sets, then repair any remaining unaskable combined batches into askable calls. Keep the fallbacks until tests establish that invariant.

Add both neighbouring-set cases above, heading-heavy windows, and the tail merge. The isolated 2,032-leaf case can retain its existing plan; every arrangement containing such a set cannot necessarily do so.

A’s other design choices are sound:

- Cutting calls preserves the model’s hierarchy and gists.
- I found no downstream production assumption that `nodeId` is unique across sibling sets. Prompts iterate sets; checkpoint fingerprints include each set’s block IDs and boundaries; records carry block IDs and `setStarts`; merging addresses labels by block ID. See [labels.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/labels.ts:1082).
- There is an existing test asserting unique parent IDs across sets. Its contract will need narrowing for windowed sets: [labels-batching.test.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/tests/labels-batching.test.ts:182).

Cutting only otherwise-unaskable calls is defensible as this stage’s scope. It prevents losing all model gists because labels cannot start. It **does leave the 500-leaf call’s reliability unchanged**; the plan should continue describing that as deferred work.

**F2 — P2, reasoned — B needs to distinguish retryable failure from the run’s terminal time state.**

Today, a transport failure ends the root with `root-call-failed`. A timeout ends it with **`out-of-time`**, contrary to the candidate’s description.

The existing helper also makes a second invocation ineffective unless its state handling changes:

- A failed required call sets `gaveUp`.
- A timed-out needed call sets `outOfTime`.
- A later checkpoint miss encounters `ended()` and starts no call.

Those transitions are explicit in [structure-slices.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/structure-slices.ts:523) and [the admission loop](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/structure-slices.ts:585). Merely wrapping the current root ask in a second ask will not implement B.

**Recommended simpler policy:** follow the slices policy literally: give transport or validation failure a second chance; keep timeout as `out-of-time`, which C can resume in another window. If B must retry a root timeout inside the same window, explicitly design that exception without clearing a time failure belonging to earlier slice work.

Specify the call ceiling too: first root ask may re-ask an invalid answer; the second chance gets one call. That permits at most three logical root calls, matching the slices pattern.

Missing tests:

- Invalid answer twice, followed by a valid second-chance answer.
- Root timeout, distinct from transport failure and denied admission.
- Refusal/truncation starts no second chance.
- The retry counter stays false when admission denies the call.
- Usage from both attempts is counted; successful slice/refill calls are not repeated.

B is worthwhile: it removes the remaining single required root failure without rerunning the slice pool.

**F3 — P2, reasoned — C must normalize the optional requeue count and test the actual retained draft.**

`job.requeues` is absent at zero: [pg-jobs.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/store/pg-jobs.ts:222). The context calculation must use:

```ts
(job.requeues ?? 0) < REQUEUE_BUDGET
```

A direct comparison with `undefined` would deny another window on the initial claim.

The counter is otherwise the right one. A live claimant’s count cannot ordinarily be consumed by another cooperative pause without its claim becoming stale. `pauseForDeadline` checks the current attempt, status, lease, cancellation and budget under a row lock: [pg-jobs.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/store/pg-jobs.ts:1386). There is no additional ordinary refusal hidden behind the count.

C should use an explicit hand-back outcome in `runStep` and the walk. The current branch requires both `outcome === "cancelled"` and a controller reason of `DeadlineReached`; a typed throw alone reaches neither condition. Preserve actual Stop precedence.

The proposed tests need a **composed Postgres-backed job test**, with the model mocked:

1. Start with absent `requeues`, buy some answers, and hand back.
2. Assert the same draft and published revision remain, the step is pending without an error, and ledger rows exist.
3. Reclaim and finish using the saved answers.
4. Repeat over an already-published real tree.
5. Exercise exhausted budget, Stop, and stale claim outcomes.

These are necessary because isolated `generateStructure` tests cannot prove draft retention, skip prevention or accounting.

Your accounting and skip suspicions do **not** reveal a defect in the proposed approach:

- `collectSpend` runs its failure callback and awaits ledger writes in `finally`: [ai-spend.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/ai-spend.ts:940).
- `beginStep` commits the running marker before model work: [pg-session.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/store/pg-session.ts:712).
- `stepIsDone` rejects that interrupted marker before considering existing artefacts: [pipeline.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/pipeline.ts:1134).

Thus, throwing after the slice calls settle preserves ledger accounting and prevents a resumed window from skipping—even when the draft contains a previously published real tree. The successful run’s returned usage totals will describe that window; cumulative spend remains in the ledger.

**F4 — P3, established — C’s successor and refusal explanations need qualification.**

For the ordinary unforced structure successor, publishing another awaiting tree would indeed deduplicate onto the publishing job. However, that active job already owns a draft, so the result is **`boundToOlderBase`**, not `alreadyQueued`: [pg-successor.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/store/pg-successor.ts:283).

The assertion is also conditional on matching work keys. Force, profile and other inputs participate in the key: [jobs.ts](/var/tmp/spideryarn-worktrees/qi-kssrwchh-long-structure-1a-rest/src/store/jobs.ts:81). A forced `["structure"]` job need not collide with the unforced successor.

Likewise, a refused pause does not always “end failed”: Stop ends cancelled; a stale claim follows the lost-claim path. The candidate’s instruction to preserve existing endings is correct; its summary sentence is not.

C remains simpler than adding successor machinery.

The seven claims, checked individually:

| Claim | Result |
|---|---|
| 1. Only a sibling set over 2,032 can make a batch unaskable | **False; demonstrated above.** |
| 2. A makes both fallback arms unreachable | **False as proposed.** |
| 3. Downstream consumers require one set per parent | **No such production assumption found.** An existing test asserts it. |
| 4. Root is asked once plus a validation re-ask; failure discards slices | **Mostly true.** Timeout reports `out-of-time`; accepted slices survive in checkpoints. |
| 5. Slices never reach mid-step hand-back | **Normally true, not literally never.** Their early stop returns a finished fallback; an actual queue abort can still unwind into hand-back. |
| 6. Another window reuses checkpoints and preserves draft/publication | **Supported**, provided C preserves the existing pause path. Reuse depends on matching requests and successful checkpoint writes. |
| 7. Awaiting publication inside `["structure"]` collapses onto itself | **True for the matching unforced successor key**, with `boundToOlderBase` as the outcome. |

No P0 finding. A’s final-plan askability guarantee is the main change required before building.