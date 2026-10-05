#!/bin/bash
# WorktreeRemove hook: the other half of worktree-create.sh. Once a WorktreeCreate hook
# exists, Claude Code leaves removal to this one — `ExitWorktree({action: "remove"})`, a
# worktree-isolated subagent finishing, a session exiting.
#
# It does not remove anything itself. It hands the tree to `npm run worktree:remove`
# (scripts/worktree-remove.ts), which stays THE way a worktree is removed here: git's
# plain remove would discard gitignored data and the tree's HEAD reflog, and that script
# is where the data, history and liveness checks live. So `discard_changes: true` no
# longer bypasses them. When the script refuses, this exits non-zero with the tree
# intact and its refusal on stderr. docs/project/worktrees.md § Removing one.
#
# Contract: stdin is JSON with `worktree_path`; exit 0 means removed; a non-zero exit is
# a failure only if the directory is still there.
set -uo pipefail

die() { printf '.claude/hooks/worktree-remove.sh: %s\n' "$1" >&2; exit 1; }

input=$(cat) || die "could not read hook input"
given=$(printf '%s' "$input" | jq -er '.worktree_path | select(type == "string" and length > 0)') || die "missing or invalid worktree_path"
case "$given" in /*) ;; *) die "worktree_path must be absolute" ;; esac
[ ! -L "$given" ] || die "$given is a symlink; leaving it alone"
[ -e "$given" ] || exit 0

# THIS repository, established independently of the path handed in: a stranger's
# common directory is never authority to delete their worktree.
start="${CLAUDE_PROJECT_DIR:-$PWD}"
common=$(git -C "$start" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "cannot locate this repository; leaving $given alone"
common=$(cd -- "$common" && pwd -P) || die "could not resolve the shared git directory"
primary=$(dirname "$common")
[ -d "$primary/.git" ] || die "could not find the primary checkout"

real=$(cd -- "$given" && pwd -P) || die "$given is not a directory; leaving it alone"
[ -f "$real/.git" ] || die "$real is not a linked worktree root; leaving it alone"
theirs=$(git -C "$real" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "$real is not a worktree"
theirs=$(cd -- "$theirs" && pwd -P) || die "could not resolve its repository"
[ "$theirs" = "$common" ] || die "$real belongs to another repository; leaving it alone"
gitdir=$(git -C "$real" rev-parse --absolute-git-dir) || die "could not read its git directory"
[ "$gitdir" != "$common" ] || die "refusing the primary checkout"
git -C "$primary" worktree list --porcelain -z | (
  found=1
  while IFS= read -r -d '' field; do
    [ "$field" != "worktree $real" ] || found=0
  done
  exit "$found"
) || die "$real is not a registered worktree of this repository"

# The Mac. `npm run worktree:remove` asks /proc whether anybody is still in the tree,
# and with no /proc it refuses every tree that exists — so handing over to it there
# would make `ExitWorktree` unable to remove anything at all. Fall back to git's own
# unforced remove, which still refuses modified or untracked files and is gentler than
# what Claude Code did before this hook. It does NOT protect gitignored files; on the
# box, where the paid eval results are, the guarded path below is the only one.
if [ ! -r /proc/self/stat ]; then
  git -C "$primary" worktree remove -- "$real" >&2 || die "git would not remove $real (modified or untracked files, or a lock); nothing was deleted"
  exit 0
fi

# The PRIMARY's code and dependencies, which survive the removal of the target; run from
# inside the target, which is how the script knows which tree is meant (a detached HEAD
# included). There is no weaker fallback.
runner="$primary/node_modules/.bin/tsx"
remover="$primary/scripts/worktree-remove.ts"
[ -x "$runner" ] && [ -f "$remover" ] || die "the guarded remover is unavailable; the tree is kept. Run \`npm run worktree:remove\` inside it when dependencies are installed."
(cd -- "$real" && "$runner" "$remover") >&2
rc=$?
# Judged by whether the directory is gone, as the contract is: branch deletion may
# decline after a successful removal, and that is not a failed removal.
[ ! -e "$real" ] || die "npm run worktree:remove left $real in place (exit $rc); read its refusal above"
exit 0
