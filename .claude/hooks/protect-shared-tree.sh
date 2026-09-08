#!/bin/bash
# PreToolUse hook on Bash: refuse any command that could reach the banned `git` verb
# that throws other agents' work away.
#
# The rule it enforces is in AGENTS.md and docs/project/version-control.md — several
# agents share this working tree, their uncommitted edits have no second copy, and on
# 2026-08-30 one banned command swept up twenty modified files belonging to five
# sessions. That command was not the point of the line it appeared in; it was the first
# clause of a compound one-liner written to answer an unrelated question. So this
# matches the WHOLE command rather than its first word: `npm test; git <verb>` is the
# shape that actually happened.
#
# The test is deliberately flat and deliberately over-refuses: any command mentioning
# both `git` and the banned verb as words is refused, even a `grep` that only quotes
# them. Judging it per command is what failed last time.
#
# NOTE ON NAMING: this file and its test are named for what they protect, not for the
# verb they ban, because a path containing both words cannot appear in any Bash command
# — including the `git commit -F msg -- <path>` that would check it in. The first draft
# was named after the verb and could not be committed.
#
# Contract: stdin is the tool-call JSON; exit 2 blocks the call and shows stderr to the
# agent; exit 0 allows it. Every failure here is a refusal — see `refuse` below.
set -uo pipefail

# The banned verb, spelled once, out of the reach of a literal grep for it.
VERB="st""ash"

refuse() {
  printf 'Refused by .claude/hooks/protect-shared-tree.sh: %s\n\n' "$1" >&2
  cat >&2 <<EOF
\`git $VERB\` is banned in this repo — other agents' uncommitted work is in this tree
and there is no second copy of it. See docs/project/version-control.md § Never run a git
command that throws work away. Undo your own mistake by editing the text back; if you
genuinely need one, ask Greg.

The test is a flat word match on \`git\` AND \`$VERB\`, so a command that merely quotes
them is refused too. Either word alone is fine. Reword it, use the Read/Grep tools
instead of Bash, or ask Greg.
EOF
  exit 2
}

# Is $1 present in $2 as a whole word? A grep that ERRORS (missing binary, bad pattern)
# must not read as "not found" — that is how a guard fails open, allowing everything
# while looking like it ran. Only a clean exit 1 means the word is absent.
word_in() {
  local rc
  printf '%s' "$2" | grep -Eq "(^|[^[:alnum:]_])$1([^[:alnum:]_]|\$)"
  rc=$?
  case "$rc" in
    0) return 0 ;;
    1) return 1 ;;
    *) refuse "the matcher itself failed (grep exit $rc); not guessing" ;;
  esac
}

# Prove the matcher works before trusting it to say "safe". Both directions, because a
# matcher that finds nothing and a matcher that finds everything each pass one half.
word_in git 'a git b'   || refuse "self-test failed: matcher missed a word it must find"
word_in git 'digitally' && refuse "self-test failed: matcher hit a word it must not find"

payload=$(cat)
[ -n "$payload" ] || exit 0   # nothing to inspect

# Read the command out of the JSON. It has to be *unescaped* before matching: in a
# multi-line command the newline arrives as the two characters \n, which welds the line
# break onto the next word, so a line starting with `git` reads as `ngit` — a word
# boundary that isn't there, and a bypass. Verified: that case passed the raw match
# before this.
#
# If python3 is missing, fall back to the raw payload with the whitespace escapes turned
# back into spaces, rather than refusing every Bash call in a shared tree over a missing
# interpreter. Weaker, never weaker than nothing — and if that fails too, match the raw
# payload, which over-refuses rather than under-refuses.
text=$(printf '%s' "$payload" | python3 -c '
import json, sys
d = json.load(sys.stdin)
sys.stdout.write(str((d.get("tool_input") or {}).get("command", "")))
' 2>/dev/null)
if [ -z "$text" ]; then
  text=$(printf '%s' "$payload" | sed 's/\\[nrt]/ /g' 2>/dev/null)
  [ -n "$text" ] || text="$payload"
fi

if word_in git "$text" && word_in "$VERB" "$text"; then
  refuse "this command mentions \`git\` and \`$VERB\`"
fi

# ---------------------------------------------------------------------------
# Branch deletion by hand.
#
# Added 2026-09-09, after the Overseer removed a finished worktree with
# `git worktree remove` and `git branch -d` typed out — a sequence its own
# runbook forbids. The job that command was doing is real, so the ban is only
# fair with a sanctioned path beside it: `npm run worktree:remove` deletes the
# branch itself, on a proof that everything it ever pointed at has landed, with
# a compare-and-swap. That deletion is a `spawnSync` inside Node, not a Bash
# tool call, so this hook never sees it and needs no exemption to let it past.
#
# WHY THIS ONE IS NOT A FLAT WORD MATCH like the verb above. `branch` is not a
# rare word: `git branch --show-current` is run constantly, and matching the
# whole payload for `branch` AND a delete flag refuses ordinary compounds —
# `git branch --show-current && npm install -D pkg` was the case that killed the
# first draft. So the text is split on command separators first, and both halves
# of the pattern must land in ONE segment.
#
# It still over-refuses within a segment, deliberately: a commit message quoting
# `-d` beside the word branch is refused. Reword it, or use the Write tool.
#
# Not covered, and not chased: git aliases, `git update-ref -d refs/heads/x`,
# and any script whose text is not in the Bash call. This is a nudge at the
# point absent-mindedness happens, not a boundary.
# **The flag must START a word**, and that one detail does all the discriminating.
# A short-flag cluster is any run of letters containing d or D — `-D`, `-df`,
# `-vvvvD`, which is a real deletion an earlier three-letter bound let through. An
# unbounded run would also match `-committerdate`, so what excludes
# `git branch --sort=-committerdate` is not a length cap but the requirement that
# the `-` be preceded by whitespace or nothing: there it is preceded by `=`.
DELETE_FLAG='(^|[[:space:]])(--delete|-[[:alpha:]]*[dD][[:alpha:]]*)([^[:alnum:]_-]|$)'

# Prove the matcher before trusting it, both directions, exactly as above — a
# matcher that hits everything and one that hits nothing each pass one half.
flag_in() { printf '%s' "$1" | grep -Eq "$DELETE_FLAG"; }
flag_in 'branch -D x'                  || refuse "self-test failed: delete matcher missed -D"
flag_in 'branch --delete x'            || refuse "self-test failed: delete matcher missed --delete"
flag_in 'branch -df x'                 || refuse "self-test failed: delete matcher missed a -df cluster"
flag_in 'branch -vvvvD x'              || refuse "self-test failed: delete matcher missed a long cluster"
flag_in 'branch --sort=-committerdate' && refuse "self-test failed: delete matcher hit an ordinary --sort"
flag_in 'branch --show-current'        && refuse "self-test failed: delete matcher hit --show-current"

refuse_branch_delete() {
  printf 'Refused by .claude/hooks/protect-shared-tree.sh: %s\n\n' "$1" >&2
  cat >&2 <<'EOF'
Deleting a branch by hand is banned in this repo. Nothing here needs it:

  npm run worktree:remove -- --branch <name>

removes the worktree AND deletes its branch, but only after proving that every
commit the branch has ever pointed at — its tip and every reflog entry — is
already on origin/dev, and it deletes with a compare-and-swap so a branch that
moved under it is left alone. It also cleans up a branch whose worktree is
already gone, so there is no stuck state this ban creates.

See AGENTS.md and docs/project/worktrees.md § Removing one.

The test is per-command: the word `branch` and a -d/-D/--delete flag in the SAME
command. Either alone is fine. If you were only quoting one, reword it or use
the Read/Write tools instead of Bash.
EOF
  exit 2
}

# One command per line: `&&` first (two chars, so tr cannot see it), then the
# single-byte separators. `sed` never emits a newline here, because BSD sed on
# Greg's Mac will not take one in a replacement.
segments=$(printf '%s' "$text" | sed 's/&&/;/g' | tr ';|&' '\n\n\n')

carry=""
while IFS= read -r segment; do
    # A line ending in `\` continues into the next one. Without this,
    # `git branch \` + newline + `-D x` splits into a segment with the word and a
    # segment with the flag, and neither matches — measured, it was a bypass, and
    # the verb rule above has a test for exactly this shape.
    segment="$carry$segment"
    carry=""
    case "$segment" in
      *\\)
        carry="${segment%\\} "
        continue
        ;;
    esac

  # All three in ONE command: the tool, the noun, the flag. Requiring the tool per
  # segment rather than anywhere in the payload is what stops
  # `git status && grep -n "branch -D" notes.txt` being refused — measured, it was.
  # The cost is that `g=git; $g branch -D x` is no longer caught, which the flat
  # rule above would catch. That trade is deliberate: a false refusal on a daily
  # command is paid every day, and this is a nudge, not a boundary.
  word_in git "$segment" || continue
  word_in branch "$segment" || continue
  printf '%s' "$segment" | grep -Eq "$DELETE_FLAG"
  rc=$?
  case "$rc" in
    0) refuse_branch_delete "this looks like a hand-typed branch deletion: $segment" ;;
    1) ;;
    *) refuse "the branch-deletion matcher itself failed (grep exit $rc); not guessing" ;;
  esac
done <<EOF
$segments
EOF

exit 0
