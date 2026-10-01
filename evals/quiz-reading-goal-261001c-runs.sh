#!/usr/bin/env bash
# 261001c: generate one prompt's five arms, two runs each, from the repo root. Usage: evals/quiz-reading-goal-261001c-runs.sh old|new
# "old" was run with dev's src/quiz.ts (6Q) put back in the worktree; each run records the hash.
set -u
P=$1
SLUG=entropy-24-00930-spya-pywwkq
GOAL="I want to apply this to my own recordings, so I need to know the practical problems: what makes PID hard to use on real data."
A="An electrophysiologist who records spiking activity from multi-electrode arrays in cortical slices and cultures. I already know entropy, mutual information and transfer entropy well, but I have never used PID."
B="A software engineer who writes open-source analysis libraries for neuroscientists and is about to implement PID in one. I know the mathematics of entropy and mutual information, but little neuroscience."
run() { npx tsx evals/quiz-reading-goal.ts generate "$@" $SLUG 2>&1 | grep -v '"level"'; echo "ARM_EXIT=${PIPESTATUS[0]} $2"; }
# "r2" (the second round of wording) skips the no-profile arm: its request did not change.
for i in 1 2; do
  [ "$P" != r2 ] && run --arm $P-none-$i &
  run --arm $P-aboutA-$i --about "$A" &
  run --arm $P-goal-$i --purpose "$GOAL" &
  wait
  run --arm $P-bothA-$i --about "$A" --purpose "$GOAL" &
  run --arm $P-bothB-$i --about "$B" --purpose "$GOAL" &
  wait
done
echo ALL_DONE
