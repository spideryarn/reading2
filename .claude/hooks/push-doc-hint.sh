#!/bin/bash
# PreToolUse hook on Bash: on `git push`, name the docs under docs/project/ that
# mention a file changed in the commits being pushed, where the doc itself was not
# changed. A hint, never a gate.
#
# Why: the 2026-10-07 docs sweep found about 230 statements gone false, most of them a
# removal never followed into the docs. The policy says to check the docs before you
# push; nothing prompted it. This is option B of
# docs/plans/261007a-docs-sweep-signposts-truth-and-coverage.md § 6, to be judged after a
# week by how often its list led to a doc edit — hence the log below.
#
# The opposite contract to protect-shared-tree.sh, which is why it is its own file:
# that one refuses on any doubt; this one ALWAYS exits 0 and goes quiet on any error.
# A hint that ever blocks a push costs more than every hint it ever printed. The
# registration in .claude/settings.json adds the rest: a `timeout`, after which Claude
# Code lets the call through, and `|| true` in case this file is missing.
#
# Deliberately simple: the push is spotted by a regex on the command text, and the repo
# is the session's cwd. `echo "git push"` gets a hint it did not need, and `cd elsewhere
# && git push` gets the session repo's list; both cost one line of noise, not a parser.
#
# Output: JSON `additionalContext` on stdout, the PreToolUse channel that reaches the
# model without touching the permission decision. (Stderr on exit 0 reaches nobody.)
set -uo pipefail
# Byte-wise matching: under a UTF-8 locale the doc grep below takes 1s rather than 0.1s.
export LC_ALL=C

quiet() { exit 0; }

# The matcher, proved both ways before it is trusted — a matcher that finds nothing
# would make this hook silently useless, which is the failure it exists to catch.
is_push() { printf '%s' "$1" | grep -Eq '(^|[;&|(]|[[:space:]])git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-[:space:]][^[:space:]]*)?)*[[:space:]]+push([[:space:]]|$)'; }
self_test() {
  is_push 'git push origin HEAD:dev' || return 1
  is_push 'npm test && git push' || return 1
  is_push 'git -C /x push' || return 1
  is_push 'git --no-pager -c x=y push' || return 1
  is_push 'grep -n "pushes" notes' && return 1
  is_push 'git pushx' && return 1
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test && echo "push-doc-hint: self-test ok" && exit 0
  echo "push-doc-hint: self-test FAILED" >&2; exit 1
fi
exec 2>/dev/null

payload=$(cat) || quiet
case "$payload" in *push*) ;; *) quiet ;; esac   # every Bash call passes here; stay cheap
self_test || quiet
parsed=$(printf '%s' "$payload" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(d.get("cwd") or "")
print(str((d.get("tool_input") or {}).get("command", "")).replace("\\\n", " ").replace("\n", " "))
') || quiet
cwd=$(printf '%s\n' "$parsed" | sed -n 1p)
cmd=$(printf '%s\n' "$parsed" | sed -n 2p)
is_push "$cmd" || quiet
[ -d "$cwd" ] || quiet
root=$(git -C "$cwd" rev-parse --show-toplevel) || quiet
[ -d "$root/docs/project" ] || quiet

# What is being pushed: commits on HEAD that origin/dev lacks — dev is the trunk every
# push here lands on. Merges are left out: their files arrived in someone else's commit.
# --no-renames, so a rename names the old file too: a doc naming it is now wrong.
changed=$(git -C "$root" log --no-merges --no-renames --format= --name-only origin/dev..HEAD | sort -u) || quiet
[ -n "$changed" ] || quiet
touched_docs=$(printf '%s\n' "$changed" | sed -n 's#^docs/project/\(.*\.md\)$#\1#p')
names=$(printf '%s\n' "$changed" | sed 's#.*/##' | sort -u)

# One grep: every file-name-shaped token in docs/project/, kept where it is exactly the
# basename of a changed file — so `structure.ts` does not match `post-structure.ts`.
# (An alternation of the changed names, with boundaries, was twenty times slower.)
hits=$(cd "$root/docs/project" && grep -rHoE --include='*.md' '[[:alnum:]_.-]*\.[[:alnum:]_-]+' .) || quiet

# "./doc.md:name" → "doc.md (a.ts, b.ts)", skipping docs the push already changed.
list=$(printf '%s\n' "$hits" | sort -u |
  NAMES="$names" SKIP="$touched_docs" awk -F':' '
    BEGIN { n = split(ENVIRON["NAMES"], a, "\n"); for (i = 1; i <= n; i++) want[a[i]] = 1
            n = split(ENVIRON["SKIP"], s, "\n"); for (i = 1; i <= n; i++) done[s[i]] = 1 }
    { sub(/^\.\//, "", $1) }
    ($2 in want) && !($1 in done) { m[$1] = ($1 in m) ? m[$1] ", " $2 : $2 }
    END { for (d in m) print d " (" m[d] ")" }' | sort) || quiet
[ -n "$list" ] || quiet

total=$(printf '%s\n' "$list" | wc -l | tr -d ' ')
shown=$(printf '%s\n' "$list" | sed -n '1,10p' | paste -sd';' - | sed 's/;/; /g')
[ "$total" -gt 10 ] && shown="$shown; and $((total - 10)) more"
msg="Push hint (never blocks): these docs name files you changed and were not touched: $shown. If your change made a sentence in one false, fix it; otherwise ignore this. See docs/reusable/documentation-policy.md § Keeping it true."

# A line per hint, for the review a week on: did a later commit edit any of these docs?
common=$(cd "$root" && cd "$(git rev-parse --git-common-dir)" && pwd) &&
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git -C "$root" rev-parse --short HEAD)" "$shown" \
    >> "$common/push-doc-hint.log"

json=$(MSG="$msg" python3 -c '
import json, os
print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "additionalContext": os.environ["MSG"]}}))
') || quiet
printf '%s\n' "$json"
exit 0
