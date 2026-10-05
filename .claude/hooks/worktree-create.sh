#!/bin/bash
# WorktreeCreate hook: put a new worktree's bytes on the big disk.
#
# On the box `/home` is a separate 49 GB disk and a worktree is ~1.2 GB, most of it
# `node_modules`; it filled to 100% on 2026-10-05 while `/` had 70 GB free. A worktree
# made by hand somewhere on `/` works, but `EnterWorktree({path})` then stops to ask
# about a "model-supplied worktree outside .claude/worktrees/", and no permission rule
# silences that question. A path that comes from THIS hook is not model-supplied, and
# Claude Code enters it without asking — measured 2026-10-05. So the tree is created
# at $ROOT/<name> and that real path is what is printed.
# docs/project/worktrees.md § Where a worktree's bytes live.
#
# Do not be tempted by a symlink at `.claude/worktrees/<name>`: Claude Code refuses one
# outright ("… is a symlink … could redirect the worktree outside the repository").
#
# A WorktreeCreate hook REPLACES Claude Code's own creation rather than following it, so
# everything the default did is done here: the branch (`worktree-<name>`), the base
# (`worktree.baseRef: head` — the primary's HEAD), the `.worktreeinclude` copy, and the
# lock scripts/worktree-inuse.ts reads.
#
# Where $ROOT does not exist — Greg's Mac, a box before provision.sh has run — the tree
# is made in place at `.claude/worktrees/<name>`, exactly as before this hook. A $ROOT
# that exists and cannot be written is a refusal, not a quiet return to filling /home.
#
# Contract: stdin is JSON with `name`; stdout must be the worktree's absolute path and
# NOTHING else; any non-zero exit fails the creation and shows stderr. So every command
# below sends its own stdout to stderr.
set -uo pipefail

ROOT="${SPIDERYARN_WORKTREE_ROOT:-/var/tmp/spideryarn-worktrees}"
die() { printf '.claude/hooks/worktree-create.sh: %s\n' "$1" >&2; exit 1; }

input=$(cat) || die "could not read hook input"
name=$(printf '%s' "$input" | jq -er '.name | select(type == "string" and length > 0)') || die "missing or invalid name"
# The name becomes a directory and a branch. Anything that could climb out of the
# directory, or that git would refuse as a ref, is refused before anything is made.
case "$name" in
  .* | *..* | */* | *[!A-Za-z0-9._-]*) die "refusing name '$name': letters, digits, '.', '_' and '-' only" ;;
esac
branch="worktree-$name"
git check-ref-format "refs/heads/$branch" >&2 || die "invalid branch name $branch"

# The primary checkout, asked of git rather than taken from $CLAUDE_PROJECT_DIR alone: a
# session already inside a worktree must still create its sibling beside the others.
start="${CLAUDE_PROJECT_DIR:-$PWD}"
common=$(git -C "$start" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "not in a git repository: $start"
common=$(cd -- "$common" && pwd -P) || die "could not resolve the shared git directory"
primary=$(dirname "$common")
[ -d "$primary/.git" ] || die "could not find the primary checkout from $start"
inplace="$primary/.claude/worktrees/$name"

# Where the tree is, or goes. One that already exists under this name is RESUMED, as
# Claude Code does without a hook — in the repo first, because every tree made before
# 2026-10-05 is there. A symlink is never followed: Claude Code would refuse it anyway.
[ ! -L "$inplace" ] || die "$inplace is a symlink; remove it and retry"
if [ -e "$inplace" ]; then
  real="$inplace"
elif [ -e "$ROOT" ] || [ -L "$ROOT" ]; then
  [ -d "$ROOT" ] || die "worktree root is not a directory: $ROOT"
  [ -w "$ROOT" ] || die "worktree root is not writable: $ROOT"
  ROOT=$(cd -- "$ROOT" && pwd -P) || die "could not resolve $ROOT"
  real="$ROOT/$name"
else
  real="$inplace"
fi

# The owning Claude process and the instant it started, which is what makes the lock
# safe against a recycled pid. `/proc/<pid>/stat` is "pid (comm) state ppid …" and comm
# may itself hold spaces and brackets, so everything up to the LAST ") " is cut away:
# ppid is then field 2 and the start time (field 22 of the whole line) is field 20. The
# walk is bounded, so a misread costs a lock and never a hang. No /proc (the Mac) or no
# `claude` ancestor (run by hand): no lock.
pid=$PPID
reason=""
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  case "$pid" in "" | 0 | 1 | *[!0-9]*) break ;; esac
  stat=$(cat "/proc/$pid/stat" 2>/dev/null) || break
  fields="${stat##*) }"
  if [ "$(cat "/proc/$pid/comm" 2>/dev/null)" = "claude" ]; then
    started=$(printf '%s\n' "$fields" | awk '{print $20}')
    case "$started" in "" | *[!0-9]*) ;; *) reason="claude session $name (pid $pid start $started)" ;; esac
    break
  fi
  pid=$(printf '%s\n' "$fields" | awk '{print $2}')
done

# `.worktreeinclude`, which Claude Code stops reading once this hook exists. Only plain
# root-level names are understood — all the file has ever held — and a line this cannot
# honour fails here, before anything is made, rather than leaving a tree with no
# environment. Like the default, only a file that is also gitignored is copied.
includes=()
if [ -f "$primary/.worktreeinclude" ]; then
  while IFS= read -r pattern || [ -n "$pattern" ]; do
    case "$pattern" in
      "" | \#*) continue ;;
      . | .. | */* | *[\*\?\[\!]*) die "unsupported .worktreeinclude pattern '$pattern': plain root-level names only" ;;
    esac
    [ -f "$primary/$pattern" ] || continue
    git -C "$primary" check-ignore -q -- "$pattern"
    rc=$?
    case "$rc" in 1) continue ;; 0) includes+=("$pattern") ;; *) die "could not check whether $pattern is ignored" ;; esac
  done <"$primary/.worktreeinclude"
fi

[ ! -L "$real" ] || die "$real is a symlink; remove it and retry"
if [ -e "$real" ]; then
  # Resume. Only a registered worktree root of THIS repository: git walks up from a
  # subdirectory and a `.git` file can be copied by hand, so ask for the registration.
  real=$(cd -- "$real" && pwd -P) || die "$real exists but is not a directory"
  [ -f "$real/.git" ] || die "$real is not a linked worktree root"
  theirs=$(git -C "$real" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || die "$real exists and is not a worktree"
  theirs=$(cd -- "$theirs" && pwd -P) || die "could not resolve its repository"
  [ "$theirs" = "$common" ] || die "$real belongs to another repository"
  git -C "$primary" worktree list --porcelain -z | (
    found=1
    while IFS= read -r -d '' field; do
      [ "$field" != "worktree $real" ] || found=0
    done
    exit "$found"
  ) || die "$real exists and is not a registered worktree of this repository"
  # Whatever lock it carries — a dead session's, usually — is left exactly as it is.
else
  # rev-parse tells an absent branch (1) from a failed lookup (anything else).
  git -C "$primary" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null
  rc=$?
  add=(git -C "$primary" worktree add)
  [ -z "$reason" ] || add+=(--lock --reason "$reason")
  case "$rc" in
    # The branch outlived its tree: check it out, so its commits are where the next
    # session looks, rather than fail on `-b`.
    0) "${add[@]}" -- "$real" "$branch" >&2 || die "could not check out existing branch $branch" ;;
    1) "${add[@]}" -b "$branch" -- "$real" HEAD >&2 || die "git worktree add failed" ;;
    *) die "could not look up branch $branch" ;;
  esac
  # Two sessions asking for one name at the same instant: git refuses the second add,
  # and that session's retry resumes the first one's tree. A copy that fails here (a
  # full disk, in practice) leaves a tree the next call would resume WITHOUT its
  # environment, so the message says exactly what is missing.
  for pattern in ${includes[@]+"${includes[@]}"}; do   # the long form is for bash 3.2 on the Mac, where an empty array is "unbound"
    cp -p -- "$primary/$pattern" "$real/$pattern" >&2 || die "worktree made at $real but $pattern could not be copied into it; copy it from $primary by hand before using the tree"
  done
fi

printf '%s\n' "$real"
