#!/usr/bin/env bash
# Plan 261001s's Hierarchy panel: toc/10 and toc/11, two draws of each, on the
# eight full-length articles. One run directory is deliberate: lineup.ts reads
# one run.json and its sibling trees, so all eight articles must stay together.
# One cell is ~3 minutes, making the serial panel roughly 1.5 hours.
#   bash evals/thinking-effort/structure-panel.sh
set -eu
C=evals/results/thinking-effort-261001/corpus
ARMS=(--arm toc10-frozen --arm incumbent --repeat 2)
npx tsx scripts/tmux-job.ts --name toc11-quality npm run eval:structure-whole-document -- "${ARMS[@]}" \
  "$C/replication-crisis-spya-hrjamq" \
  "$C/entropy-24-00930-spya-pywwkq" \
  "$C/noema-mythology-of-conscious-ai" \
  "$C/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected" \
  "$C/analog-cognition-and-consciousness-4-28-26-spya-f03kqf" \
  "$C/after-work-we-ll-have-each-other-spya-we6h75" \
  "$C/spider-silk-spya-ge30uz" \
  "$C/cargocult-spya-rz663q"
