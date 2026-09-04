# Verdict: DO-NOT-SHIP

The clean deadline-pause path is sound, but the end-to-end guarantee still fails when a later claim lapses or is deployed over. That is explicitly one of the recovery cases this change claims to cover, and it can exhaust the three-window budget before the long PDF finishes.

## Findings

1. REASONED — an expired claim still destroys the identity needed by the structure checkpoint

Files: [src/store/pg-jobs.ts:1127](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-jobs.ts:1127), [src/store/pg-jobs.ts:1152](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-jobs.ts:1152), [src/hierarchy.ts:505](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:505)

`pauseForDeadline` correctly preserves `draft_revision_id`, but `settleExpired` still clears it when requeueing a lapsed claim. On an initial ingest, the replacement draft has no published blocks to copy, so `blocks` remints every ID. Those IDs are in the hierarchy request; the structure fingerprint changes and the previous structure checkpoint becomes unreachable.

A concrete failing sequence is:

1. hierarchy overruns and pauses cleanly, spending requeue 1;
2. the next claim is deployed over during hierarchy/labels;
3. `settleExpired` spends requeue 2 and clears the draft;
4. the third window remints IDs and buys structure again;
5. if hierarchy again needs more than one window—as the measured 778-second case does—the budget is spent and the reader gets an error and Retry button.

This contradicts the stated “one pause plus one deploy” coverage.

What it costs: another multi-minute, roughly $2 structure call, and in the sequence above the exact retry click this job exists to remove.

What I would do: preserve the draft on the requeue branch of `settleExpired` too. The current “half-written draft” rationale predates the transactional stage runner: completed products and their step-run completion commit atomically, while an interrupted step remains explicitly `running` and is reopenable by a different attempt. Add an end-to-end test covering clean pause → lapsed resumed claim → final resume, asserting the draft ID, block IDs, and structure checkpoint all survive.

2. REASONED — the hand-back threshold starts a structure call known not to fit

Files: [src/jobs.ts:514](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/jobs.ts:514), [src/jobs.ts:2246](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/jobs.ts:2246)

`STEP_BUDGET_MS.hierarchy` remains 320.4 seconds. The target PDF’s structure call alone measured 508 seconds, and the whole hierarchy step measured 658–778 seconds.

The recorded extract requests took 305–347 seconds, leaving 393–435 seconds. The coordinator therefore starts hierarchy, even though the new evidence says the structure checkpoint cannot land before the deadline. It predictably buys most of a structure call and spends one of only two requeues.

What it costs: one avoidable expensive call and essentially all recovery margin. Combined with finding 1, one ordinary lapse or deploy can force a retry click.

What I would do: give long hierarchy jobs a near-full-window admission budget. The simplest safe version is raising the static hierarchy hand-back threshold and accepting one extra request for ordinary articles; a size-sensitive threshold can follow later.

3. CONFIRMED — the filesystem adapter can return an internally contradictory outcome

Files: [src/store/jobs-fs.ts:684](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/jobs-fs.ts:684), [src/store/jobs-fs.ts:693](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/jobs-fs.ts:693), [src/store/jobs-fs.ts:811](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/jobs-fs.ts:811), [src/store/jobs-fs.ts:817](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/jobs-fs.ts:817)

I ran `pauseForDeadline` and `requestCancel` concurrently. The result was:

```json
{
  "pauseKind": "requeued",
  "pauseStatus": "cancelled",
  "stopStatus": "cancelled",
  "current": "cancelled"
}
```

The pause mutates the shared object, yields while persisting, then clones that same object after Stop has terminalized it. Thus `{kind: "requeued"}` can carry a cancelled job. The Postgres implementation cannot produce that combination.

What it costs: local/dev callers receive `done: false` for a terminal job, and the supposedly exhaustive discriminated union is false at runtime.

What I would do: snapshot both the persisted value and returned transition value at the transition’s linearization point, or serialize each filesystem mutation and persistence as one per-job critical section.

4. CONFIRMED — `defusedFolios` accepts ordinary section-number truncation

File: [src/pdf-score.ts:412](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-score.ts:412)

I scored a source containing `12.3. Genuine heading` against a transcription containing `2.3. Genuine heading`. The checker returned:

```json
{
  "failures": [],
  "absent": ["12.3"],
  "invented": []
}
```

The residual hole is therefore much broader than `2012. → 12`: any line-initial numbered heading with a multi-digit first component admits versions with one to four leading digits removed—`12.3. → 2.3.`, `123.4. → 23.4.` and `3.4.`, and so on.

What it costs: genuine numeric corruption can suppress the retry and publish as acceptable transcription.

What I would do: revert this shortening heuristic for today, or only strip a prefix corroborated as the printed folio. The stronger long-term fix is preserving the text-layer item/line boundary before the folio and heading are fused.

5. REASONED — the estimator knowingly admits an answer its own prompt arithmetic says cannot fit

Files: [src/hierarchy.ts:324](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:324), [src/hierarchy.ts:375](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:375), [src/hierarchy.ts:415](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:415)

The 81 floor is defensible as a conservative allowance, but it means this is not an estimator for most articles: everything below roughly 730 blocks receives the same answer allowance. That matters only if adaptive thinking expands into the extra room.

The `max(headingSegments, ceil(blocks/9))` choice is more serious. The pinned handbook has an estimate of 53,700 tokens against a prompt-faithful 87,300. With 64,000 thinking headroom, the estimate admits a request whose faithful answer cannot fit the model ceiling. This is an empirical bet on the model ignoring parts of the prompt, not an admission bound.

For Kuhn specifically, the evidence supports the bet: its actual answer was only 10,996 tokens. I would not block today’s PDF solely on this finding, but the known handbook case can turn a fast refusal into a long paid truncation.

If thinking expands, the right fix is to separate its budget from the answer allowance: explicitly cap reasoning if the provider supports it, or use an input-sized, measured headroom tier. Do not shrink the answer estimator to pay for reasoning.

6. REASONED — parse-valid but structurally invalid checkpoints remain permanently poisonous

Files: [src/hierarchy.ts:561](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:561), [src/hierarchy.ts:1877](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1877)

`usableStructure` checks only `parseJson`. A stored answer that parses but fails `buildTree`, `appendSupplement`, or `assertTreeSound` is accepted, skips generation, and throws on every attempt without overwriting itself.

Normal writes are correctly placed after all those validations, so shipping code should not create such a row today. It remains reachable through old/manual data or a local interpretation change whose `PROMPT_VERSION` was not bumped.

What I would do: run the complete parse/build/assert gate on a cached candidate; on failure treat it as a miss and let the succeeding call overwrite it.

## What checked out

The Postgres `pauseForDeadline` fencing is sound by inspection. `SELECT … FOR UPDATE` precedes classification, cancellation precedes the budget check, and the update reasserts `liveAttempt`. Stop, expiry, a sweep, and a changed attempt are correctly serialized. The `jobs_cancelling_is_running` constraint is a useful backstop, not a latent 500 in the shipped locked path; the 500 appears only if the lock is removed.

The clean pause path genuinely reopens the same draft and retains block identity. The checkpoint key also covers the actual wire request through the same `messagesWireBody` used by the sender, plus `PROMPT_VERSION`; the write barrier is correctly after structural validation.

Focused results:

- `hierarchy-structure-checkpoint`: 11/11 passed.
- `token-budget`: 21/21 passed.
- PDF score/request parity/source parsing: 52/52 passed.
- Store parity: 51 passed; 60 Postgres cases were sandbox-skipped.
- The two defects above were reproduced with direct scripts.

I would not deploy this exact revision. Findings 1 and 2 together leave the headline outcome dependent on receiving three uninterrupted, favourably timed windows—the recovery machinery is precisely where this job cannot afford that dependency.