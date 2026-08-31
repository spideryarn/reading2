# Resolve merge conflicts

> **Provenance.** Copied 2026-08-31 from
> [`docs/instructions/RESOLVE_MERGE_CONFLICTS.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/RESOLVE_MERGE_CONFLICTS.md)
> in gregdetre/gjdutils — see [gjdutils-instructions.md](gjdutils-instructions.md). Upstream says
> "Ultrathink" at this point; here, get a second opinion from another model instead when the
> conflict is complex or risky.

Not project-specific. What to do when a merge, rebase or pull leaves conflict markers behind.

## Read before you touch the file

- `git status`
- the recent, relevant git history — on **both** sides of the conflict, so you know what each side
  was trying to do
- planning docs for any of the work involved
- the conflict itself, hunk by hunk
- the relevant code and docs, starting with the planning documents

Look for a way to **preserve the best of both worlds**. A conflict is two people each solving
something; taking one side wholesale usually throws away half the answer.

Do you feel confident about how to resolve it? **Ask if you have questions.**

If it's complex or risky, get help — hand over the conflicted hunks *and* the history behind each
side, not just the file:

- **GPT Sol**, via [codex-cli-as-subagent.md](codex-cli-as-subagent.md):
  `npx tsx scripts/run-codex.ts --model gpt-5.6-sol --effort high --prompt-file … --output …`
- and perhaps **Fable** too — a subagent with `model: "fable"`.

**Make a proposal. Don't make changes yet.**

## Once the proposal is agreed

Resolve by **editing the file** — deleting the `<<<<<<<` / `=======` / `>>>>>>>` markers as you go —
then `git add` that path and commit.

Two shortcuts are worth naming so you don't reach for them by reflex. `git checkout --ours/--theirs
<file>` discards one whole side without anybody reading it, and `git merge --abort` unwinds the
merge — git's own manual warns it may be unable to reconstruct uncommitted changes that were present
when the merge started. Both belong to the throw-work-away family that
[version-control.md](../project/version-control.md) forbids in this shared tree; ask first.

Before committing, grep for leftover markers — `grep -rn '^<<<<<<< ' -- <paths>`. A stray marker is
a syntax error in code and invisible prose in markdown, and the second kind can survive for weeks.
