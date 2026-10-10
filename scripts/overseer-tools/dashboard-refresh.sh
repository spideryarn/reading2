#!/bin/bash
# Hourly, deterministic: bring the primary up to dev, and restart the live dashboard ONLY when
# what it is built from has changed since the commit it last served. Greg, 2026-09-09: "make sure that
# the webserver gets restarted every so often (hourly? or use your judgment) ... ideally deterministic."
# The restart itself is scripts/fleet-restart.ts, which refuses over a non-empty steering queue and
# runs its own nine checks; this wrapper only decides WHETHER there is anything new to serve.
#
# Run by dashboard-refresh.timer since 2026-10-10 (plan 261010d), not a tmux loop. EXIT 1 ON
# EVERY FAILURE, never a quiet 0: systemd then marks the unit failed, and box-health tells the
# Overseer (GPT Sol's plan review, finding 6). No `git merge --abort` after a failed merge,
# deliberately: the primary holds other agents' uncommitted work, and an abort can take it.
set -u
cd "$HOME/code/spideryarn2" || exit 1
mkdir -p "$HOME/.overseer" || exit 1
STATE=$HOME/.overseer/dashboard-refresh-last-sha
LOG=$HOME/.overseer/dashboard-refresh.log
INPUTS="tools vite.fleet.config.ts package.json package-lock.json scripts/overseer.ts scripts/overseer-queue.ts"
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  say "SKIP: primary has an ongoing merge; leaving it for its owner"
  exit 1
fi

# Into the explicit remote-tracking ref, as the watchdog fetches, so origin/dev is what was just fetched.
git fetch -q origin +refs/heads/dev:refs/remotes/origin/dev || { say "SKIP: fetch failed"; exit 1; }
if ! behind=$(git rev-list --count HEAD..origin/dev); then
  say "SKIP: could not compare HEAD with origin/dev"
  exit 1
fi
if [ "$behind" != 0 ]; then
  if git merge -q --no-edit origin/dev 2>>"$LOG"; then say "merged origin/dev into the primary ($behind commit(s))"
  else say "SKIP: merge of origin/dev failed — leaving all work and conflicts for review"; exit 1; fi
fi
if ! head=$(git rev-parse HEAD); then
  say "SKIP: could not read the primary's HEAD"
  exit 1
fi
last=
if [ -e "$STATE" ] && ! last=$(cat "$STATE" 2>/dev/null); then
  say "SKIP: could not read last-served state $STATE"
  exit 1
fi
base="$head~1"
if [ -z "$last" ]; then
  say "no record of the last served commit; treating as changed"
elif ! git cat-file -e "$last^{commit}" 2>/dev/null; then
  say "last-served state is not a commit ($last); treating as changed"
else
  base=$last
  git diff --quiet "$last" "$head" -- $INPUTS
  rc=$?
  if [ "$rc" -eq 0 ]; then
    short=$(git rev-parse --short "$last") || { say "SKIP: could not abbreviate last-served commit"; exit 1; }
    say "no change in build inputs since $short; nothing to restart"
    exit 0
  elif [ "$rc" -gt 1 ]; then
    say "SKIP: could not compare build inputs (git diff exit $rc)"
    exit 1
  fi
fi
git diff --quiet "$base" "$head" -- package-lock.json
lock_rc=$?
if [ "$lock_rc" -eq 1 ]; then
  say "package-lock changed; npm install"; npm install --no-audit --no-fund >>"$LOG" 2>&1 || { say "npm install failed — not restarting onto a broken node_modules"; exit 1; }
elif [ "$lock_rc" -gt 1 ]; then
  say "SKIP: could not compare package-lock.json (git diff exit $lock_rc)"
  exit 1
fi
say "restarting: build inputs changed between ${last:-(none)} and $head"
if ./node_modules/.bin/tsx scripts/fleet-restart.ts restart >>"$LOG" 2>&1; then
  tmp="$STATE.tmp.$$"
  if printf '%s\n' "$head" > "$tmp" && mv -T "$tmp" "$STATE"; then
    say "restart OK; now serving $head"
  else
    rm -f "$tmp"
    say "restart succeeded but its served-commit state could not be saved; refusing a false success"
    exit 1
  fi
else
  rc=$?
  say "restart refused or failed (exit $rc) — see $LOG; will try again next hour"
  exit 1
fi
