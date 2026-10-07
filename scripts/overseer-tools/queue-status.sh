#!/bin/bash
# Lists fb* sessions: WAITING (with its start time, soonest first) or STARTED (with the pane's last status lines).
waiting=(); started=()
for s in $(tmux ls -F '#{session_name}' | grep -E '^fb'); do
  pp=$(tmux list-panes -t "=$s:" -F '#{pane_pid}' | head -1)
  if pgrep -P "$pp" -x sleep >/dev/null; then
    until=$(tmux capture-pane -p -S -50 -t "=$s:" | grep -o 'until [A-Z][a-z][a-z] [0-9][0-9] [A-Z][a-z][a-z] [0-9:]*' | head -1 | sed 's/until //')
    waiting+=("$(date -d "$(echo $until | awk "{print \$2, \$3, 2026, \$4}")" +%s 2>/dev/null || echo 0) $s ($until)")
  else
    last=$(tmux capture-pane -p -t "=$s:" | grep -v '^\s*$' | grep -v '^[─ ]*$' | grep -v 'auto mode on' | grep -v '^❯' | tail -2 | tr '\n' ' ' | tr -s ' ' | cut -c1-150)
    started+=("$s | $last")
  fi
done
echo "STARTED (${#started[@]}):"; printf '  %s\n' "${started[@]}"
echo "WAITING (${#waiting[@]}), soonest first:"; printf '%s\n' "${waiting[@]}" | sort -n | cut -d' ' -f2- | sed 's/^/  /'
free -g | awk 'NR==2{print "mem available GB: "$7} NR==3{print "swap used GB: "$3}'; uptime | sed 's/.*load/load/'
# Disk (Greg, 2026-10-05: add hard disk to the automatic checks). /home is the 49G disk that fills.
home_free=$(df -BG --output=avail /home | tail -1 | tr -dc 0-9); root_free=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
echo "disk free GB: /home $home_free, / $root_free"
# The delete that used to live here (Codex transcripts older than a week) is box-tidy.timer now,
# hourly: infra/hetzner/box-tidy.mjs. `journalctl -u box-tidy -n 40` shows what it last did.
if [ "$home_free" -lt 5 ]; then
  echo "DISK LOW: /home has ${home_free} GB free. Gate: hold releases under 3 GB; remove finished pushed worktrees (npm run worktree:sweep); run 'sudo systemctl start box-tidy.service' now rather than waiting for the hour."
fi
