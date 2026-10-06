#!/bin/bash
# The Overseer's three-hourly feedback sweep. Since 21:05Z 2026-09-10 each sweep is a
# run-claude job under the box's default Claude login (its Sentry MCP is signed in;
# the mindstone pool account has no Sentry server), not a gjd-remote session.
# The prompt is the file beside this script; each sweep's debrief goes to OVERSEER_SCRATCH.
HERE=$(cd "$(dirname "$0")" && pwd)
S=${OVERSEER_SCRATCH:?set OVERSEER_SCRATCH to the Overseer working directory; see scripts/overseer-tools/README.md}
cd "$HOME/code/spideryarn2" || exit 1
PROMPT=$HERE/prompt-feedback-sweep.md
LOG=$HOME/code/spideryarn2/logs/feedback-sweep-loop.log
unset CLAUDE_CONFIG_DIR
while true; do
  stamp=$(date -u +%H%M)
  echo "$(date -u +%FT%TZ) starting fbsweep-$stamp (run-claude, ambient login, --mcp)" >> "$LOG"
  npx tsx scripts/run-claude.ts --model opus --effort high --access write --mcp --tools Read,Grep,Glob,Bash,Edit,Write,TodoWrite,mcp__sentry__search_issues,mcp__sentry__get_sentry_resource,mcp__sentry__search_events,mcp__sentry__update_issue --allow mcp__sentry__search_issues --allow mcp__sentry__get_sentry_resource --allow mcp__sentry__search_events --allow mcp__sentry__update_issue \
    --timeout-minutes 150 --prompt-file "$PROMPT" \
    --output "$S/fbsweep-$stamp.md" --activity-log "$S/fbsweep-$stamp.activity.jsonl" >> "$LOG" 2>&1
  rc=$?
  echo "$(date -u +%FT%TZ) fbsweep-$stamp exit=$rc debrief=$S/fbsweep-$stamp.md" >> "$LOG"
  sleep 10800
done
