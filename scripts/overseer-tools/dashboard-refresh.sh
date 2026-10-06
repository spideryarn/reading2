#!/bin/bash
# Hourly, deterministic: bring the primary up to dev, and restart the live dashboard ONLY when
# what it is built from has changed since the commit it last served. Greg, 2026-09-09: "make sure that
# the webserver gets restarted every so often (hourly? or use your judgment) ... ideally deterministic."
# The restart itself is scripts/fleet-restart.ts, which refuses over a non-empty steering queue and
# runs its own nine checks; this wrapper only decides WHETHER there is anything new to serve.
set -u
cd "$HOME/code/spideryarn2" || exit 1
STATE=$HOME/.overseer/dashboard-refresh-last-sha
LOG=$HOME/.overseer/dashboard-refresh.log
INPUTS="tools vite.fleet.config.ts package.json package-lock.json scripts/overseer.ts scripts/overseer-queue.ts"
say() { echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$LOG"; }

git fetch -q origin dev || { say "SKIP: fetch failed"; exit 0; }
behind=$(git rev-list --count HEAD..origin/dev)
if [ "$behind" != 0 ]; then
  if git merge -q --no-edit origin/dev 2>>"$LOG"; then say "merged origin/dev into the primary ($behind commit(s))"
  else say "SKIP: merge of origin/dev failed (dirty primary?) — left as is"; git merge --abort 2>/dev/null; exit 0; fi
fi
head=$(git rev-parse HEAD)
last=$(cat "$STATE" 2>/dev/null || true)
if [ -z "$last" ]; then say "no record of the last served commit; treating as changed"
elif git diff --quiet "$last" "$head" -- $INPUTS; then say "no change in build inputs since $(git rev-parse --short "$last"); nothing to restart"; exit 0
fi
if ! git diff --quiet "${last:-$head~1}" "$head" -- package-lock.json; then
  say "package-lock changed; npm install"; npm install --no-audit --no-fund >>"$LOG" 2>&1 || say "npm install failed (continuing)"
fi
say "restarting: build inputs changed between ${last:-(none)} and $head"
if npx tsx scripts/fleet-restart.ts restart >>"$LOG" 2>&1; then
  echo "$head" > "$STATE"; say "restart OK; now serving $head"
else
  say "restart refused or failed (exit $?) — see $LOG; will try again next hour"
fi
