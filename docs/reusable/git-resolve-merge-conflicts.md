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

**Who agrees the proposal.** Greg, 2026-09-10: resolve it yourself, with GPT Sol and/or Fable where
the conflict is complex or risky, and do not put it to him *"unless there are real, major,
unresolvable conflicts that involve product tradeoffs"*. So: write the proposal down (in the merge
commit message, and in the plan if the work has one), have Sol or Fable check it when you are not
sure, then resolve. An append-append, two independent additions to one function, or a union of
imports never needs anyone else. Only a conflict where the two sides want different *product*
behaviour and neither can be kept goes to Greg — and it goes as a question he can answer, per
[AGENTS.md § Explain plainly and briefly](../../AGENTS.md). In the fleet, the Overseer settles
technical conflicts on his behalf and logs them.

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

**And run the checks for whatever the merge touched, not just the tests.** A conflict shows you the
files git could not merge; it says nothing about the files it merged silently. Two new files never
conflict — which is how a merged migration journal can leave a forked snapshot chain that every test
still passes.
