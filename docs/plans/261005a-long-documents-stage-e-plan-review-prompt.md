# Review: the plan for stage E, a long document's tree filled in slice by slice

Repo: this worktree (`.claude/worktrees/long-documents-d-then-e`), branch
`worktree-long-documents-d-then-e`. TypeScript, ESM. Stage D is built and you reviewed it twice.

## The candidate

A plan section plus a spike, committed at the head of this branch (`git log -1 --format=%H`):

- `docs/plans/261005a-a-document-too-long-for-one-structure-answer-still-becomes-an-article.md`
  § "The E spike, and the plan it leads to" (and § "Stage E" above it, the earlier hypothesis).
- The spike: `evals/long-documents/spike-parts.ts`, `spike-followups.ts`, `spike-inspect.ts`,
  `spike-peek.ts`; results in `evals/results/long-documents-2026-10-05/` (`plan.json`, `run.json`,
  `stitched-summary.json`, `stitched-tree.json`, `followups.json`, `stitched-hinted-tree.json`,
  `stitched-refilled-tree.json`, the per-slice answers).

Start with: the plan section; `spike-parts.ts` (the planner, the stitch, the root prompt);
`run.json` and `stitched-summary.json`; `src/structure.ts` § `generateStructure`,
`wholeDocumentRequest`, `canonicalWholeDocumentRequest`, `usableWholeDocument`, `treeFrom`,
`askForWholeDocument`, the re-ask, `fromHeadings`, `finishStructureRun`;
`src/store/checkpoints.ts`; `src/jobs.ts` § `STEP_BUDGET_MS` and the claim deadline. Not the
limit of scope.

## What it is meant to do

When one structure answer will not fit, cut the body into slices, run the ordinary structure call
on each (with a two-sentence note ahead of the blocks saying it is one stretch of a longer
document), refill a sectionless oversized top-level section once, stitch every slice's top-level
sections under one root, write the root's gist with one small call, and finish through the same
`buildTree`, `assertTreeSound` and labels check as any tree. Any failure, or the deadline, returns
stage D's bounded headings tree, so a long document never fails at structure.

Statements to check for accuracy, against the code and the spike's raw results:

1. The spike's numbers in the plan are what `run.json`, `followups.json` and the summaries say.
2. A stitched proposal goes through one `buildTree` over the whole body unchanged, and the
   existing per-request checkpoint namespace can hold one row per slice safely (the key is the
   slice's own canonical request; the read validates against the slice).
3. D's tree is available as the fallback at every failure point at no extra model cost, and what
   was spent is still reported.
4. The note ahead of the blocks leaves the system prompt, and therefore the evaluated call for
   every ordinary article, untouched.
5. The comparison with the cascade is fair as now written.

Out of scope: a labels request bounded by characters; labels needing more than three job claims;
Relations; Arc's part ceiling; the client's handling of a chapter with no sections.

## What you can and cannot run, and what you may change

The tree is read-only. /tmp and the node_modules caches are writable. You can run one test file
(`npx vitest run tests/<one>.test.ts`) and a script (`node --import tsx <script>`). No network, so
no model call and no Postgres: the spike's paid results are the files above.

## Attack it

Independently, before you read my questions below. The invariant to break: **with stage E, a
document too long for one answer either gets a sound, finished tree that the labels step can
start on, or gets stage D's tree; it never fails at structure, never publishes a tree that mixes
the two, never pays twice for a slice it already has, and never overruns the step's deadline.**

For each finding: an ID from F15 up, a severity (P0 data loss/security/incorrect charging/broadly
unusable; P1 user-visible wrong behaviour or a contract violated; P2 design or maintainability
risk; P3 prose), established or reasoned, (a) the concrete scenario or the code it contradicts
(file:line), (b) the smallest change to the plan that closes it, as exact wording. A finding with
no (a) goes last. Verdict: build, build with changes, or do not build. Refuse only on an
established P0 or P1.

## My own suspicions — read last

- The deadline. Slices run eight at a time, each up to a few minutes, then refills, then the root
  call. `generateStructure` gets `deadlineAt` only on a queue run. What is the right rule for
  "not enough time left to start this call", and can a call already in flight carry the step past
  its lease? Should refills be skipped rather than the whole tree abandoned when time is short?
- The re-ask. Today a failed answer is asked for once more if the deadline admits it. With N
  slices that is up to 2N calls; is one re-ask per slice right, or one for the whole step?
- Checkpoint rows for slices share a namespace with whole-document rows. Any way a slice row is
  read as a whole-document answer, or the reverse, for a document that crosses the boundary
  between attempts (a re-extraction that shortens it)?
- The note changes what the model is told. It was tried on two slices of one book. Is there a
  cheaper wording risk I should measure before building (a paper, a headingless document)?
- The refill threshold (no sections, over 60 blocks) and whether a refilled range that comes back
  as one sectionless chapter again should be kept, windowed, or send the whole step to D.
- `wholeDocumentCalls: 0 | 1 | 2` becoming a number: who reads it?
- A stitched tree's root has 19 to 27 children on this book; a 40,000-block page would have
  hundreds. Arc refuses over 1,096 parts (your F9).

Do not change any file.
