#!/usr/bin/env bash
# Run Illustrated article by article as soon as that article's Sketch base-a
# draw exists — Illustrated paints base-a's Sketch, and run.ts refuses without
# it. One process, so Illustrated's own rows stay single-writer.
#   bash evals/thinking-effort/illustrated-after-sketch.sh <out dir>
set -u
OUT="$1"
SLUGS=(
  replication-crisis-spya-hrjamq
  entropy-24-00930-spya-pywwkq
  noema-mythology-of-conscious-ai
  towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
  analog-cognition-and-consciousness-4-28-26-spya-f03kqf
  after-work-we-ll-have-each-other-spya-we6h75
  spider-silk-spya-ge30uz
  cargocult-spya-rz663q
)
pending=("${SLUGS[@]}")
status=0
while [ "${#pending[@]}" -gt 0 ]; do
  next=()
  ran=0
  for slug in "${pending[@]}"; do
    if [ -f "$OUT/sketch/$slug.base-a.json" ]; then
      echo "== illustrated $slug"
      npx tsx evals/thinking-effort/run.ts --mode illustrated --slug "$slug" --out "$OUT" || { echo "!! illustrated $slug failed"; status=1; }
      ran=1
    else
      next+=("$slug")
    fi
  done
  pending=("${next[@]+"${next[@]}"}")
  if [ "$ran" -eq 0 ] && [ "${#pending[@]}" -gt 0 ]; then sleep 60; fi
done
exit "$status"
