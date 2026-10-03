# Command pick: which fast model turns a sentence into a command?

Two runs, two write-ups:

- **2026-10-03**, Stage 1 of
  [plan 261003k](../../docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md):
  the row **and its argument**, Jev against three small chat models and against Jev with a small
  model for the words. Write-up:
  [261003e](../../docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md).
  Results in `results/261003/`. Everything below is about this run.
- **2026-10-02**, Stage D of
  [plan 261002c](../../docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md): can
  Jev pick a row at all. Write-up:
  [261002c](../../docs/investigations/261002c-jev-picks-a-command.md). Its results are
  `results/jev.json`, `results/chat.json`, `results/summary.md` and `results/raw/`, left as they
  were, measured against the hand-copied list in `catalogue-261002c.ts` (retired; nothing imports
  it). The code that made them is `run.ts` and `summarise.ts` at commit `316e9365c`.

## Rerun

```
npx tsx evals/command-pick/run.ts          # PAID, about $1 (Haiku is most of it): results/261003/<arm>.json and raw/<arm>.json
npx tsx evals/command-pick/summarise.ts    # free: results/261003/summary.md
```

`run.ts` takes `--arm a,b`, `--only p01,n03` and `--force`. A row already answered without an
error is skipped. The `hyb-*` arms read `jev-pick`'s answers, so run that first (the default order
does). The run stops if it passes $4.

## The list, and regenerating it

The options are the bar's own rows, not a copy:
`src/command-pick-catalogue.generated.json` holds every row the bar can draw in every place it is
opened, and this eval uses the `owner-article` slice (an owner, on an article, Experimental on).
`bar-answers.generated.json` holds, for each sentence here, what the bar's own matching already
gives it. Both are written by a test, because `src/web/CommandBar.tsx` cannot be imported outside
vitest:

```
WRITE_COMMAND_PICK_CATALOGUE=1 npx vitest run tests/command-pick-catalogue.test.ts
```

The same test fails when either file is out of step with the bar or with `phrases.ts`.
**Regenerating after a row's words change does not update the saved answers**: `results/261003/`
was measured against the list as it was on 2026-10-03, so after that either rerun with `--force`
or read the old numbers as being about the old list.

## Files

- `catalogue.ts` — the options: the slice above, the five argument commands, and `none`. Also
  which picks would run at once and which write or spend. The argument commands' words are
  production's, imported from `src/command-pick.ts` § `ARGUMENT_OPTIONS`.
- `phrases.ts` — 192 requests in four sets, with the ids counted as right, the expected argument,
  and the three labelling rules. `blind.raw.json` is the blind set as its writer (a subagent shown
  only row names and descriptions) left it.
- `jev.ts` — one call to `POST /api/alpha/decisions`, the declared bypass `command-pick-jev`.
- `chat.ts` — one call to a chat model with this arm's own `reasoning` and `provider`, the declared
  bypass `command-pick-chat` (the gateway's `eval` row decides both for its caller, and they are
  what the arms differ in). Both are metered through `evals/declared-spend.ts`.
- `run.ts` — the arms. The prompts production also sends (`choiceAsk`, `wordsMessages`) are
  imported from `src/command-pick.ts`, so what was measured and what is sent are one copy; changing
  that wording is a new measurement.
- `summarise.ts` — whole-outcome accuracy by set, latency and cost per arrangement, the predeclared
  reading, the words, Jev's top three, the confidence cuts and what would have run at once, risky
  picks for requests with no right answer, and every miss.
