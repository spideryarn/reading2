# Review prompt — a long PDF finishes without a retry click

You are reviewing a **plan, before it is built**. The repo is Spideryarn (`reading2`), an
AI-assisted reading app. You are in a git worktree on branch `worktree-long-pdf-no-retry`; the tree
is read-only to you, but you **can and should** run a single test file or a small script to check a
claim:

```
npx vitest run tests/<one>.test.ts
node --import tsx <script.ts>
```

`npm test` and `npm run typecheck` are blocked by the sandbox — do not try them. A finding you
reproduced outranks one you reasoned to, so please reproduce at least one thing.

## The plan

`docs/plans/260904b-a-long-pdf-finishes-without-a-retry-click.md`. Read it first, then the code it
cites. Its predecessor, which landed this morning and is the necessary background, is
`docs/plans/260903k-pdf-page-cap-refused-with-no-reason-given.md` — you reviewed that one and
returned DO-NOT-SHIP on its stages 4 and 5; the repairs are recorded at its end.

## The situation in one paragraph

Greg uploads a 142-page journal PDF to production. Until this morning it was refused for exceeding a
100-page cap. That cap is now 250 and deployed, and the document now transcribes fine (69 chunks,
$0.66, ~5.5 min, ~2,024 blocks, request returning in 347 s against a 740 s deadline). It now fails at
the next step, `hierarchy`, with `TooLongForOnePass` — a `blocked` failure with no Retry button.

## What I most want you to attack

**1. The central claim, which the whole plan turns on.** The plan asserts that
`estimateHierarchyTokens` (`src/hierarchy.ts`) is wrong in its *divisor* rather than its per-node
constant: it charges one internal node per four blocks, while the structure prompt in the same file
pins the tree to three levels with 5–9 children per node and forbids leaf nodes — which bounds the
internal node count at roughly 91 regardless of article length. If that is right, the answer is
bounded rather than linear in blocks and the ~1,976-block ceiling is an artefact.

Is it right? Read the `SYSTEM` prompt in `src/hierarchy.ts`, `estimateHierarchyTokens`, `budgetFor`
and `MODEL_MAX_TOKENS`/`THINKING_HEADROOM` in `src/token-budget.ts`, and
`tests/token-budget.test.ts`. Specifically:

- Does the prompt actually bound the node count, or does "propose your own boundaries inside runs
  longer than ~9 blocks" reintroduce a term linear in blocks through the back door? Work the
  arithmetic for a 2,024-block article under the prompt's own rules and show it.
- Is the model *obliged* to obey the depth cap, and what happens to the estimate's safety if it does
  not? A bound that holds only while the model behaves is not a bound.
- The plan keeps `175` and `THINKING_HEADROOM = 40_000` fixed and changes only the count. Is that the
  right half to change?

**2. Where the plan is most likely to be wrong in a way that costs a stage.** The predecessor plan's
stage-5 review found a synchronised retry herd and an unabortable page counter — the class of thing
I want here. In particular:

- **Stage 4** turns a mid-step deadline overrun into `settleExpired`'s requeue transition rather than
  the `releaseStepIn` path. `settleExpired` **nulls `draft_revision_id`** and `releaseStepIn` does
  not; the plan argues the requeue is nonetheless right because it carries the `REQUEUE_BUDGET` cap
  and the expensive work is checkpointed, whereas the release path has no cap and every release today
  is preceded by a completed step (so progress is structurally guaranteed and would stop being).
  Check that reasoning against `src/store/pg-jobs.ts` and `src/jobs.ts`. Is the budget shared with the
  lapsed-lease path in a way that makes three windows fewer than it sounds? Is the transition safe to
  take while the claimant still holds the attempt token — what is the fencing?
- **Stage 3** proposes checkpointing the structure answer on a fingerprint of the request bytes. What
  invalidation does that miss? `src/pdf-read.ts` § `promptFingerprint` exists because a
  version-constant that has to be remembered is a check that shares its author's blind spot — does
  the proposed fingerprint have the same hole?
- Is the stage order right, and does each stage leave the tree deployable?

**3. The thing I have probably underweighted.** Measured locally on the real document: extract made
**90 model calls for 69 chunks** — a 30% first-attempt check-failure rate. Most look like false
positives from `src/pdf-score.ts` on this paper's deep authored section numbering (it reports *"1
number(s) or address(es) in the output are on none of these pages — 9.5.10"*), but one chunk came
back with zero recall and records claiming pages it was not asked for. `ATTEMPTS = 2` and nothing is
written unless every chunk passes. Read `src/pdf-score.ts` and tell me whether the number/address
check has a false-positive class on hierarchically-numbered documents, and whether the plan is wrong
to treat this as a footnote rather than a stage.

## What I am not asking

Do not redesign the reading view, the job model, or the pipeline's step contract. Do not propose
splitting `extract` into multiple steps or raising `CHUNK_CONCURRENCY` — both are considered and
rejected in the plan's last section, with reasons; tell me if a reason is wrong, but do not relitigate
the conclusion without one.

## The verdict I want

- **SHIP / SHIP-WITH-CHANGES / DO-NOT-SHIP**, and say which.
- Findings ranked, each with: the file and line, what is wrong, what it costs, and what you would do
  instead. Mark each one CONFIRMED (you reproduced it) or REASONED.
- Say plainly if the central claim in §1 is wrong, because everything after stage 1 depends on it and
  I would rather lose the plan than build on it.
