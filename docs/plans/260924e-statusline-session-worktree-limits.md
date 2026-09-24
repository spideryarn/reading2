# The box's status line: session, worktree and usage limits, made permanent

> Make it permanent
>
> — Greg, 2026-09-24, about the status line a subagent had extended on the live box

Earlier on 2026-09-24 the live `~/.claude/statusline-script.sh` on the Hetzner box gained the session
name (tmux plus Claude's `session_name`), the worktree (`worktree.name`, with fallbacks) and the
account's usage limits (`rate_limits.five_hour` / `seven_day`), and
`~/.claude-gregmindstone/settings.json` was pointed at the same script by hand. This change makes a
rebuilt box match: the heredoc in `infra/hetzner/provision.sh` is replaced with the live script byte
for byte (checked with `diff`), provision's settings step also merges `statusLine` — and only that
key — into `~/.claude-gregmindstone/settings.json` when that directory exists, and
`tests/statusline.test.ts` gains cases for the three new segments and the second config directory,
each watched red against the old heredoc first. The simpler option passed over was to leave the
second config directory to be wired by hand after a rebuild; it is one more thing the next box would
silently lack, and the merge already existed to copy. Nothing was run against the live box.
