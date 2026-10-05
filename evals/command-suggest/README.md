# Command suggest: a short list from why you are reading

One run, 2026-10-05, for Stage 2 of
[plan 261005k](../../docs/plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md).
Write-up:
[261005b](../../docs/investigations/261005b-does-the-command-bar-suggest-useful-searches-from-why-you-are-reading.md).

The command bar can propose up to three searches, two modes and one question for chat from the
reader's profile and their reason for reading. This asks whether those answers are usable, whether
anything about the person gets into a search or the question, and how the searches compare with
using the bare reason as the search.

## Rerun

```
npx tsx evals/command-suggest/run.ts               # PAID, about 1.5 cents: 17 cases, 3 times each
npx tsx evals/command-suggest/run.ts --only c04    # only cases whose id starts with one of these
npx tsx evals/command-suggest/run.ts --summary     # free: write summary.md again from answers.json
```

It calls production's own `suggestCommands` (`src/command-suggest-call.ts`), so the prompt, the
model, the reasoning setting and the reader of the answer are what a reader gets. The call goes
through the gateway inside `withLedger("eval", …)`: the spend is in `npm run cost`, and there is no
spend declaration because nothing bypasses the gateway.

**Changing the prompt is a new measurement.** Bump `COMMAND_SUGGEST_VERSION` in
`src/command-suggest-call.ts`; `run.ts` then drops saved answers from the old version. Copy
`answers.json` and `summary.md` aside first if you want to keep them, as `answers-prompt-1.json`
and `summary-prompt-1.md` were.

## Files

- `cases.ts` — 17 made-up readers: an *About you*, a reason for reading, and for most of them the
  strings about the person that must not appear in a search or the question. Nobody real.
- `run.ts` — asks each case, checks the raw answer (parses, keys offered, caps, forbidden strings,
  no topic from a vague reason), and writes `results/261005/`.
- `results/261005/summary.md` — the checks as a table, then every case with all three answers, for
  reading. `answers.json` is the raw answers and what production's reader kept of each.
- `results/261005/summary-prompt-1.md`, `answers-prompt-1.json` — the first prompt's run, kept
  because the write-up compares the two.

## What it cannot tell you

No search is run against an article, so "are these better searches than the sentence itself" is a
read-through, not a number. And a clean forbidden-string check is a list of strings we thought of,
on readers we made up: the prompt asks the model to leave the person out, and nothing enforces it.
