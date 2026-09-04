# Code review prompt — a long PDF finishes without a retry click

You are reviewing **built code**, not a plan. This is the second review of this job and it is weighted
higher than the plan review, because a plan-stage review reads prose and cannot find a transition
that writes one field and then rejects the request.

You are in the git worktree `/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry`, branch
`worktree-long-pdf-no-retry`. The tree is read-only to you, but you **can and should** run a single
test file or a small script:

```
npx vitest run tests/<one>.test.ts
node --import tsx <script.ts>
```

`npm test` and `npm run typecheck` are blocked by the sandbox. A finding you reproduced outranks one
you reasoned to — please reproduce at least one.

## What to read

- The plan: `docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md`
- **Your own plan-stage review**, which returned DO-NOT-SHIP:
  `docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click-review-sol.md`
- The scoped diff of everything built since:
  `/tmp/claude-1000/-home-greg-code-spideryarn2/c15c735e-b274-4ee1-905d-78ac341cfd80/scratchpad/o6-scoped.diff`
  (commits `653dd077..HEAD`: `78f1f64f`, `49def67b`, `c09992f1` and siblings)

Three stages landed, by three separate agents working in parallel:

- **Stage 3** — a claimant that runs out of time mid-step *pauses* instead of ending the job:
  `pauseForDeadline(id, attempt, requeueBudget)` on both `JobStore` adapters, returning
  `requeued | cancelled | budget-spent | stale`. Only `requeued` writes the row. The draft is
  preserved (this was your finding 2 — that `settleExpired`'s requeue nulls the draft and re-mints
  block ids).
- **Stage 4 + 2** — `estimateHierarchyTokens` re-derived, `STRUCTURE_HEADROOM = 64_000`, and the
  structure answer checkpointed on a digest of `messagesWireBody("hierarchy", params)`.
- **Stage 5** — `defusedFolios` in `src/pdf-score.ts`, `MAX_CHUNK_BYTES` in the chunk planner, and
  `cutPages` → `openPdfCuts` parsing the source once.

## What I most want attacked

**1. `pauseForDeadline`, hardest of all.** It is new concurrent state machinery on the job row, and
it is the piece most likely to be subtly wrong. Specifically:

- Is the fencing actually airtight — can a paused row be written by a claimant that has lost its
  claim, or the reverse? The Postgres path does `select … for update` → decide → fenced `UPDATE` on
  `liveAttempt` in one `READ_COMMITTED` transaction.
- Are the four outcomes exhaustive and correctly discriminated in every real interleaving? Your plan
  review's finding 3 listed lapse-during-unwind, Stop racing the overrun, another sweep getting there
  first, and a changed attempt. Are they all genuinely covered, or only tested?
- **Does cancellation really win?** You warned that falling through to `interruptedEnding` would end
  a reader's deliberate Stop as `error`, because `finishIn` clears `cancelling`.
- The filesystem adapter and the Postgres adapter must agree. Do they?
- The implementer reports that weakening the row lock makes a test fail via the
  `jobs_cancelling_is_running` CHECK constraint rather than via the assertion — i.e. the schema is
  load-bearing for correctness here. Is that a latent 500 on a reader who pressed Stop?

**2. Does the resume path actually compose end to end?** Your finding 2 was that stage 2 and stage 3
would not compose because block ids get re-minted. That is claimed fixed by preserving the draft.
**Verify it rather than accept it**: after a pause, does the next claim genuinely reuse the same
draft, the same block ids, and therefore find the structure checkpoint? Is there any path — a lapse
after a pause, a `settleExpired` between windows, a deploy — that still loses the draft and silently
re-buys the structure call?

**3. The estimator, which changed shape twice.** It is now
`500 + nodes × 175` where `nodes = sections + ancestors(sections, 9)` and
`sections = max(81, headingSegments, ceil(blocks/9))`.

- The **81 floor** means every article under ~730 blocks gets an identical estimate of 16,425. Is a
  constant-for-most-articles estimator still doing the job an estimator is for, or has the failure it
  guards moved somewhere it can no longer see?
- The implementer took `max` of the two rules rather than the sum, and documents that the max is
  **not** an upper bound on the prompt-faithful answer for a heading-every-11-blocks shape (53,700
  against a faithful 87,300). Is that trade sound, and is the case pinned honestly?
- `STRUCTURE_HEADROOM = 64_000` against a measured 47,289. Combined with the floor, every article now
  gets 80,425 of room where it previously got ~42,075. I have a measurement running on whether
  thinking expands to fill that (the postmortem says it does; the Kuhn call says it did not). **If
  thinking does expand, what is the right shape of fix?**

**4. The checkpoint's key and its write barrier.** It hashes `messagesWireBody("hierarchy", params)`,
now shared with the sender. Is that genuinely the whole generation-affecting surface? The answer is
written only after `parseJson`, `buildTree`, `appendSupplement` and `assertTreeSound` succeed — is
there a poisoned-row path left? `usableStructure` parses before accepting but a parse-then-build
failure still throws, which the implementer documented as partial.

**5. `defusedFolios`.** It admits a line-initial, wholly-numeric-heading token with 1–4 leading digits
stripped. Eight real false positives clear and two real hallucinations (`12`, `13`) still fail. Is the
rule narrow enough — what else does it now admit that it should not? The implementer names one
residual hole (a line beginning `2012.` would admit `12`).

## What I am not asking

Do not redesign the job model, the pipeline step contract, or the reading view. Do not propose
raising `CHUNK_CONCURRENCY` — deliberately out of scope, and the memory ceiling that capped it has
just been removed, so it is a later decision.

## The verdict I want

- **SHIP / SHIP-WITH-CHANGES / DO-NOT-SHIP.**
- Findings ranked, each with file and line, what is wrong, what it costs, and what you would do
  instead. Mark each CONFIRMED (reproduced) or REASONED.
- This is going to production today, onto a live app with paying readers, and the change touches the
  job state machine every ingest goes through. Say plainly if anything here should not go out.
