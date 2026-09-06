## Verdict

**REVISE, THEN READY.** The suspected failure class is established in code and synthetic execution. Its connection to the reported production article remains inferred because production evidence was intentionally excluded.

## Findings

- **PDF-INT-001 — P0 — established:** detection does not prevent publication. `checkChunk` detects missing/unrequested pages, but fresh reads stop after two attempts regardless of success; final failures only become logs and `meta.quality`. [Retry loop](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2322), [publish branch](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2423). Introduced by `1ed4407e`, which intentionally replaced refusal with warnings after noisy maths/figure false positives.

- **PDF-INT-002 — P0 — established:** model-controlled page labels control final article order. Although concurrent results retain authoritative chunk order, `all.sort` reorders globally by `record.page`; `renderHtml` then trusts `continues` without checking page adjacency. [Sort](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2461), [join](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:1564). Both originated in `f68a6016`; they became dangerous after `1ed4407e` allowed failed page-set checks through.

- **PDF-INT-003 — P1 — established:** checkpoints are semantically checked, but defective ones bypass recovery. `usableChunkReading` validates only that `records` is an array; the cached branch subsequently calls `checkChunk`, but never retries or replaces a semantic failure. [Checkpoint validator](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:1825), [cached branch](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-read.ts:2252). Current checkpoint behavior entered through `2988bcb9`.

- **PDF-INT-004 — P1 — established:** structural and noisy content failures share one flat `failures` consequence despite structural coverage already being separately available. [Coverage](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-score.ts:755), [flattening](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/kuhn-pdf-integrity/src/pdf-score.ts:823). This is why restoring the whole old gate would resurrect known false refusals.

The original page-set detector was correct and introduced in `c4f8cc0f`. `b0bebabe` added the bounded retry. `98855d5a` added concurrency and preserved chunk-order folding, but retained the unsafe final sort.

## Required implementation contract

1. Introduce a typed verdict: `structural | content-warning | pass`. Do not classify by parsing failure strings.

2. Structural failures are exact, threshold-free:

   - Any record claims a page outside its owning chunk.
   - Any impossible page number.
   - Any independently text-bearing requested page has no records.
   - Any checkpoint record fails the complete runtime record shape.

   Hidden records count as page presence. Captionless figures, blank/no-text-layer pages, reference pages and scans must not become fatal merely for lacking rendered prose; scans remain explicitly unverified. Existing typography, maths, figure-content and partial-reference findings remain warnings.

3. Revalidate every checkpoint under current rules. A structurally bad checkpoint becomes a recoverable miss; valid neighbouring chunks remain untouched.

4. Recover only the defective chunk/pages with bounded, context-free single-page requests. Because each recovery body contains exactly one authoritative source page, assign that page server-side rather than trusting the returned label. Use at most two attempts per affected page, then throw a retryable, page-specific stage failure. Never return HTML containing an unresolved structural defect.

5. Preserve plan order and response order. Remove the global `record.page` sort; assert authoritative provenance instead.

6. Join `continues` only on the same page or exactly the next page. Never join across a gap or backwards. `mendSeamHyphens` already applies the stricter adjacent-page rule.

7. Keep the current primary prompt. Switching all responses to attachment-local page ordinals would be stronger by construction, but changes the prompt/schema and invalidates every good checkpoint. Single-page recovery provides deterministic mapping without that migration. Revisit local ordinals only if strict validation still shows recurring label failures.

8. Add red-first coverage for fresh failure, bad checkpoint replay, retained good checkpoints, scrambled labels, cross-gap `continues`, blank/figure/reference/hidden pages, and scans. The negative control must prove no `extractedHtml` is returned on exhausted structural recovery.

## Observed synthetic run

`/tmp/kuhn-sol-synthetic-repro.mts` created six invented pages planned as `[1,2] [3,4] [5,6]`.

- Fresh defective final chunk: 4 calls, 1 retry, detected missing pages 5–6, then published order `1,5,2,6,3,4`.
- Defective checkpoint: 2 calls, 0 retries, same corrupt order.
- In both runs, page 5’s `continues` record joined into page 1’s paragraph.

Validation:

```text
TMPDIR=/tmp npm test -- tests/pdf-read.test.ts tests/pdf-score.test.ts
Test Files  2 passed
Tests       92 passed
```

The first run without `TMPDIR=/tmp` was blocked by sandbox temporary-directory permissions, not a test failure. No repository files were edited; only the pre-existing draft plan remains untracked.