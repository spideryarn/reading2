# Review: stage E, a long document's tree asked for in slices and stitched

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM, vitest.

## The candidate

Committed: the head commit of this branch, titled "261005a stage E: …"
(`git log -1 --format=%H`). `git diff HEAD~1..HEAD`; changed paths
`git diff --name-only HEAD~1..HEAD`.

Start with: `src/structure-slices.ts` (all of it); `src/structure.ts` § the `TooLongForOnePass`
catch in `generateStructure`, `SLICE_DEPS`, `finishStructureRun`; `src/pipeline.ts` and
`src/jobs.ts` for `stepBudgetMs`; `tests/structure-step-slices.test.ts`,
`tests/helpers/slice-model.ts`. Not the limit of scope.

## What it is meant to do

The plan is
`docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
§ "Stage E, as it will be built" and § "The review of this plan, and what changed". Your plan
review is `docs/plans/261005a-long-documents-stage-e-plan-review-sol.md`; F15 to F21 are meant to
be implemented here. The contract, each a statement to break:

1. With stage E, a document too long for one answer either gets a sound, finished,
   non-provisional tree the labels step can start on, or gets stage D's bounded headings tree. It
   never fails at structure because of length or because a slice, a refill or the root call
   failed, and never publishes a tree that mixes the two.
2. F15: a slice or refill is accepted only if its promoted sections are non-empty and exactly
   tile the blocks it was given, and the final build neither drops a promoted section nor moves a
   slice seam.
3. F16: every model call on this path has a time cap; a call is admitted only if it and what must
   follow fit before the slices' own deadline, which is ahead of the queue's; when time runs out
   the step returns D's tree before the queue's deadline. A reader's Stop (`opts.signal`) is a
   cancellation, not D's tree.
4. F17: on any failure, no new call is admitted, every started call is awaited, every good answer
   is checkpointed, and `StructureRun`'s call and token counts include every call made (re-asks,
   refills, the root, refused and truncated calls) on both the success and the fallback path.
5. F18: slices, refills and the root are each checkpointed under their own canonical request; an
   unchanged second run makes zero model calls; a stored answer that fails acceptance is a miss
   and is replaced.
6. An ordinary article's request and path are byte-identical to before this commit.
7. F21: `structure-slices.ts` imports no values from `structure.ts`.

The implementer's own account of what is weak:
- The integration tests were written after the wiring, so they were not seen red; five mutations
  of the finished code each turned a test red.
- F16 is tested through `generateStructure` with an injected clock, not through the queue. The
  one line in `src/jobs.ts` passing `STEP_BUDGET_MS[step.name]` is untested.
- The `tree-unsound` and `labels-could-not-ask` fallbacks are forced through a test switch.
- There is no step-level `AbortController`: each call has its own, aborted by its cap timer or by
  `opts.signal`, on the argument that admission already bounds every call.
- Slices, refills and the root share the `structure-whole-document` checkpoint namespace (a new
  namespace needs a migration).
- Refills are not re-asked, and a refill replaces its section only if it returns two or more.

## What you can and cannot run, and what you may change

You may edit this worktree. Fix what is inside this stage, each finding red-first with the test
that reproduces it, and leave everything wider as a finding for me to decide. Do not commit. List
every file you changed. In anything you write, do not attribute words to Greg and add no dated
quotations. Write your report to the `--output` file only; use code spans, not links, for file
paths. You can run one test file at a time (`npx vitest run tests/<one>.test.ts`) and a script
(`node --import tsx <script>`). No network: no model call, no Postgres. Raw output I have: the
implementer ran 32 test files (762 tests) green including `tests/structure-step-slices.test.ts`,
`tests/structure-step-slices-request.test.ts`, `tests/stated-limits.test.ts`,
`tests/structure-step-*.test.ts`, `tests/jobs-lease-budget.test.ts`; `npm run typecheck` and
`npm run cycles` are green at this commit. The full suite has not been run on it. A paid run of a
real 250-page book through the queue follows your review.

## Attack it

Independently, before you read my questions below. Drive `runSlices` and `generateStructure` with
adversarial fake models and clocks: answers whose sections overlap, leave gaps, start outside the
slice, start one block after a heading; a slice that is a single block; refills that return one
section, zero, or the same giant section; a root answer with an empty gist or a non-question; a
call that resolves after its cap; a call that rejects after a peer already failed; `opts.signal`
aborting before, during and after the slices; checkpoint reads that throw; a checkpoint row for a
slice whose blocks have since changed.

For each finding: an ID from F22 up, a severity (P0 data loss/security/incorrect charging/broadly
unusable; P1 user-visible wrong behaviour or a contract violated; P2 design or maintainability
risk; P3 prose), established or reasoned, (a) the input or mutation I can run, (b) the fix you
made, or for a wider finding the smallest change that closes it. Verdict: ship, ship with the
fixes made, or do not ship. Refuse only on an established P0 or P1 you could not fix.

## My own suspicions — read last

- Timers and unhandled rejections: a cap timer left armed after its call settles, or a rejected
  promise nobody awaits once the pool has decided to fail.
- `wholeDocumentResumed: calls === 0 && resumed > 0` and what the pipeline log then says for a
  partly resumed run.
- The reader's Stop while slices are in flight: does the step throw the abort the queue expects,
  or return D's tree and publish?
- The root call's failure: is one re-ask right, and is D really the right answer when every slice
  succeeded and only a 3-second call failed twice (as against a root with the article's title and
  a composed gist)? I chose D for simplicity; say if that is wrong on the merits.
- The progress lines a reader sees during this path (`onProgress`).
- The pipeline's `detail` strings for each source and failure kind are untested.
