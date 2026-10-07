#!/bin/bash
# Runs dashboard-refresh.sh once an hour, forever. Started with scripts/tmux-job.ts so it survives
# the Overseer session and is not OOM-killed as a backgrounded child. Kill the tmux job to stop it.
while true; do
  bash "$(cd "$(dirname "$0")" && pwd)/dashboard-refresh.sh"
  sleep 3600
done
