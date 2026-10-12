#!/bin/bash
# Runs dashboard-refresh.sh every two hours, forever (hourly until 2026-10-12). Retired in favour of
# dashboard-refresh.timer on 2026-10-10. Started with scripts/tmux-job.ts so it survives
# the Overseer session and is not OOM-killed as a backgrounded child. Kill the tmux job to stop it.
while true; do
  bash "$(cd "$(dirname "$0")" && pwd)/dashboard-refresh.sh"
  sleep 7200
done
