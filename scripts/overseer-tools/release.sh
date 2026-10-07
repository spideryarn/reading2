#!/bin/bash
# Usage: release.sh SESSION... — ends the gjd-remote wait (the pane's sleep) so Claude starts now.
for s in "$@"; do
  pp=$(tmux list-panes -t "=$s:" -F '#{pane_pid}' 2>/dev/null | head -1)
  [ -z "$pp" ] && { echo "$s: no such session"; continue; }
  sp=$(pgrep -P "$pp" -x sleep)
  if [ -n "$sp" ]; then kill "$sp" && echo "$s: released (sleep $sp)"; sleep 30  # two at once raced on the account reservation file (fb68, 2026-09-30)
  else echo "$s: not waiting"; fi
done
