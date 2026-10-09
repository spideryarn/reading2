One P3 finding, fixed; no P1/P2 findings.

- **P3 — wording overstated the diagnostic’s coverage and future eligibility.** [deployment.md](/var/tmp/spideryarn-worktrees/deploy-reuse-notes-commit/docs/project/deployment.md:328) implied every fallback names any nearer running attempt. It names one only after selecting a settled commit. I corrected that sentence and softened the code comment’s guarantee about reuse after completion.

Answers to the review questions:

1. **The diagnosis is right.** `af37412f` was committed at 23:55Z; the parent’s run finished at 00:21Z. The replay at 00:30Z reuses `e229c575` with zero files to rerun. `changelog-pending.json` matches neither test classification. An exact-commit refusal still proceeds to partial reuse; `--ready` uses the same gate.

   A notes-only child **can** still trigger the whole suite under existing safeguards: notably the two-hour cross-commit limit, changed environment, newer settled blockers, or unreadable evidence. Those are intentional under 261008h. I found no additional notes-commit reuse bug.

2. **Selecting `25c673ca` was correct.** The final amendment to 261008h excludes running attempts from nearest-commit selection and retains settled void attempts as blockers.

3. **`refuse` changes only words.** Every refusal remains `kind: "run"`; no reuse condition or silent-success protection is weakened. `nearerGoing` correctly requires a running attempt strictly descended from `x` and ancestor-or-equal to the candidate through `related`. The regression test is meaningful: suppressing the diagnostic made it fail; restoring it passed.

4. **The deployment sentence is accurate after my correction.** Reconstructing the parent’s historical running state also produced the expected “started 48m ago” diagnostic.

Validation: requested Vitest gate **342 passed**; doc-link checks **18 passed**; typecheck passed all four projects and source coverage. The requested npm launcher hit a sandbox IPC restriction, so I ran the identical script with `node --import tsx scripts/typecheck.ts`. `git diff --check` passed.

VERDICT: ship after my fixes