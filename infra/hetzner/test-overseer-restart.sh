#!/bin/bash
# Does overseer.service come back by itself after it has been unable to start for a while?
#
#   sudo bash infra/hetzner/test-overseer-restart.sh           # disk full: must recover
#   sudo bash infra/hetzner/test-overseer-restart.sh --env     # key file missing: must recover once it exists
#   sudo bash infra/hetzner/test-overseer-restart.sh --old     # disk full, settings before 2026-10-07: must give up
#
# The daemon died of ENOSPC on 2026-10-05 and stayed down 46 hours. Restart=always alone would not
# have saved it (GPT Sol, docs/plans/261006m-box-disk-hygiene-plan-review-sol.md, finding 13): ten
# failed starts inside five minutes and systemd gives up, so a disk full for an hour leaves the unit
# `failed` after the space comes back.
# docs/plans/261007j-box-followups-tmp-age-overseer-unit-png-compression.md
#
# A TRANSIENT unit (systemd-run, nothing written under /etc), run as the user the real unit runs as,
# with the restart settings read out of infra/hetzner/systemd/overseer.service rather than retyped.
# Its command writes one block to a 64 kB tmpfs and then stays up. Two ways to fail a start, because
# they fail in different places: a full tmpfs fails the command (ENOSPC), and a missing
# EnvironmentFile= fails before the command runs at all. Nothing here touches overseer.service.
#
# "Recovered" means active, the write succeeded, and the same PID ten seconds later: under
# Restart=always a command that exits is restarted, so one look at `active` proves nothing.
#
# FULL_SECONDS (default 300) is how long it is kept from starting: well past the old settings'
# ten starts, and ten of the new thirty-second retries.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
unit_file="$here/systemd/overseer.service"
full_seconds=${FULL_SECONDS:-300}
as_user=${SUDO_USER:?run with sudo from the user the unit runs as}
mode=${1:-enospc}
case "$mode" in enospc|--env|--old) ;; *) echo "unknown mode $mode"; exit 2 ;; esac

props=(-p "User=$as_user" -p "Group=$as_user")
if [ "$mode" = --old ]; then
  # The whole policy the unit had until 2026-10-07, spelled out because it is no longer in the file.
  props+=(-p StartLimitIntervalSec=300 -p StartLimitBurst=10 -p Restart=always -p RestartSec=5)
else
  while IFS= read -r line; do props+=(-p "$line"); done < <(grep -E '^(StartLimitIntervalSec|StartLimitBurst|Restart|RestartSec)=' "$unit_file")
fi

dir=$(mktemp -d /run/overseer-restart-test.XXXXXX)
unit="overseer-restart-test-$$"
env_file="$dir.env"
cleanup() {
  systemctl stop "$unit" 2>/dev/null || true
  systemctl reset-failed "$unit" 2>/dev/null || true
  umount "$dir" 2>/dev/null || true
  rmdir "$dir" 2>/dev/null || true
  rm -f "$env_file"
}
trap cleanup EXIT
mount -t tmpfs -o "size=64k,mode=0777" tmpfs "$dir"
if [ "$mode" = --env ]; then
  props+=(-p "EnvironmentFile=$env_file")   # required, and not there yet
else
  dd if=/dev/zero of="$dir/filler" bs=4k 2>/dev/null || true   # stops at ENOSPC, which is the point
fi
echo "mode $mode, settings: ${props[*]}"

# With a missing EnvironmentFile= the first start job itself fails, and systemd-run says so with a
# non-zero exit; the unit is still there and still restarting, which is what is being tested.
systemd-run --quiet --unit="$unit" "${props[@]}" /bin/sh -c "dd if=/dev/zero of='$dir/probe' bs=4k count=1 2>&1 && exec sleep infinity" \
  || [ "$mode" = --env ] || { echo "systemd-run failed"; exit 1; }
[ "$(systemctl show "$unit" -p LoadState --value)" = loaded ] || { echo "the test unit was never created"; exit 1; }

prop() { systemctl show "$unit" -p "$1" --value; }
show() { systemctl show "$unit" -p ActiveState -p SubState -p NRestarts -p Result | paste -sd' '; }
echo "kept from starting for ${full_seconds}s..."
while [ "$SECONDS" -lt "$full_seconds" ]; do sleep 30; echo "  $(date -u +%T) $(show)"; done
state_blocked=$(prop ActiveState); result_blocked=$(prop Result); restarts=$(prop NRestarts)
echo "while blocked: $(show)"

if [ "$mode" = --env ]; then : > "$env_file"; else rm -f "$dir/filler"; fi
echo "cause removed; waiting up to 6 minutes for a stable recovery (24 checks, plus 10s to confirm each active PID)"
back=no
for _ in $(seq 1 24); do
  sleep 5
  [ "$(prop ActiveState)" = active ] || continue
  pid=$(prop MainPID); sleep 10
  if [ "$(prop ActiveState)" = active ] && [ "$(prop MainPID)" = "$pid" ] && [ -s "$dir/probe" ]; then back=yes; break; fi
done
echo "after: $(show)"

if [ "$mode" = --old ]; then
  # systemd 255 leaves Result= at the last run's (exit-code) when the limit stops it; the start
  # limit itself is this journal line, measured 2026-10-07.
  limit_hit=no
  journalctl -u "$unit" -o cat --no-pager | grep -q "Start request repeated too quickly" && limit_hit=yes
  if [ "$state_blocked" = failed ] && [ "$limit_hit" = yes ] && [ "$back" = no ]; then
    echo "AS EXPECTED for the old settings: the start limit stopped it while blocked, and it stayed down after"; exit 0
  fi
  echo "UNEXPECTED for the old settings: state $state_blocked ($result_blocked), start limit hit $limit_hit, back $back"; exit 1
fi
if [ "$state_blocked" != failed ] && [ "$back" = yes ] && [ "$restarts" -ge 5 ]; then
  echo "OK ($mode): $restarts restarts while blocked, not failed at the final blocked check, and stably up once the cause was gone"; exit 0
fi
echo "FAIL ($mode): state while blocked $state_blocked ($result_blocked), restarts $restarts, back $back"
exit 1
