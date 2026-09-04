# Verdict: DO-NOT-SHIP

The central claim is wrong. The current `N/4` estimate may be overly conservative for this document, but the prompt does not bound the answer to ~91 internal nodes. Stage 2 must not be built on that premise.

## Findings, ranked

1. CONFIRMED — the hierarchy answer is not bounded by the prompt

Files: [src/hierarchy.ts:135](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:135), [src/hierarchy.ts:246](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:246), [docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:43](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:43)

The apparent 91-node bound assumes that both “3 levels” and “5–9 children” are hard constraints. They are prose instructions, and one explicitly says “Aim for”. The other rules conflict with that bound:

- A heading is a hard boundary, so an article with more than 81 heading sections cannot fit under root → 9 chapters → 81 sections.
- On the natural strict reading of the long-run rule, 2,024 headingless blocks need at least `ceil(2024 / 9) = 225` sections.
- Grouping 225 sections by at most nine requires 25 chapters: `1 + 25 + 225 = 251` internal nodes. That keeps three levels but gives the root 25 children.
- Keeping fan-out at nine instead requires another grouping level: roughly `1 + 3 + 25 + 225 = 254` internal nodes, violating the depth instruction.

If “~9” is instead merely guidance, it supplies no numeric bound at all.

The runtime enforces neither constraint. `ModelNode.children` is recursive and `buildTree` descends without a maximum-depth or maximum-fan-out check. I reproduced this: `buildTree` accepted a proposal with internal depths `[0,1,2,3,4]`.

What it costs: a bounded estimator can allocate only 56,425 tokens for 91 nodes, while 251 nodes at the retained constants need about 84,425 including headroom. The call then fails late at `max_tokens`, after spending minutes and money.

What I would do: retain a conservative growth term based on heading count, long-run splits, and their required ancestors. If the desired answer is truly bounded, mechanically enforce the depth/fan-out bound in the generation contract before making the estimator rely on it. Keep an adversarial large/article-with-many-headings test; do not replace it with “bounded above for large N”.

Stage 1 can establish that Kuhn fits one pass. A finite corpus cannot establish that node count is asymptotically bounded.

2. CONFIRMED — Stage 4 destroys the identity Stage 3’s checkpoint needs

Files: [src/store/pg-jobs.ts:985](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-jobs.ts:985), [src/blocks.ts:1129](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/blocks.ts:1129), [src/ids.ts:35](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/ids.ts:35), [docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:145](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:145)

The plan says clearing `draft_revision_id` is affordable because the expensive halves are checkpointed. That ceases to be true for the proposed structure checkpoint.

On a first ingest:

1. Clearing the draft leaves no published blocks to carry into the next draft.
2. `blocks` runs as a genuine first ingest and randomly mints every block ID again.
3. The structure request contains those IDs.
4. Therefore its request fingerprint changes, and the saved structure response cannot be reused anyway because its ranges name the old IDs.

I reproduced the identity break by running `runBlocks` twice over identical HTML with no previous blocks. It minted `spya-vujqdh` and `spya-xad049`; `same: false`.

The label checkpoint has the same problem because its fingerprints also include block and tree identities.

What it costs: every automatic window can repay the entire hierarchy call. Stages 3 and 4 therefore do not compose into the claimed resumable path.

What I would do: make cooperative deadline hand-back a capped pause that preserves the draft. Unlike a lapsed claimant, this claimant has unwound cleanly. A later attempt may legitimately reopen a running step row—`beginStepRun` already supports a different attempt doing that. Remapping a cached tree onto freshly minted IDs is the more complicated alternative.

3. REASONED — Stage 4’s state transition does not yet cover its races

Files: [src/jobs.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/jobs.ts:269), [src/store/job-fence.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/job-fence.ts:82), [src/store/pg-jobs.ts:1025](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-jobs.ts:1025), [src/store/pg-jobs.ts:1407](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-jobs.ts:1407)

Self-revocation is safe only if the transition atomically uses `liveAttempt(id, attempt)` and clears the attempt/status. All later claimant and draft writes will then be fenced out.

But “zero rows means the budget was spent” is false. It can also mean:

- Stop set `cancelling`;
- the 20-second unwind margin elapsed and the lease expired;
- another sweep already requeued the job;
- the attempt or status changed.

The Stop case is particularly important. If the requeue excludes `cancelling` and then falls through to today’s `interruptedEnding`, `finishIn` deliberately clears `cancelling` and keeps the supplied ending. The incomplete job can therefore become `error` even though the reader pressed Stop.

The budget is shared: the one `jobs.requeues` counter is incremented by both lapsed-lease recovery and the proposed cooperative recovery. “Three windows” remains correct in total, but it is not three cooperative overruns. A lapse followed by one cooperative requeue leaves only the third total window.

What I would do: have one atomic transition return a discriminated outcome such as `requeued | cancelled | budget-spent | stale`, preserve the draft on `requeued`, and make cancellation win. Add mixed-path tests: lapse then overrun, Stop racing the overrun, and unwind crossing lease expiry.

4. REASONED — the checkpoint fingerprint is another hand-maintained partial request

Files: [docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:127](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:127), [src/hierarchy.ts:1479](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1479), [src/messages-stream.ts:433](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/messages-stream.ts:433), [src/pdf-read.ts:299](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-read.ts:299)

The proposed list—system, user, model, effort and `PROMPT_VERSION`—is not the request bytes. It omits at least:

- `thinking: {type: "adaptive"}`;
- `max_tokens`;
- the provider routing injected by `streamMessage`;
- the distinction between the stored model name and the actual `modelFor("hierarchy")` wire ID.

Some fields may deliberately be excluded from a semantic cache key, but that must be an explicit decision. Calling a copied subset “request bytes” recreates the blind spot `promptFingerprint` was written to remove.

The plan also does not say when the response is saved. Saving before `parseJson` and `buildTree` succeed would permanently replay a malformed but complete answer.

What I would do: build and hash one canonical semantic request object from the same assembly path the call uses, with deliberate exclusions documented. Save only an answer that has parsed and built successfully. Mutation tests should prove that every generation-affecting field changes the key.

5. REASONED — the stage order temporarily deploys the failure being fixed

File: [docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:104](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:104)

Stage 2 admits long documents before either structure checkpointing or automatic hand-back exists. A deployment at that stage converts a fast, free refusal into a long paid call that may end at the deadline and require a click.

Use this order:

1. Measure.
2. Add the corrected, validated checkpoint.
3. Add capped cooperative pause while preserving the draft.
4. Change the estimator/admission rule.
5. Use sectioning only if the measurement says one pass cannot safely fit.
6. Deploy and exercise the real document.

That leaves every intermediate stage deployable.

6. REASONED — the hierarchy-only recovery in Stage 6 has no blocks to read

Files: [docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:167](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md:167), [src/store/pg-session.ts:456](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-session.ts:456), [src/store/pg-revisions.ts:739](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/store/pg-revisions.ts:739)

A failed initial ingest does not leave `extract` and `blocks` published. The failure transaction fails the draft and clears the job’s pointer. A later draft copies only the current published revision; on an initial ingest there is none.

A new `steps: ["hierarchy"]` job therefore starts with no blocks and cannot perform hierarchy.

What I would do: programmatically retry the original failed job with its full steps and source provenance, retaining the same article so the PDF chunk checkpoints are found. Do not claim that the discarded draft’s completed steps are available.

7. CONFIRMED — the numbered-heading false positive is real, but the plan misstates its consequence

Files: [src/pdf-score.ts:266](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-score.ts:266), [src/pdf-score.ts:578](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-score.ts:578), [src/pdf-read.ts:1719](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-read.ts:1719), [src/pdf-read.ts:1818](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/pdf-read.ts:1818)

On the real PDF, page 37’s text layer contains `649.5.10.`—the printed page number `64` fused to authored heading `9.5.10`. Scoring a correct `9.5.10` heading produces:

```json
{"raw":["649.5.10."],"invented":["9.5.10"]}
```

So yes: hierarchically numbered documents have a confirmed false-positive class. Whole-token matching cannot recognise a correct protected token fused to page furniture.

However, the plan’s “nothing is written unless every chunk passes” statement is stale. After the second attempt, `runPdfExtract` records the failure as `meta.quality`, logs that it published with quality notes, and returns the article. This is no longer a hard liveness gate.

Treating it outside the critical hierarchy path is therefore defensible, but 21 unnecessary calls on one document is not footnote-sized. I would give it a small independent stage before the final production run: strip only a known page-number/furniture affix, while retaining the regression that prevents `12` matching `2012`.

## On the constants

Keeping `175` is reasonable only after Stage 1 confirms it against compact output across the corpus. It is the safer half to retain.

Keeping `THINKING_HEADROOM = 40_000` is not yet established for Kuhn. [src/token-budget.ts:21](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/token-budget.ts:21) says thinking grows with the input, while the constant came from a much shorter call and is explicitly a flat simplification. Stage 1 should gate on Kuhn’s measured thinking split as well as its node count. Do not shrink it to force admission; use a hierarchy-specific measured reservation if Kuhn shows the existing one is insufficient.

In short: `N/4` may indeed be the wrong estimate for Kuhn, and Kuhn may fit comfortably in one pass. But “the answer is bounded at ~91 nodes regardless of article length” is false, and the proposed checkpoint/requeue combination loses the identities required to resume.