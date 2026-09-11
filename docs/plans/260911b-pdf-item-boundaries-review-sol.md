## Verdict: DO-NOT-SHIP

The corpus demonstrates a narrow improvement, but it does not establish “without weakening fidelity.” The proposed generic `0.7 + fused-only` rule has a concrete counterexample.

### Findings

- **High — the split can forgive a numeric omission the old scorer catches.** A synthetic pdf.js item sequence with `1` vertically above `2` crosses the threshold. Old source text is protected token `12`; split text is `1\n2`. Output containing only `1` changes from `invented: ["1"]` to no invented fault. This follows from `protectedOf` retaining individual split tokens ([pdf-score.ts](../../src/pdf-score.ts:346)) and those tokens feeding `invented` ([pdf-score.ts](../../src/pdf-score.ts:751)). The executable witness is now at [pdf-item-boundaries-eval.test.ts](../../tests/pdf-item-boundaries-eval.test.ts:152).

- **Medium — the original 425/435 mutation count was not strictly causal.** It checked only whether the mutated token appeared in `invented`; it did not exclude a token already present there before mutation. I added a causal guard that reports such cases as confounded ([compare.mts](../../evals/pdf/item-boundaries/compare.mts:72), [compare.mts](../../evals/pdf/item-boundaries/compare.mts:233)). I also pinned that `truncatedHeading` produces exactly the token `scorePage` reports ([test](../../tests/pdf-item-boundaries-eval.test.ts:133)). The saved 425/435 result predates this guard and needs a full local-PDF/database rerun before being quoted as an unconfounded count.

- **Medium — scoring-only contains the blast radius but is not downstream-inert.** `checkChunk` controls whether another paid attempt runs and which successful reading is checkpointed ([pdf-read.ts](../../src/pdf-read.ts:2512)). Therefore a newly accepted first response can change the selected transcript and eventual blocks compared with the old second attempt. The narrower claims remain sound: `PageText.text` can stay unchanged, the checkpoint key inputs do not change ([pdf-read.ts](../../src/pdf-read.ts:1958)), and no backfill or extraction-version bump is inherently required.

- **Medium — the corpus comparison is not the exact production scoring call.** It infers requested pages from emitted records and omits production `context` and bibliography exclusions. That is adequate for a symmetric experiment, but not enough to claim exact retry behavior for all stored chunks.

RTL, rotated-page content, alternating two-column order, and broader display maths remain unmeasured. The existing sideways and simple column fixtures do not cover them.

### Changes made

- Added and pinned the stacked-number fidelity counterexample.
- Made mutation counts exclude pre-existing identical `invented` faults.
- Reworded the classifier as a candidate rather than proven line break.
- Revised [260911b](260911b-pdf-item-boundaries-evidence.md:127) to retain the evidence but reject adoption.
- Marked [260911c](260911c-score-pdf-pages-at-the-line-breaks-pdfjs-did-not-mark.md:3) blocked until a narrower predicate rejects maths/RTL/rotation counterexamples.
- Corrected its retry, checkpoint, old-artifact, and block-ID claims.

### Verification

- Focused suite: **17/17 passed**.
- Typecheck: **all four projects passed; all 2,114 files covered**.
- Committed-corpus comparison: completed for 13 PDFs; retained the two withdrawn Kuhn URL faults and control-arm distinctions.
- Saved-results aggregation confirms the original run’s reported `228 pages / 206 readings / 0 verdict changes / 2 withdrawn faults / 425 vs 425`.
- Targeted lint: no errors; two existing complexity advisories.
- Full `npm test`: could not run because the sandbox cannot access local Postgres; I did not start or touch the database.
- Changes remain uncommitted because this sandbox exposes the worktree’s Git metadata read-only (`index.lock: Read-only file system`).

The original adoption decision does **not** follow from the numbers. The numbers show benefit on the observed corpus; the new counterexample disproves the required general non-weakening claim.