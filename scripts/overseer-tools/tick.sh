#!/usr/bin/env bash
# Overseer tick: the CLI's screen, then the hand-kept pause state.
SCRATCH=${OVERSEER_SCRATCH:?set OVERSEER_SCRATCH to the Overseer working directory; see scripts/overseer-tools/README.md}
cd "$HOME/code/spideryarn2" || exit 1
npx tsx scripts/overseer.ts tick 2>&1
echo "== codex (live, both windows ration the fleet; two consecutive readings before acting):"
timeout 90 npx tsx scripts/overseer.ts usage 2>&1 | awk '/^Claude accounts \(registry\)/{p=1} /^Codex subscription/{p=1} p' | grep -E "7 days|resets|headroom|reading|pool|orchestrator|Claude accounts" | head -12
echo "== pause state:"
cat "$SCRATCH/pause-state.md"
echo "== box services (a stopped daemon, or a tidy that is not running, shows here):"
# The daemon stopped for 46 hours on 2026-10-05 and nothing said so. The watchdog checks its
# heartbeat every five minutes and its verdict reaches only the journal, so this is where it is read.
for u in overseer-watchdog.timer box-tidy.timer; do printf '  %-26s %s\n' "$u" "$(systemctl is-active "$u" 2>&1)"; done
# The daemon's own unit. It never stops retrying (since 2026-10-07), so one that cannot start shows as
# `activating (auto-restart)` with a climbing count rather than `failed`; inactive is right while the
# daemon still runs in tmux.
printf '  %-26s %s\n' "overseer.service" "$(systemctl show overseer.service -p ActiveState -p SubState -p NRestarts -p UnitFileState 2>&1 | paste -sd' ')"
for u in overseer-watchdog box-tidy; do
  printf '  %-26s %s, finished %s\n' "$u (last run)" "$(systemctl show "$u.service" -p Result --value 2>&1)" "$(systemctl show "$u.service" -p ExecMainExitTimestamp --value 2>&1)"
done
df -h --output=target,pcent,avail / /home | sed 's/^/  /'
echo "== dialog scan (reads-outside-working-directories or any numbered prompt):"
for s in $(npx tsx scripts/overseer.ts mine list 2>/dev/null); do tmux capture-pane -p -t "=$s:" 2>/dev/null | grep -qE "Allow reads outside|^ ❯ 1\. " && echo "  $s: DIALOG"; done; echo "  (scan done)"
echo "== API-error stalls (pane shows a stopped response and an idle prompt):"
for s in $(npx tsx scripts/overseer.ts mine list 2>/dev/null); do tmux capture-pane -p -t "=$s:" -S -30 2>/dev/null | grep -q "API Error: The response stopped arriving" && echo "  $s: API-ERROR in last 30 lines"; done; echo "  (scan done)"
