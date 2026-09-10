# Narrow check: plan 260910f — do the P1 fixes close the P1s, and nothing more

Repo: /home/greg/code/spideryarn2/.claude/worktrees/ops-diagnose (linked worktree), branch
`worktree-ops-diagnose`. TypeScript + ESM, `tsx`, vitest. **This is a 20-minute check, not a
review.** Answer only the question below; do not look for new findings elsewhere.

## The candidate

Committed: the fix commits whose titles begin "260910f fix:" (`git log --oneline -12` lists them;
`git show --stat <sha>` is each one's manifest). Other agents' uncommitted work may be in the tree;
it is NOT the candidate.

## The question, per finding

For each P1 below: **is it closed, as written, by the fix commits?** Answer `closed`, `not closed`
(with the input or mutation that still shows it), or `closed, but the fix introduced <X>` — nothing
else. The findings are verbatim in the answer files beside this prompt.

| ID | Source | The P1, short |
|----|--------|---------------|
| F3 | `…plan-review-answer.md` | daemon standing pairs one global last note with the checkpoint (A checkpointed and was killed; B started and stopped before its first checkpoint → "stopped on purpose") |
| S1-F1 | `…stage1-review-answer.md` F1 | `dirty` described as whether the sha names the running code |
| S1-F2 | `…stage1-review-answer.md` F2 | sha and cleanliness read by two git processes, so they can describe different states |
| S1-F3 | `…stage1-review-answer.md` F3 | a `vite build --watch` rebuild keeps the first build's stamp |
| F40 | `…stage2-review-answer.md` | unbuildable job files hashed as an empty list → "the same list this checkout builds" |
| F41 | `…stage2-review-answer.md` | a valid legacy `cli-state.json` without `schema` reported as a mismatch |
| F42 | `…stage2-review-answer.md` | the store-file census is a fixed, incomplete allow-list |
| F43 | `…stage2-review-answer.md` | a future-dated checkpoint classified RUNNING |
| F44 | `…stage2-review-answer.md` | a boot mismatch claims the daemon has not run since the reboot |
| F45 | `…stage2-review-answer.md` | RUNNING rests on pid existence; pid reuse reads as running |

## What you can run

Findings only: the tree is read-only. /tmp and node_modules caches are writable; one test file at
a time (`npx vitest run tests/<one>.test.ts`); `node --import tsx <script>`. No network.

**Write your verdicts FIRST to
`docs/plans/260910f-operational-finish-diagnose-restart-recovery-visibility.p1-fix-check-answer-findings.md`**
if you can write; otherwise put them in your final message. Keep the whole answer under 400 words.

Do not change any file.
