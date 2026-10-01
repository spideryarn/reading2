# Thinking effort vs quality — thinking-effort-261001 — illustrated

Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; this mode's raw rows are
`runs.illustrated.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes
each run read are under `corpus/<slug>/`.

Production effort, read from the code at run time: sketch `high`, ideas `high`, illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).
Arms run in a seeded shuffle per article; seed `1348051620` (order.illustrated.json), stable full-arm slot in the JSONL § orderIndex.
`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are
inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;
`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.

| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|
| illustrated | low-a | replication-crisis-spya-hrjamq | low | 3,198 | 9,767 | 36,426 | $0.1705 | $0.1705 | 90s | end_turn | Anthropic | yes | 551 | 149,817 | 3 plates in brief, 0 figures offered |
| illustrated | base-b | replication-crisis-spya-hrjamq | (none) | 20,744 | 27,350 | 36,426 | $0.3464 | $0.3464 | 251s | end_turn | Anthropic | yes | 551 | 149,817 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | replication-crisis-spya-hrjamq | low | 5,433 | 11,969 | 36,426 | $0.1925 | $0.1925 | 111s | end_turn | Anthropic | yes | 551 | 149,817 | 3 plates in brief, 0 figures offered |
| illustrated | base-a | replication-crisis-spya-hrjamq | (none) | 24,289 | 30,540 | 36,426 | $0.3783 | $0.3783 | 279s | end_turn | Anthropic | yes | 551 | 149,817 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | entropy-24-00930-spya-pywwkq | low | 2,853 | 9,057 | 25,860 | $0.1423 | $0.1423 | 83s | end_turn | Anthropic | yes | 99 | 56,536 | 3 plates in brief, 4 figures offered |
| illustrated | base-a | entropy-24-00930-spya-pywwkq | (none) | 18,953 | 25,709 | 25,860 | $0.3088 | $0.3088 | 234s | end_turn | Anthropic | yes | 99 | 56,536 | 3 plates in brief, 4 figures offered |
| illustrated | base-b | entropy-24-00930-spya-pywwkq | (none) | 24,229 | 30,341 | 25,860 | $0.3551 | $0.3551 | 271s | end_turn | Anthropic | yes | 99 | 56,536 | 3 plates in brief, 4 figures offered |
| illustrated | low-a | entropy-24-00930-spya-pywwkq | low | 25 | 5,660 | 25,860 | $0.1083 | $0.1083 | 54s | end_turn | Anthropic | yes | 99 | 56,536 | 3 plates in brief, 4 figures offered |
| illustrated | low-b | noema-mythology-of-conscious-ai | low | 4,043 | 9,992 | 23,534 | $0.1470 | $0.1470 | 89s | end_turn | Anthropic | yes | 141 | 52,573 | 3 plates in brief, 0 figures offered |
| illustrated | base-b | noema-mythology-of-conscious-ai | (none) | 15,975 | 23,283 | 23,534 | $0.2799 | $0.2799 | 213s | end_turn | Anthropic | yes | 141 | 52,573 | 3 plates in brief, 0 figures offered |
| illustrated | low-a | noema-mythology-of-conscious-ai | low | 2,478 | 7,185 | 23,534 | $0.1189 | $0.1189 | 65s | end_turn | Anthropic | yes | 141 | 52,573 | 3 plates in brief, 0 figures offered |
| illustrated | base-a | noema-mythology-of-conscious-ai | (none) | 27,917 | 33,752 | 23,534 | $0.3846 | $0.3846 | 311s | end_turn | Anthropic | yes | 141 | 52,573 | 3 plates in brief, 0 figures offered |
| illustrated | base-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | (none) | 36,674 | 44,203 | 23,710 | $0.4894 | $0.4894 | 394s | end_turn | Anthropic | yes | 244 | 46,808 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 2,658 | 10,162 | 23,710 | $0.1490 | $0.1490 | 92s | end_turn | Anthropic | yes | 244 | 46,808 | 3 plates in brief, 0 figures offered |
| illustrated | low-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 3,262 | 8,992 | 23,710 | $0.1373 | $0.1373 | 81s | end_turn | Anthropic | yes | 244 | 46,808 | 3 plates in brief, 0 figures offered |
| illustrated | base-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | (none) | 16,652 | 22,745 | 23,710 | $0.2749 | $0.2749 | 196s | end_turn | Anthropic | yes | 244 | 46,808 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 4,132 | 10,760 | 24,702 | $0.1570 | $0.1570 | 102s | end_turn | Anthropic | yes | 92 | 45,461 | 3 plates in brief, 8 figures offered |
| illustrated | base-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | (none) | 24,844 | 31,520 | 24,702 | $0.3646 | $0.3646 | 275s | end_turn | Anthropic | yes | 92 | 45,461 | 3 plates in brief, 8 figures offered |
| illustrated | base-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | (none) | 13,846 | 20,593 | 24,702 | $0.2553 | $0.2553 | 178s | end_turn | Anthropic | yes | 92 | 45,461 | 3 plates in brief, 8 figures offered |
| illustrated | low-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 21 | 6,677 | 24,702 | $0.1162 | $0.1162 | 63s | end_turn | Anthropic | yes | 92 | 45,461 | 3 plates in brief, 8 figures offered |
| illustrated | low-a | after-work-we-ll-have-each-other-spya-we6h75 | low | 3,584 | 9,107 | 18,370 | $0.1278 | $0.1278 | 86s | end_turn | Anthropic | yes | 97 | 34,272 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | after-work-we-ll-have-each-other-spya-we6h75 | low | 11 | 5,405 | 18,370 | $0.0908 | $0.0908 | 53s | end_turn | Anthropic | yes | 97 | 34,272 | 3 plates in brief, 0 figures offered |
| illustrated | base-b | after-work-we-ll-have-each-other-spya-we6h75 | (none) | 22,870 | 29,272 | 18,370 | $0.3295 | $0.3295 | 266s | end_turn | Anthropic | yes | 97 | 34,272 | 3 plates in brief, 0 figures offered |
| illustrated | base-a | after-work-we-ll-have-each-other-spya-we6h75 | (none) | ? | ? | ? | ? | $0.0000 | 0s | ? | ? | **no**: Anthropic SDK request failed, status 402. [ai-no-credit]; provider attempt is mi | 97 | 34,272 | ? plates in brief, 0 figures offered |
| illustrated | base-a | spider-silk-spya-ge30uz | (none) | ? | ? | ? | ? | $0.0000 | 0s | ? | ? | **no**: Anthropic SDK request failed, status 402. [ai-no-credit]; provider attempt is mi | 263 | 62,920 | ? plates in brief, 0 figures offered |
| illustrated | low-b | cargocult-spya-rz663q | low | ? | ? | ? | ? | $0.0000 | 0s | ? | ? | **no**: Anthropic SDK request failed, status 402. [ai-no-credit]; provider attempt is mi | 41 | 21,195 | ? plates in brief, 0 figures offered |

Total, model calls: $5.4245; plates: none drawn.

## Hierarchy

Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat evals/results/thinking-effort-261001/corpus/after-work-we-ll-have-each-other-spya-we6h75 evals/results/thinking-effort-261001/corpus/analog-cognition-and-consciousness-4-28-26-spya-f03kqf evals/results/thinking-effort-261001/corpus/cargocult-spya-rz663q evals/results/thinking-effort-261001/corpus/entropy-24-00930-spya-pywwkq evals/results/thinking-effort-261001/corpus/noema-mythology-of-conscious-ai evals/results/thinking-effort-261001/corpus/replication-crisis-spya-hrjamq evals/results/thinking-effort-261001/corpus/spider-silk-spya-ge30uz evals/results/thinking-effort-261001/corpus/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
```

Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the
block counts in the table above are the record of what it read.
