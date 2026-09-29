# The box's status line: one location, and the branch only when it adds something

> Change the statusline - I don't need both the worktree *and* the branch name *and* the session
> name.
>
> — Greg, 2026-09-29, relayed by the Overseer

A line read `fb4c-parallel-mode-generation [Opus 5.5 (1M context)] worktrees/parallel-mode-generation
(worktree-parallel-mode-generatio…` — the TUI cuts it at the terminal's width, so the worktree name,
the context bar and the usage meters never appeared at all. Now the line shows the session name, then
the model, then **one location**: the worktree as `⑂ name`, or outside one the directory's own name
(its basename, not the last two path segments). The git branch appears only when the location does
not already imply it: in the primary checkout, or in a worktree whose branch is neither
`worktree-<name>` nor `<name>`. When the branch is hidden, its dirty `*` moves onto the location so
that information is not lost. The context bar and the usage meters are unchanged. The script is the
heredoc in `infra/hetzner/provision.sh`, as before, and the live `~/.claude/statusline-script.sh` is
installed from it. `tests/statusline.test.ts` gains seven cases, watched red first. The simpler option
passed over was dropping the branch entirely; a worktree on someone else's branch, or the primary on
`dev`, is exactly when you want it.
