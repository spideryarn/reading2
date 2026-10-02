# Thinking effort vs quality — thinking-effort-261001s-ideas-schema — ideas

Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; this mode's raw rows are
`runs.ideas.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes
each run read are under `corpus/<slug>/`.

Production effort, read from the code at run time: sketch `low`, ideas `high`, illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).
Arms run in a seeded shuffle per article; seed `852398691` (order.ideas.json), stable full-arm slot in the JSONL § orderIndex.
`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are
inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;
`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.

| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|
| ideas | medium-b | replication-crisis-spya-hrjamq | medium | 5,294 | 9,299 | 34,861 | $0.1627 | $0.1627 | 100s | end_turn | Anthropic | yes | 551 | 149,817 | 9 ideas |
| ideas | low-a | replication-crisis-spya-hrjamq | low | 12 | 3,093 | 34,861 | $0.1007 | $0.1007 | 30s | end_turn | Anthropic | yes | 551 | 149,817 | 9 ideas |
| ideas | base-b | replication-crisis-spya-hrjamq | high | 16,027 | 20,615 | 34,861 | $0.2759 | $0.2759 | 193s | end_turn | Anthropic | yes | 551 | 149,817 | 10 ideas |
| ideas | base-a | replication-crisis-spya-hrjamq | high | 10,368 | 15,428 | 34,861 | $0.2240 | $0.2240 | 159s | end_turn | Anthropic | yes | 551 | 149,817 | 9 ideas |
| ideas | medium-a | replication-crisis-spya-hrjamq | medium | 2,727 | 6,425 | 34,861 | $0.1340 | $0.1340 | 66s | end_turn | Anthropic | yes | 551 | 149,817 | 9 ideas |
| ideas | low-b | replication-crisis-spya-hrjamq | low | 16 | 3,942 | 34,861 | $0.1091 | $0.1091 | 39s | end_turn | Anthropic | yes | 551 | 149,817 | 10 ideas |
| ideas | low-a | entropy-24-00930-spya-pywwkq | low | 11 | 3,660 | 22,870 | $0.0823 | $0.0823 | 32s | end_turn | Anthropic | yes | 99 | 56,536 | 10 ideas |
| ideas | medium-b | entropy-24-00930-spya-pywwkq | medium | 2,083 | 5,609 | 22,870 | $0.1018 | $0.1018 | 54s | end_turn | Anthropic | yes | 99 | 56,536 | 9 ideas |
| ideas | medium-a | entropy-24-00930-spya-pywwkq | medium | 580 | 3,961 | 22,870 | $0.0853 | $0.0853 | 38s | end_turn | Anthropic | yes | 99 | 56,536 | 9 ideas |
| ideas | low-b | entropy-24-00930-spya-pywwkq | low | 134 | 3,454 | 22,870 | $0.0803 | $0.0803 | 32s | end_turn | Anthropic | yes | 99 | 56,536 | 10 ideas |
| ideas | base-b | entropy-24-00930-spya-pywwkq | high | 11,054 | 15,757 | 22,870 | $0.2033 | $0.2033 | 151s | end_turn | Anthropic | yes | 99 | 56,536 | 10 ideas |
| ideas | base-a | entropy-24-00930-spya-pywwkq | high | 6,816 | 10,909 | 22,870 | $0.1548 | $0.1548 | 107s | end_turn | Anthropic | yes | 99 | 56,536 | 9 ideas |
| ideas | medium-b | noema-mythology-of-conscious-ai | medium | 679 | 4,208 | 21,713 | $0.0855 | $0.0855 | 37s | end_turn | Anthropic | yes | 141 | 52,573 | 9 ideas |
| ideas | medium-a | noema-mythology-of-conscious-ai | medium | 1,431 | 5,811 | 21,713 | $0.1015 | $0.1015 | 55s | end_turn | Anthropic | yes | 141 | 52,573 | 9 ideas |
| ideas | base-a | noema-mythology-of-conscious-ai | high | 10,838 | 16,800 | 21,713 | $0.2114 | $0.2114 | 153s | end_turn | Anthropic | yes | 141 | 52,573 | 10 ideas |
| ideas | low-b | noema-mythology-of-conscious-ai | low | 11 | 3,943 | 21,713 | $0.0829 | $0.0829 | 35s | end_turn | Anthropic | yes | 141 | 52,573 | 10 ideas |
| ideas | base-b | noema-mythology-of-conscious-ai | high | 5,968 | 10,389 | 21,713 | $0.1473 | $0.1473 | 102s | end_turn | Anthropic | yes | 141 | 52,573 | 9 ideas |
| ideas | low-a | noema-mythology-of-conscious-ai | low | 15 | 3,636 | 21,713 | $0.0798 | $0.0798 | 34s | end_turn | Anthropic | yes | 141 | 52,573 | 9 ideas |
| ideas | low-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 122 | 3,960 | 21,576 | $0.0828 | $0.0828 | 34s | end_turn | Anthropic | yes | 244 | 46,808 | 9 ideas |
| ideas | medium-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | medium | 157 | 4,414 | 21,576 | $0.0873 | $0.0873 | 40s | end_turn | Anthropic | yes | 244 | 46,808 | 10 ideas |
| ideas | base-b | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | high | 8,986 | 14,583 | 21,576 | $0.1890 | $0.1890 | 152s | end_turn | Anthropic | yes | 244 | 46,808 | 10 ideas |
| ideas | base-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | high | 8,208 | 13,130 | 21,576 | $0.1745 | $0.1745 | 115s | end_turn | Anthropic | yes | 244 | 46,808 | 10 ideas |
| ideas | low-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | low | 17 | 3,139 | 21,576 | $0.0745 | $0.0745 | 29s | end_turn | Anthropic | yes | 244 | 46,808 | 7 ideas |
| ideas | medium-a | towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | medium | 31 | 5,044 | 21,576 | $0.0936 | $0.0936 | 46s | end_turn | Anthropic | yes | 244 | 46,808 | 10 ideas |
| ideas | medium-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | medium | 3,060 | 6,470 | 20,382 | $0.1055 | $0.1055 | 63s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | medium-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | medium | 1,846 | 5,723 | 20,382 | $0.0980 | $0.0980 | 55s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | base-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | high | 6,379 | 10,012 | 20,382 | $0.1409 | $0.1409 | 94s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | base-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | high | 5,969 | 10,052 | 20,382 | $0.1413 | $0.1413 | 95s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | low-a | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 16 | 2,990 | 20,382 | $0.0707 | $0.0707 | 29s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | low-b | analog-cognition-and-consciousness-4-28-26-spya-f03kqf | low | 11 | 2,709 | 20,382 | $0.0679 | $0.0679 | 24s | end_turn | Anthropic | yes | 92 | 45,461 | 8 ideas |
| ideas | medium-b | after-work-we-ll-have-each-other-spya-we6h75 | medium | 2,626 | 5,529 | 15,970 | $0.0872 | $0.0872 | 57s | end_turn | Anthropic | yes | 97 | 34,272 | 6 ideas |
| ideas | low-b | after-work-we-ll-have-each-other-spya-we6h75 | low | 11 | 1,963 | 15,970 | $0.0516 | $0.0516 | 20s | end_turn | Anthropic | yes | 97 | 34,272 | 7 ideas |
| ideas | low-a | after-work-we-ll-have-each-other-spya-we6h75 | low | 12 | 2,229 | 15,970 | $0.0542 | $0.0542 | 22s | end_turn | Anthropic | yes | 97 | 34,272 | 6 ideas |
| ideas | medium-a | after-work-we-ll-have-each-other-spya-we6h75 | medium | 1,675 | 4,661 | 15,970 | $0.0785 | $0.0785 | 47s | end_turn | Anthropic | yes | 97 | 34,272 | 7 ideas |
| ideas | base-a | after-work-we-ll-have-each-other-spya-we6h75 | high | 5,383 | 8,819 | 15,970 | $0.1201 | $0.1201 | 85s | end_turn | Anthropic | yes | 97 | 34,272 | 6 ideas |
| ideas | base-b | after-work-we-ll-have-each-other-spya-we6h75 | high | 5,406 | 8,354 | 15,970 | $0.1155 | $0.1155 | 83s | end_turn | Anthropic | yes | 97 | 34,272 | 6 ideas |
| ideas | low-a | spider-silk-spya-ge30uz | low | 38 | 2,485 | 18,042 | $0.0609 | $0.0609 | 24s | end_turn | Anthropic | yes | 263 | 62,920 | 6 ideas |
| ideas | medium-a | spider-silk-spya-ge30uz | medium | 741 | 3,482 | 18,042 | $0.0709 | $0.0709 | 33s | end_turn | Anthropic | yes | 263 | 62,920 | 6 ideas |
| ideas | medium-b | spider-silk-spya-ge30uz | medium | 793 | 3,622 | 18,042 | $0.0723 | $0.0723 | 35s | end_turn | Anthropic | yes | 263 | 62,920 | 6 ideas |
| ideas | base-b | spider-silk-spya-ge30uz | high | 7,963 | 10,932 | 18,042 | $0.1454 | $0.1454 | 106s | end_turn | Anthropic | yes | 263 | 62,920 | 6 ideas |
| ideas | low-b | spider-silk-spya-ge30uz | low | 172 | 2,839 | 18,042 | $0.0645 | $0.0645 | 27s | end_turn | Anthropic | yes | 263 | 62,920 | 6 ideas |
| ideas | base-a | spider-silk-spya-ge30uz | high | 5,241 | 8,506 | 18,042 | $0.1211 | $0.1211 | 76s | end_turn | Anthropic | yes | 263 | 62,920 | 7 ideas |
| ideas | low-b | cargocult-spya-rz663q | low | 0 | 1,998 | 10,954 | $0.0419 | $0.0419 | 21s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |
| ideas | low-a | cargocult-spya-rz663q | low | 16 | 2,233 | 10,954 | $0.0442 | $0.0442 | 22s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |
| ideas | medium-a | cargocult-spya-rz663q | medium | 636 | 2,678 | 10,954 | $0.0487 | $0.0487 | 26s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |
| ideas | medium-b | cargocult-spya-rz663q | medium | 721 | 3,068 | 10,954 | $0.0526 | $0.0526 | 30s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |
| ideas | base-b | cargocult-spya-rz663q | high | 4,165 | 6,859 | 10,954 | $0.0905 | $0.0905 | 69s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |
| ideas | base-a | cargocult-spya-rz663q | high | 3,929 | 6,189 | 10,954 | $0.0838 | $0.0838 | 63s | end_turn | Anthropic | yes | 41 | 21,195 | 5 ideas |

Total, model calls: $5.1525; plates: none drawn.

## Hierarchy

Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat evals/results/thinking-effort-261001s-ideas-schema/corpus/after-work-we-ll-have-each-other-spya-we6h75 evals/results/thinking-effort-261001s-ideas-schema/corpus/analog-cognition-and-consciousness-4-28-26-spya-f03kqf evals/results/thinking-effort-261001s-ideas-schema/corpus/cargocult-spya-rz663q evals/results/thinking-effort-261001s-ideas-schema/corpus/entropy-24-00930-spya-pywwkq evals/results/thinking-effort-261001s-ideas-schema/corpus/noema-mythology-of-conscious-ai evals/results/thinking-effort-261001s-ideas-schema/corpus/replication-crisis-spya-hrjamq evals/results/thinking-effort-261001s-ideas-schema/corpus/spider-silk-spya-ge30uz evals/results/thinking-effort-261001s-ideas-schema/corpus/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
```

Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the
block counts in the table above are the record of what it read.
