# Thinking effort vs quality — thinking-effort-smoke

> Review note, 2026-10-01: this smoke predates the concurrency/resume fix. Its single
> `runs.jsonl`/`order.json` are retained as the historical record, and `orderIndex` is local to each
> invocation (the later Illustrated `low-b` therefore repeats slot 1). Full runs use per-mode JSONL,
> seed, README and configuration files, stable full-arm slots, article snapshots and pre-call claims.

Written by `evals/thinking-effort/run.ts` (plan 261001p). One row per run; the raw rows are
`runs.jsonl`, the outputs are under `<mode>/<slug>.<arm>.*`, and the exact article bytes
each run read are under `corpus/<slug>/`.

Production effort, read from the code at run time: sketch `high`, ideas `high`, illustrated *none named* (no `output_config`; the API default, `high` on Sonnet 5).
Arms run in a seeded shuffle per (mode, article); seed `2051144216` (order.json), position in `runs.jsonl` § orderIndex.
`effort sent` is what the Messages request carried, read off the wire. Thinking tokens are
inside output tokens. `$` is the ledger's (OpenRouter's settled cost) for the model call;
`list $` re-prices the same tokens with src/pricing.ts. Illustrated plates are off unless `--plates`.

| mode | arm | article | effort sent | thinking | output | input | $ | list $ | latency | stop | upstream | valid | blocks | chars | extra |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---:|---:|---|
| sketch | low-a | cargocult-spya-rz663q | low | 71 | 4,332 | 14,453 | $0.0722 | $0.0722 | 36s | end_turn | Anthropic | yes | 41 | 21,195 | 31 nodes, 1 faults |
| sketch | base-a | cargocult-spya-rz663q | high | 15,847 | 20,492 | 14,453 | $0.2338 | $0.2338 | 193s | end_turn | Anthropic | yes | 41 | 21,195 | 34 nodes, 0 faults |
| ideas | low-a | cargocult-spya-rz663q | low | 0 | 2,040 | 10,420 | $0.0412 | $0.0412 | 18s | end_turn | Anthropic | yes | 41 | 21,195 | 4 ideas |
| illustrated | low-a | cargocult-spya-rz663q | low | 1,911 | 7,902 | 12,512 | $0.1040 | $0.1040 | 65s | end_turn | Anthropic | yes | 41 | 21,195 | 3 plates in brief, 0 figures offered |
| illustrated | base-a | cargocult-spya-rz663q | (none) | 7,753 | 14,174 | 12,512 | $0.1668 | $0.1668 | 123s | end_turn | Anthropic | yes | 41 | 21,195 | 3 plates in brief, 0 figures offered |
| illustrated | low-b | cargocult-spya-rz663q | low | 11 | 5,654 | 12,512 | $0.0816 | $0.0816 | 95s | end_turn | Anthropic | yes | 41 | 21,195 | 3 plates in brief, 0 figures offered, 3/3 drawn ($0.2042) |

Total, model calls: $0.6997; plates: $0.2042.

## Hierarchy

Hierarchy runs through evals/hierarchy-structure/, not here, pointed at this run's corpus:

```
npm run eval:hierarchy-structure -- --arm incumbent --arm incumbent-repeat --arm smart-off --arm smart-off-repeat evals/results/thinking-effort-smoke/corpus/after-work-we-ll-have-each-other-spya-we6h75 evals/results/thinking-effort-smoke/corpus/analog-cognition-and-consciousness-4-28-26-spya-f03kqf evals/results/thinking-effort-smoke/corpus/cargocult-spya-rz663q evals/results/thinking-effort-smoke/corpus/entropy-24-00930-spya-pywwkq evals/results/thinking-effort-smoke/corpus/noema-mythology-of-conscious-ai evals/results/thinking-effort-smoke/corpus/replication-crisis-spya-hrjamq evals/results/thinking-effort-smoke/corpus/spider-silk-spya-ge30uz evals/results/thinking-effort-smoke/corpus/towards-a-theory-of-bugs-the-ruliology-of-the-unexpected
```

Those directories are not in its corpus manifest, so `matchesManifest` is `null` there; the
block counts in the table above are the record of what it read.
