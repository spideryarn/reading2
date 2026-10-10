#!/bin/bash
# The Overseer's three-hourly feedback sweep, as a tmux loop: feedback-sweep-once.sh, then three
# hours' sleep, for ever. A reboot ends it. feedback-sweep.timer runs the same body under systemd
# (plan 261010d) once Greg has approved that unit; then this loop is retired, never run beside it.
HERE=$(cd "$(dirname "$0")" && pwd)
: "${OVERSEER_SCRATCH:?set OVERSEER_SCRATCH to the Overseer working directory; see scripts/overseer-tools/README.md}"
while true; do
  bash "$HERE/feedback-sweep-once.sh"
  sleep 10800
done
