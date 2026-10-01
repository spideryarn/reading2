#!/usr/bin/env bash
# Plan 261001p's Hierarchy panel: four arms on the eight full-length articles,
# as four parallel tmux jobs of two articles each (one cell is ~3 minutes, so
# serially the panel is ~1.5 hours). Each job writes its own run directory
# under evals/results/hierarchy-structure/.
#   bash evals/thinking-effort/hierarchy-panel.sh
set -eu
C=evals/results/thinking-effort-261001/corpus
ARMS=(--arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat)
launch() {
  local name="$1"; shift
  npx tsx scripts/tmux-job.ts --name "$name" npm run eval:hierarchy-structure -- "${ARMS[@]}" "$@" | head -1
}
launch te-h1 "$C/replication-crisis-spya-hrjamq" "$C/cargocult-spya-rz663q"
launch te-h2 "$C/entropy-24-00930-spya-pywwkq" "$C/after-work-we-ll-have-each-other-spya-we6h75"
launch te-h3 "$C/noema-mythology-of-conscious-ai" "$C/analog-cognition-and-consciousness-4-28-26-spya-f03kqf"
launch te-h4 "$C/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected" "$C/spider-silk-spya-ge30uz"
