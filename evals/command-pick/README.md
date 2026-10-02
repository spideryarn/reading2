# Command pick: can Jev choose the command a reader asked for?

Stage D of [plan 261002c](../../docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md),
measuring the "Jev first, a capable model when unsure" shape in
[chat-llm-help-commands-vision.md](../../docs/project/chat-llm-help-commands-vision.md). The
write-up, with the numbers and the caveats, is
[docs/investigations/261002c-jev-picks-a-command.md](../../docs/investigations/261002c-jev-picks-a-command.md).

## Rerun

```
npx tsx evals/command-pick/run.ts          # PAID (~$0.45 for both arms, 72 phrases): results/jev.json, results/chat.json, results/raw/
npx tsx evals/command-pick/summarise.ts    # free: results/summary.md
```

`run.ts` takes `--arm jev|chat`, `--only p01,h03` and `--force`. A row already answered without an
error is skipped, so delete `results/*.json` (or pass `--force`) for a fresh run.

## Files

- `catalogue.ts` — **a hand-copied snapshot** of the bar's rows plus the rows plan 261002c adds (51
  in all). A production version must serialise the real registry, not copy it.
- `phrases.ts` — 72 requests with the ids we count as right: round 1 (`p01`–`p46`, including six
  with no right answer) and round 2 (`h01`–`h26`, harder, added after round 1 hit the ceiling).
- `jev.ts` — one call to `POST /api/alpha/decisions`, the declared bypass `command-pick-jev` in
  `src/spend-declarations.ts`; metered through `evals/declared-spend.ts`.
- `run.ts` — both arms. Chat is `CAPABLE_MODEL_OPENROUTER` through `openRouterJson("eval", …)`.
- `summarise.ts` — accuracy, the find argument, latency and cost, and Jev's confidence thresholds.
