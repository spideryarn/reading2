#!/bin/bash
# SessionStart hook: if this session is running in the shared primary checkout rather than
# in a worktree, say so, once, at the moment the agent is deciding where to work.
#
# AGENTS.md § Work in a worktree, not in this checkout is the rule; this is the nudge. It
# prints and exits 0 — it never refuses anything, because Greg's own quick fixes and doc
# edits are done in the primary on purpose. Stdout from a SessionStart hook is added to
# the agent's context.
#
# In a worktree `--git-dir` is `…/.git/worktrees/<name>` and `--git-common-dir` is the
# primary's `.git`; in the primary the two are the same path. That is the same test
# scripts/worktree-setup.ts uses to refuse to run in the primary.
set -uo pipefail

git_dir=$(git rev-parse --git-dir 2>/dev/null) || exit 0
common_dir=$(git rev-parse --git-common-dir 2>/dev/null) || exit 0

if [ "$git_dir" = "$common_dir" ]; then
  cat <<'MSG'
You are in the shared primary checkout, not a worktree. Other agents' uncommitted edits are
in these files. For anything that touches code, call the EnterWorktree tool before your
first edit, then `npm run worktree:setup` inside it — AGENTS.md § Work in a worktree, not in
this checkout. A doc edit or a one-line fix may stay here.
MSG
fi
exit 0
