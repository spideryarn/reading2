# Command pick: which fast model turns a sentence into a command?

Three runs, three write-ups:

- **2026-10-04**, finding F8 of
  [plan 261004k](../../docs/plans/261004k-command-bar-find-more-rows-and-more-mode-aliases.md):
  **production's arrangement only** (Jev picks, GPT Luna copies the words out) against the list
  after every mode got more nicknames and the two *Find more* rows arrived, on the 192 phrases of
  the run before plus 36 new ones. Write-up:
  [261004e](../../docs/investigations/261004e-command-pick-re-measured-after-more-nicknames-and-find-more-rows.md).
  Results in `results/261004/`; its `summary.md` ends with what moved since `results/261003/`.
- **2026-10-03**, Stage 1 of
  [plan 261003k](../../docs/plans/261003k-command-bar-takes-a-sentence-and-a-fast-model-picks-the-command.md):
  the row **and its argument**, Jev against three small chat models and against Jev with a small
  model for the words. Write-up:
  [261003e](../../docs/investigations/261003e-which-fast-model-turns-a-sentence-into-a-command-and-its-argument.md).
  Results in `results/261003/`, **frozen**: `run.ts` refuses to write there.
- **2026-10-02**, Stage D of
  [plan 261002c](../../docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md): can
  Jev pick a row at all. Write-up:
  [261002c](../../docs/investigations/261002c-jev-picks-a-command.md). Its results are
  `results/jev.json`, `results/chat.json`, `results/summary.md` and `results/raw/`, left as they
  were, measured against the hand-copied list in `catalogue-261002c.ts` (retired; nothing imports
  it). The code that made them is `run.ts` and `summarise.ts` at commit `316e9365c`.

## Rerun

```
npx tsx evals/command-pick/run.ts --arm jev-pick,hyb-luna --budget 1   # PAID, about $0.07: production's two calls, results/261004/
npx tsx evals/command-pick/run.ts                                      # PAID, over $1 (Haiku is most of it): every arm
npx tsx evals/command-pick/summarise.ts                                # free: results/261004/summary.md
npx tsx evals/command-pick/summarise.ts --results 261003               # free: an older run, printed and NOT written
```

`run.ts` takes `--arm a,b`, `--only p01,n03`, `--force`, `--budget <dollars>` (it stops once the
run has spent more; $4 if not given) and `--results <yyMMdd>`. A row already answered without an
error is skipped. The `hyb-*` arms read `jev-pick`'s answers, so run that first (the default order
does).

**One directory per run.** `--results` names it and defaults to `CURRENT_RUN` in `run.ts`. For a
new measurement, bump `CURRENT_RUN` and `PREVIOUS_RUN` and add the old one to `FROZEN_RUNS`.
`summarise.ts` shows only the arrangements that have saved answers, and for a run that is not the
current one it prints without writing: an older run's `summary.md` was made from the list and the
phrases as they were that day, and scoring it again today gives different numbers (`results/261003/summary.md`
is the code and the list at commit `a914523da`).

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
**Regenerating after a row's words change does not update the saved answers**: each `results/<run>/`
was measured against the list as it was that day (64 rows on 2026-10-03, 68 on 2026-10-04), so
after a change either measure again into a new directory or read the old numbers as being about
the old list.

## Files

- `catalogue.ts` — the options: the slice above, the five argument commands, and `none`. Also
  which picks would run at once and which write or spend. The argument commands' words are
  production's, imported from `src/command-pick.ts` § `ARGUMENT_OPTIONS`.
- `phrases.ts` — 228 requests in five sets (the fifth, `more`, is 2026-10-04's 36), with the ids
  counted as right, the expected argument, and the labelling rules. `blind.raw.json` is the blind set as its writer (a subagent shown
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
  picks for requests with no right answer and for any request, every miss, and every pick that
  changed since the run before.
