# Thinking effort vs quality — thinking-effort-261001 — sketch

Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; this mode's raw rows are
`runs.sketch.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes
each run read are under `corpus/<slug>/`.

Production effort, read from the code at run time: sketch `high`, ideas `high`, illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).
Arms run in a seeded shuffle per article; seed `1474970338` (order.sketch.json), stable full-arm slot in the JSONL § orderIndex.
`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are
inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;
`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.

| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|
| sketch | base-b | replication-crisis-spya-hrjamq | high | 11,295 | 16,896 | 40,635 | $0.2502 | $0.2502 | 161s | end_turn | Anthropic | **no**: the model's answer is not valid JSON: it breaks at position 12580 of 13639 chara | 551 | 149,817 | ? nodes, ? faults |
| sketch | low-b | replication-crisis-spya-hrjamq | low | 1,028 | 2,178 | 40,635 | $0.1031 | $0.1031 | 22s | end_turn | Anthropic | **no**: the model's answer is not valid JSON: 2631 characters | 551 | 149,817 | ? nodes, ? faults |
| sketch | base-a | replication-crisis-spya-hrjamq | high | 12,577 | 17,965 | 40,635 | $0.2609 | $0.2609 | 170s | end_turn | Anthropic | yes | 551 | 149,817 | 37 nodes, 0 faults |
| sketch | low-a | replication-crisis-spya-hrjamq | low | 5,081 | 9,452 | 40,635 | $0.1758 | $0.1758 | 85s | end_turn | Anthropic | yes | 551 | 149,817 | 36 nodes, 0 faults |
| sketch | low-b | entropy-24-00930-spya-pywwkq | low | 84 | 3,651 | 27,244 | $0.0910 | $0.0910 | 30s | end_turn | Anthropic | yes | 99 | 56,536 | 28 nodes, 0 faults |
| sketch | base-b | entropy-24-00930-spya-pywwkq | high | 15,993 | 22,472 | 27,244 | $0.2792 | $0.2792 | 217s | end_turn | Anthropic | yes | 99 | 56,536 | 34 nodes, 0 faults |
| sketch | base-a | entropy-24-00930-spya-pywwkq | high | 2,815 | 7,926 | 27,244 | $0.1337 | $0.1337 | 71s | end_turn | Anthropic | yes | 99 | 56,536 | 27 nodes, 0 faults |
| sketch | low-a | entropy-24-00930-spya-pywwkq | low | 79 | 4,268 | 27,244 | $0.0972 | $0.0972 | 34s | end_turn | Anthropic | yes | 99 | 56,536 | 29 nodes, 0 faults |
| sketch | low-b | noema-mythology-of-conscious-ai | low | 1,201 | 6,667 | 25,541 | $0.1178 | $0.1178 | 55s | end_turn | Anthropic | yes | 141 | 52,573 | 35 nodes, 1 faults |
| sketch | base-b | noema-mythology-of-conscious-ai | high | 14,054 | 19,443 | 25,541 | $0.2455 | $0.2455 | 185s | end_turn | Anthropic | yes | 141 | 52,573 | 33 nodes, 0 faults |
| sketch | low-a | noema-mythology-of-conscious-ai | low | 3,252 | 8,251 | 25,541 | $0.1336 | $0.1336 | 75s | end_turn | Anthropic | yes | 141 | 52,573 | 35 nodes, 0 faults |
| sketch | base-a | noema-mythology-of-conscious-ai | high | 13,053 | 17,841 | 25,541 | $0.2295 | $0.2295 | 177s | end_turn | Anthropic | yes | 141 | 52,573 | 31 nodes, 0 faults |
| sketch | low-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 524 | 4,722 | 27,166 | $0.1016 | $0.1016 | 40s | end_turn | Anthropic | yes | 244 | 46,808 | 29 nodes, 0 faults |
| sketch | base-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | high | 15,308 | 20,934 | 27,166 | $0.2637 | $0.2637 | 190s | end_turn | Anthropic | yes | 244 | 46,808 | 34 nodes, 0 faults |
| sketch | low-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 2,825 | 7,657 | 27,166 | $0.1309 | $0.1309 | 68s | end_turn | Anthropic | yes | 244 | 46,808 | 33 nodes, 0 faults |
| sketch | base-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | high | 11,939 | 17,636 | 27,166 | $0.2307 | $0.2307 | 171s | end_turn | Anthropic | yes | 244 | 46,808 | 33 nodes, 0 faults |
| sketch | low-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 387 | 4,199 | 24,437 | $0.0909 | $0.0909 | 35s | end_turn | Anthropic | yes | 92 | 45,461 | 25 nodes, 0 faults |
| sketch | low-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 305 | 4,193 | 24,437 | $0.0908 | $0.0908 | 34s | end_turn | Anthropic | yes | 92 | 45,461 | 28 nodes, 1 faults |
| sketch | base-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | high | 16,285 | 21,515 | 24,437 | $0.2640 | $0.2640 | 203s | end_turn | Anthropic | yes | 92 | 45,461 | 28 nodes, 0 faults |
| sketch | base-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | high | 8,348 | 14,747 | 24,437 | $0.1963 | $0.1963 | 141s | end_turn | Anthropic | yes | 92 | 45,461 | 32 nodes, 0 faults |
| sketch | low-b | after-work-we-ll-have-each-other-spya-we6h75 | low | 60 | 3,404 | 19,512 | $0.0731 | $0.0731 | 29s | end_turn | Anthropic | yes | 97 | 34,272 | 23 nodes, 1 faults |
| sketch | base-a | after-work-we-ll-have-each-other-spya-we6h75 | high | 12,770 | 18,189 | 19,512 | $0.2209 | $0.2209 | 179s | end_turn | Anthropic | yes | 97 | 34,272 | 29 nodes, 0 faults |
| sketch | low-a | after-work-we-ll-have-each-other-spya-we6h75 | low | 38 | 4,081 | 19,512 | $0.0798 | $0.0798 | 32s | end_turn | Anthropic | yes | 97 | 34,272 | 30 nodes, 1 faults |
| sketch | base-b | after-work-we-ll-have-each-other-spya-we6h75 | high | 13,601 | 18,664 | 19,512 | $0.2257 | $0.2257 | 176s | end_turn | Anthropic | yes | 97 | 34,272 | 33 nodes, 0 faults |
| sketch | base-b | spider-silk-spya-ge30uz | high | 10,798 | 15,173 | 22,215 | $0.1962 | $0.1962 | 143s | end_turn | Anthropic | yes | 263 | 62,920 | 26 nodes, 0 faults |
| sketch | low-b | spider-silk-spya-ge30uz | low | 167 | 3,545 | 22,215 | $0.0799 | $0.0799 | 30s | end_turn | Anthropic | yes | 263 | 62,920 | 24 nodes, 0 faults |
| sketch | low-a | spider-silk-spya-ge30uz | low | 140 | 3,550 | 22,215 | $0.0799 | $0.0799 | 33s | end_turn | Anthropic | yes | 263 | 62,920 | 31 nodes, 2 faults |
| sketch | base-a | spider-silk-spya-ge30uz | high | 16,599 | 22,539 | 22,215 | $0.2698 | $0.2698 | 220s | end_turn | Anthropic | yes | 263 | 62,920 | 33 nodes, 0 faults |
| sketch | low-b | cargocult-spya-rz663q | low | 121 | 4,471 | 14,453 | $0.0736 | $0.0736 | 33s | end_turn | Anthropic | yes | 41 | 21,195 | 30 nodes, 1 faults |
| sketch | base-a | cargocult-spya-rz663q | high | 12,172 | 17,224 | 14,453 | $0.2011 | $0.2011 | 150s | end_turn | Anthropic | yes | 41 | 21,195 | 35 nodes, 0 faults |
| sketch | low-a | cargocult-spya-rz663q | low | 150 | 4,613 | 14,453 | $0.0750 | $0.0750 | 35s | end_turn | Anthropic | yes | 41 | 21,195 | 31 nodes, 2 faults |
| sketch | base-b | cargocult-spya-rz663q | high | 20,922 | 26,654 | 14,453 | $0.2954 | $0.2954 | 266s | end_turn | Anthropic | yes | 41 | 21,195 | 31 nodes, 4 faults |

Total, model calls: $5.3568; plates: none drawn.

## Hierarchy

Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat evals/results/thinking-effort-261001/corpus/after-work-we-ll-have-each-other-spya-we6h75 evals/results/thinking-effort-261001/corpus/analog-cognition-and-consciousness-4-28-26-spya-f03kqf evals/results/thinking-effort-261001/corpus/cargocult-spya-rz663q evals/results/thinking-effort-261001/corpus/entropy-24-00930-spya-pywwkq evals/results/thinking-effort-261001/corpus/noema-mythology-of-conscious-ai evals/results/thinking-effort-261001/corpus/replication-crisis-spya-hrjamq evals/results/thinking-effort-261001/corpus/spider-silk-spya-ge30uz evals/results/thinking-effort-261001/corpus/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
```

Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the
block counts in the table above are the record of what it read.
