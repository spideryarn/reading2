## Findings

- **S1-1 — P1, established:** short-plural folding merged unrelated real words whenever both keys existed, e.g. `bus → bu`, `gas → ga`, `its → it`, `yes → ye`, `ups → up`. The regression failed red with only the singular keys surviving. Changed [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-2/src/shelf-terms/choose.ts:218) to require matching acronym surface forms such as `AI`/`AIs`. Added coverage at [shelf-terms-choose.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-2/tests/shelf-terms-choose.test.ts:331).

- **S1-2 — P1, established:** shared-word Jaccard could reject a later superset before `admit` could replace its chosen subset. A 4-article `ai system` prevented an 11-article `ai`. Changed [choose.ts](/home/greg/code/spideryarn2/.claude/worktrees/shelf-topics-2/src/shelf-terms/choose.ts:328) so a genuinely larger containing candidate reaches `admit`. The regression verifies rank placement, deterministic output under reversed input, all 11 physical members, and literal counts.

No further correctness findings: membership/article lists remain internally consistent; `minCoverageWords` affects gain but not membership; the UI preserves server rank, keeps selected topics beyond the first 12 visible, and does not drop chosen zero-count chips. Stage 2 files were not edited.

## Test tail

```text
Test Files  3 passed (3)
Tests       85 passed (85)
Duration    13.25s
```

Relevant TypeScript projects and scoped lint also pass. The full `npm run typecheck` wrapper could not start because `tsx` was denied its `/tmp` IPC socket (`EPERM`); direct `tsc` checks passed. No commit made.

**Verdict: two reader-visible P1 errors fixed narrowly; Stage 1 is green on the requested suite.**