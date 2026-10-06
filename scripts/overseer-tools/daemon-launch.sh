#!/bin/sh
# Launch the Overseer daemon from the PRIMARY checkout, for as long as it runs in
# tmux rather than under overseer.service (docs/project/hetzner-remote-server-box.md,
# "What actually runs"). From the primary checkout:
#   n=$(date +%H%M); tmux new-session -d -s "overseer-daemon-$n" \
#     "sh scripts/overseer-tools/daemon-launch.sh 2>&1 | tee logs/overseer-daemon-$n.log"
# Only one daemon can run; a second refuses. The export happens in here because `tmux new-session` hands the job the tmux
# SERVER's environment, not the client's, so exporting it in the caller would
# leave the daemon with attention silently off.
set -e
cd "$HOME/code/spideryarn2"
export OPENROUTER_API_KEY="$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)"
if [ -z "$OPENROUTER_API_KEY" ]; then
  echo "REFUSING: no OPENROUTER_API_KEY in .env.local — attention would silently be off" >&2
  exit 1
fi
echo "cwd: $(pwd)  key length: ${#OPENROUTER_API_KEY} (value not printed)"
exec npx tsx scripts/overseer.ts run
