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
behind=$(git rev-list --count HEAD..origin/dev)
if [ "$behind" != 0 ]; then
  if git merge -q --no-edit origin/dev 2>>"$LOG"; then say "merged origin/dev into the primary ($behind commit(s))"
  else say "SKIP: merge of origin/dev failed — leaving all work and conflicts for review"; exit 1; fi
fi
head=$(git rev-parse HEAD)
last=$(cat "$STATE" 2>/dev/null || true)
if [ -z "$last" ]; then say "no record of the last served commit; treating as changed"
elif git diff --quiet "$last" "$head" -- $INPUTS; then say "no change in build inputs since $(git rev-parse --short "$last"); nothing to restart"; exit 0
fi
if ! git diff --quiet "${last:-$head~1}" "$head" -- package-lock.json; then
  say "package-lock changed; npm install"; npm install --no-audit --no-fund >>"$LOG" 2>&1 || { say "npm install failed — not restarting onto a broken node_modules"; exit 1; }
fi
say "restarting: build inputs changed between ${last:-(none)} and $head"
if npx tsx scripts/fleet-restart.ts restart >>"$LOG" 2>&1; then
  echo "$head" > "$STATE"; say "restart OK; now serving $head"
else
  rc=$?
  say "restart refused or failed (exit $rc) — see $LOG; will try again next hour"
  exit 1
fi
