#!/usr/bin/env bash
# spya-m0mcqb, before-v2: the fixed harness against a clean build of a given tree.
# Run from that tree's root (m-base for the baseline, the worktree for the after),
# via scripts/tmux-job.ts. The harness is always the worktree's copy.
#   usage: m2-runall.sh <prefix> [names…]     e.g. m2-runall.sh m2 ; m2-runall.sh m2-try desktop-plain-1
set -u
S=/tmp/claude-1000/-home-greg-code-spideryarn2/2ad69e0b-306d-4c33-9b25-1e596d2ed4ca/scratchpad
HARNESS=/home/greg/code/spideryarn2/.claude/worktrees/fb-m0mcqb-ipad-scroll-paint/scripts/trace-scroll.ts
PREFIX=${1:-m2}; shift || true
ONLY="${*:-}"
SLUG=replication-crisis-spya-hrjamq
BASE="npx tsx $HARNESS --local-sign-in --email referee-test-260901@example.com --sign-in-via http://localhost:5492/ --settle 20 --rest 30"
run() { # name device query extra...
  local name=$1 device=$2 query=$3; shift 3
  if [ -n "$ONLY" ] && [[ " $ONLY " != *" $name "* ]]; then return; fi
  echo "=== $name $(date +%T) load $(cut -d' ' -f1 /proc/loadavg)"
  {
    echo "# $BASE --device $device --url http://localhost:5491/read/$SLUG$query --out $S/$PREFIX-$name $*"
    echo "# cwd $(pwd)  commit $(git rev-parse --short HEAD)  load at start $(cut -d' ' -f1-3 /proc/loadavg)"
    $BASE --device "$device" --url "http://localhost:5491/read/$SLUG$query" --out "$S/$PREFIX-$name" "$@"
  } > "$S/$PREFIX-$name.txt" 2>&1
  echo "exit $? ; $(grep -E '^HEADLINE:' "$S/$PREFIX-$name.txt" | cut -c1-400)"
}
for i in 1 2; do
  run ipad-summary-$i ipad "?mode=summary"
  run ipad-plain-$i ipad ""
  run desktop-plain-$i desktop ""
done
echo "ALL DONE $(date +%T)"
