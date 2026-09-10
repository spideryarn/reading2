# Narrow check: five P1 fixes in a job-launch bookkeeping module

Repo: this worktree (`.claude/worktrees/launch-protocol`), branch `worktree-launch-protocol`.
TypeScript + ESM, vitest. An internal job scheduler's journal of the jobs it starts.

**This is a narrow check of five fixes, not a new review.** Discovery is closed. Look only at
whether each fix below closes its finding, and whether the fix itself broke something next to it.
Please do not report anything unrelated to these five.

## The fixes

Your earlier findings are in `docs/plans/260910f-launch-protocol-stage1-review-sol-findings-a.md`
(F14, F15) and `docs/plans/260910f-launch-protocol-stage1-review-sol-b.md` (F16–F19). The fixes:

- **F14, F15** — commit 807b4120 (`git show 807b4120`). F14: interior blank journal lines.
  F15: a history reset carrying artefact-directory-only occurrences.
- **F16, F17, F19** — commit 9662df2f (`git show 9662df2f -- tools/overseer tests`), which also
  holds other agreed additions you need not check. F16: the journalled artefact path is removed;
  evidence is read from the open store's `attemptDir`. F17: `release-untracked`. F19: the
  `other-boot` arm uses the identity reading's own boot ids.

For each of the five: is it closed? Point at the exact lines, or run the regression test named in
the commit. If one is still open, say what input still reproduces it.

## What you can run

The tree is read-only for you. Run `npx vitest run tests/overseer-launch-protocol.test.ts
tests/overseer-launch-store.test.ts tests/overseer-launch-admission.test.ts`. No network.

Write your verdicts to `/tmp/260910f-launch-protocol-stage1-fixcheck-sol-findings.md` as you go,
then give them as your final answer: one line per fix — closed, or open with the reproducing input.

Do not change any file in the repo.
