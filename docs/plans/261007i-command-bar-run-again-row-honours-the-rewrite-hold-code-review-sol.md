No blocking findings. Two established P3 documentation findings, both fixed:

- **F1 — [plan:39](/var/tmp/spideryarn-worktrees/fix-rerun-row-hold/docs/plans/261007i-command-bar-run-again-row-honours-the-rewrite-hold.md:39):** “Built once per opening” contradicted `CommandBar`’s dependency-based memoisation. Corrected the explanation and umbrella item reference.
- **F2 — [postmortem:8](/var/tmp/spideryarn-worktrees/fix-rerun-row-hold/docs/postmortems/261007h-a-typed-entry-point-skips-the-hold-the-button-has.md:8):** The bypass window was described as seconds, but failed/offline reads and a closed mode can prolong it. Corrected.

The code meets the brief: `rewriteHeld` uses exactly `run`’s lookup, including the epoch fence. All applicable step keys match; Illustrated is explicitly excluded from the rerun list. The row checks before posting, adds no second hold mechanism, and introduces no permanent refusal state.

The flipped test asserts refusal, unchanged location, continued mode hold, and exactly one POST. It would catch a row that refuses but still posts. The reader-facing sentence accurately explains the hold.

Gates: **388 passed, 18 skipped** across both requested files. `npm run typecheck` hit a sandbox IPC restriction; the same script passed via `node --import tsx scripts/typecheck.ts`, covering all 3,384 source files.

Changed only the two documentation files above. No code changes or commit.

**Verdict: PASS — minor documentation corrections applied.**