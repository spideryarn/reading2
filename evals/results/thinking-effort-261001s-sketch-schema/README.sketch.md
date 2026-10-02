# Thinking effort vs quality — thinking-effort-261001s-sketch-schema — sketch

Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; this mode's raw rows are
`runs.sketch.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes
each run read are under `corpus/<slug>/`.

Production effort, read from the code at run time: sketch `low`, ideas `high`, illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).
Arms run in a seeded shuffle per article; seed `408101544` (order.sketch.json), stable full-arm slot in the JSONL § orderIndex.
`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are
inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;
`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.

| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|
| sketch | base-b | replication-crisis-spya-hrjamq | low | 379 | 4,005 | 42,919 | $0.1259 | $0.1259 | 40s | end_turn | Anthropic | yes | 551 | 149,817 | 26 nodes, 2 faults |
| sketch | base-a | replication-crisis-spya-hrjamq | low | 135 | 3,857 | 42,919 | $0.1244 | $0.1244 | 32s | end_turn | Anthropic | yes | 551 | 149,817 | 26 nodes, 0 faults |
| sketch | no-schema-b | replication-crisis-spya-hrjamq | low | 3,482 | 7,472 | 40,635 | $0.1560 | $0.1560 | 65s | end_turn | Anthropic | yes | 551 | 149,817 | 32 nodes, 0 faults |
| sketch | no-schema-a | replication-crisis-spya-hrjamq | low | 100 | 4,258 | 40,635 | $0.1239 | $0.1239 | 34s | end_turn | Anthropic | yes | 551 | 149,817 | 31 nodes, 3 faults |
| sketch | base-a | entropy-24-00930-spya-pywwkq | low | 150 | 4,592 | 29,528 | $0.1050 | $0.1050 | 38s | end_turn | Anthropic | yes | 99 | 56,536 | 31 nodes, 1 faults |
| sketch | no-schema-b | entropy-24-00930-spya-pywwkq | low | 0 | 4,751 | 27,244 | $0.1020 | $0.1020 | 37s | end_turn | Anthropic | yes | 99 | 56,536 | 33 nodes, 0 faults |
| sketch | no-schema-a | entropy-24-00930-spya-pywwkq | low | 129 | 3,915 | 27,244 | $0.0936 | $0.0936 | 32s | end_turn | Anthropic | yes | 99 | 56,536 | 27 nodes, 1 faults |
| sketch | base-b | entropy-24-00930-spya-pywwkq | low | 119 | 3,935 | 29,528 | $0.0984 | $0.0984 | 33s | end_turn | Anthropic | yes | 99 | 56,536 | 26 nodes, 0 faults |
| sketch | base-a | noema-mythology-of-conscious-ai | low | 127 | 4,794 | 27,825 | $0.1036 | $0.1036 | 38s | end_turn | Anthropic | yes | 141 | 52,573 | 29 nodes, 1 faults |
| sketch | no-schema-b | noema-mythology-of-conscious-ai | low | 133 | 4,871 | 25,541 | $0.0998 | $0.0998 | 38s | end_turn | Anthropic | yes | 141 | 52,573 | 35 nodes, 1 faults |
| sketch | base-b | noema-mythology-of-conscious-ai | low | 141 | 4,464 | 27,825 | $0.1003 | $0.1003 | 36s | end_turn | Anthropic | yes | 141 | 52,573 | 28 nodes, 0 faults |
| sketch | no-schema-a | noema-mythology-of-conscious-ai | low | 133 | 5,150 | 25,541 | $0.1026 | $0.1026 | 41s | end_turn | Anthropic | yes | 141 | 52,573 | 32 nodes, 2 faults |
| sketch | base-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 134 | 4,337 | 29,450 | $0.1023 | $0.1023 | 37s | end_turn | Anthropic | yes | 244 | 46,808 | 29 nodes, 1 faults |
| sketch | base-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 1,548 | 5,945 | 29,450 | $0.1183 | $0.1183 | 53s | end_turn | Anthropic | yes | 244 | 46,808 | 30 nodes, 0 faults |
| sketch | no-schema-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 217 | 4,399 | 27,166 | $0.0983 | $0.0983 | 35s | end_turn | Anthropic | yes | 244 | 46,808 | 28 nodes, 1 faults |
| sketch | no-schema-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 206 | 4,354 | 27,166 | $0.0979 | $0.0979 | 47s | end_turn | Anthropic | **no**: Invalid array length | 244 | 46,808 | ? nodes, ? faults |
| sketch | base-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 531 | 4,887 | 26,721 | $0.1023 | $0.1023 | 42s | end_turn | Anthropic | yes | 92 | 45,461 | 29 nodes, 0 faults |
| sketch | no-schema-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 1,869 | 5,760 | 24,437 | $0.1065 | $0.1065 | 50s | end_turn | Anthropic | yes | 92 | 45,461 | 23 nodes, 0 faults |
| sketch | base-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 916 | 5,608 | 26,721 | $0.1095 | $0.1095 | 47s | end_turn | Anthropic | yes | 92 | 45,461 | 29 nodes, 1 faults |
| sketch | no-schema-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 968 | 4,997 | 24,437 | $0.0988 | $0.0988 | 45s | end_turn | Anthropic | yes | 92 | 45,461 | 21 nodes, 1 faults |
| sketch | base-a | after-work-we-ll-have-each-other-spya-we6h75 | low | 129 | 4,841 | 21,796 | $0.0920 | $0.0920 | 48s | end_turn | Anthropic | yes | 97 | 34,272 | 34 nodes, 0 faults |
| sketch | no-schema-a | after-work-we-ll-have-each-other-spya-we6h75 | low | 52 | 4,262 | 19,512 | $0.0816 | $0.0816 | 33s | end_turn | Anthropic | yes | 97 | 34,272 | 32 nodes, 1 faults |
| sketch | base-b | after-work-we-ll-have-each-other-spya-we6h75 | low | 70 | 3,928 | 21,796 | $0.0829 | $0.0829 | 32s | end_turn | Anthropic | yes | 97 | 34,272 | 25 nodes, 0 faults |
| sketch | no-schema-b | after-work-we-ll-have-each-other-spya-we6h75 | low | 53 | 3,020 | 19,512 | $0.0692 | $0.0692 | 24s | end_turn | Anthropic | yes | 97 | 34,272 | 22 nodes, 0 faults |
| sketch | no-schema-a | spider-silk-spya-ge30uz | low | 67 | 1,373 | 22,215 | $0.0582 | $0.0582 | 14s | end_turn | Anthropic | **no**: the model's answer is not valid JSON: it breaks at position 2592 of 2769 charact | 263 | 62,920 | ? nodes, ? faults |
| sketch | base-b | spider-silk-spya-ge30uz | low | 71 | 3,452 | 24,499 | $0.0835 | $0.0835 | 29s | end_turn | Anthropic | yes | 263 | 62,920 | 24 nodes, 2 faults |
| sketch | base-a | spider-silk-spya-ge30uz | low | 92 | 3,528 | 24,499 | $0.0843 | $0.0843 | 30s | end_turn | Anthropic | yes | 263 | 62,920 | 23 nodes, 0 faults |
| sketch | no-schema-b | spider-silk-spya-ge30uz | low | 78 | 3,964 | 22,215 | $0.0841 | $0.0841 | 34s | end_turn | Anthropic | yes | 263 | 62,920 | 27 nodes, 1 faults |
| sketch | base-a | cargocult-spya-rz663q | low | 0 | 5,681 | 16,737 | $0.0903 | $0.0903 | 44s | end_turn | Anthropic | yes | 41 | 21,195 | 39 nodes, 0 faults |
| sketch | no-schema-a | cargocult-spya-rz663q | low | 170 | 4,616 | 14,453 | $0.0751 | $0.0751 | 34s | end_turn | Anthropic | yes | 41 | 21,195 | 31 nodes, 1 faults |
| sketch | base-b | cargocult-spya-rz663q | low | 136 | 5,048 | 16,737 | $0.0840 | $0.0840 | 39s | end_turn | Anthropic | yes | 41 | 21,195 | 32 nodes, 1 faults |
| sketch | no-schema-b | cargocult-spya-rz663q | low | 131 | 4,481 | 14,453 | $0.0737 | $0.0737 | 43s | end_turn | Anthropic | yes | 41 | 21,195 | 30 nodes, 2 faults |

Total, model calls: $3.1282; plates: none drawn.

## Hierarchy

Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat evals/results/thinking-effort-261001s-sketch-schema/corpus/after-work-we-ll-have-each-other-spya-we6h75 evals/results/thinking-effort-261001s-sketch-schema/corpus/analog-cognition-and-consciousness-4-28-26-spya-f03kqf evals/results/thinking-effort-261001s-sketch-schema/corpus/cargocult-spya-rz663q evals/results/thinking-effort-261001s-sketch-schema/corpus/entropy-24-00930-spya-pywwkq evals/results/thinking-effort-261001s-sketch-schema/corpus/noema-mythology-of-conscious-ai evals/results/thinking-effort-261001s-sketch-schema/corpus/replication-crisis-spya-hrjamq evals/results/thinking-effort-261001s-sketch-schema/corpus/spider-silk-spya-ge30uz evals/results/thinking-effort-261001s-sketch-schema/corpus/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
```

Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the
block counts in the table above are the record of what it read.
