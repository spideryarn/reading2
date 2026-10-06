#!/bin/bash
# Writes the brief for a feedback-report session out of $OVERSEER_SCRATCH/reports.txt.
# usage: mkfb.sh NAME "focus line" id1 id2 ...
SP=${OVERSEER_SCRATCH:?set OVERSEER_SCRATCH to the Overseer working directory; see scripts/overseer-tools/README.md}
name=$1; focus=$2; shift 2
out=$SP/brief-$name.md
{
echo "Overseer, relaying Greg's own reports, so please act on them. Greg filed them from the Feedback button; each one's date and address are on its first line. Their words follow verbatim."
echo
echo "$focus"
for id in "$@"; do
  echo
  awk -v id="$id" '$0=="######## "id{p=1;next} /^######## /{p=0} p' $SP/reports.txt
done
cat <<'B'

How to work:
- Read docs/project/feedback-reports.md first, and follow it for the note and the three endings.
- Run git log on the area before building. A sibling session may already have fixed part of this.
- Work in a worktree, per docs/reusable/engineering-manager.md: a short plan reviewed by GPT Sol, a Sol code review, tests seen red first for any bug, npm test and typecheck.
- Prefer the simplest version that gets most of the value; Greg asked for that explicitly.
- For UI changes, get a browser check from a Sonnet subagent. Read docs/project/browser-control.md first, and check iPad and phone widths as well as desktop.
- Where a report asks for discussion, or a choice would add real complexity, build what is clearly wanted. Put the open choice in your debrief as a [Q-...] question with options explained plainly and a recommendation. Don't wait for an answer.
- Push to dev, write the feedback note(s), remove the worktree after worktree:check, and message the Overseer a short debrief.
- NEVER run npm run deploy; only the Overseer deploys.
B
} > $out
echo $out
