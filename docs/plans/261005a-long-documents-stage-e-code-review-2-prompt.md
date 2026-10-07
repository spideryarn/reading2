# Review, second pass: stage E after the first review's fixes

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM, vitest.

## The candidate

Committed: `618ab1509` on top of `a079914e2`. `git diff a079914e2..618ab1509 -- src tests`.
Changed paths: `git diff --name-only a079914e2..618ab1509`.

Start with: `src/structure-slices.ts` § `runSlices` (the pool, `ask`, the cap timer, admission,
the refill and root stages); `tests/structure-slices-adversarial.test.ts`;
`tests/structure-slices-queue.test.ts`. Not the limit of scope.

## What it is meant to do

The first review is `docs/plans/261005a-long-documents-stage-e-code-review-sol.md`. Its contract
(that prompt, § What it is meant to do, items 1 to 7) is unchanged.

## Previous findings

| ID | Finding | Disposition | What changed |
|----|---------|-------------|--------------|
| F22 | the request counter omitted failed calls and transport retries | fixed by the reviewer | counts `call.attempts()` in `finally` |
| F23 | a root statement passed as a question | fixed by the reviewer | `acceptRoot` requires the question unchanged by the question rule |
| F24 | expiry did not invalidate a late success or stop admission at once | fixed by the reviewer | cap timer stops admission; late answers counted and checkpointed but cannot succeed |
| F25 | a cancelled run still entered the model wrapper | fixed by the reviewer | abort checks before checkpoint work and admission |
| F26 | terminal failure reached the coordinator a microtask late | fixed by the reviewer | admission stops at the failure site inside `ask` |
| F27 | a throwing progress observer abandoned the pool | fixed by the reviewer | progress exceptions logged and swallowed |
| F28 | a failed started refill still admitted the root | fixed by the reviewer; accepted, with a note in the plan that it trades a finished tree for a simpler rule | a started refill that fails is terminal |
| F29 | checkpoint I/O has no deadline of its own | not attempted; reported onward | nothing |
| F30 | a partly resumed fallback logged as wholly resumed | fixed by the reviewer | the flag also requires `sliced.ok` |

Treat those fixes as unreviewed code written by someone else, and spend the run on what changed.
Since the first pass the stage has also run on a real 250-page book through the queue: 4 slices,
5 calls, 131 seconds, a sound finished tree, labels completed.

## What you can and cannot run, and what you may change

The tree is read-only (a full test suite is running in it). /tmp is writable. You can run one
test file at a time (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). No network, no Postgres.

## Attack it

The statement to check: **after these fixes, `runSlices` never returns a successful proposal built
from an answer that arrived after its cap or after a terminal failure; never starts a call after
a terminal failure, an expiry or a cancellation; always settles every started call and clears
every timer before it returns or throws; and its call count equals the number of wire attempts
made.** Look for a path the new stop flag does not cover (the refill stage, the root stage, a
re-ask already past its admission check), an ordering in which two failures race, a timer armed
after `finally`, and a double count or a missed count in `attempts()`.

For each finding: an ID from F31 up, a severity (P0 data loss/security/incorrect charging/broadly
unusable; P1 user-visible wrong behaviour or a contract violated; P2 design or maintainability
risk; P3 prose), established or reasoned, (a) the input or mutation I can run, (b) the smallest
change that closes it, as a code block. Verdict: ship, or do not ship. Refuse only on an
established P0 or P1. Use code spans, not links, for file paths.

Do not change any file.
