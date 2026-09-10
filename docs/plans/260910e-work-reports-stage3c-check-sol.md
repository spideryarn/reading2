Approved to land for both fixes.

I recorded [WR-S3C-1 and the verdict](/home/greg/code/spideryarn2/.claude/worktrees/work-reports/docs/plans/260910e-work-reports-stage3c-check-sol-findings.md). The P1 finding was fixed red-first: repeated refusals with the same event ID no longer overwrite the earlier diagnostic.

Checks passed:

- Scoped suite: 235 passed, 2 skipped
- Focused regression: passed after failing red
- Typecheck: exit 0
- Fleet build: exit 0
- Scoped lint and `git diff --check`: exit 0

The remaining `fleet-attention` failure comes from the later unrelated schedule merge; subprocess-only `mkfifo` and Git tests hit sandbox `EPERM`. No commit was made.