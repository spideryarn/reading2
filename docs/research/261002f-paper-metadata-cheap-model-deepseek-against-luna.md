# Paper metadata: which cheap model reads a PDF's first pages?

Written 2026-10-02 from the work of 2026-10-01, in
[plan 261001m](../plans/261001m-bulk-import-of-many-papers-a-stepping-stone.md) (§ "What the code says
today", item 5 of the answers) and [261001o](../plans/261001o-route-the-cheap-model-metadata-spike-through-the-gateway.md).
The full results already exist at [evals/results/paper-metadata-2026-10-01.md](../../evals/results/paper-metadata-2026-10-01.md);
this doc ties the three steps (no-model spike, cheap-model spike, DeepSeek-vs-Luna gate) into one story.

## The question

A bulk upload should cost almost nothing per paper ("0.01x an AI-processed paper"). Can title,
authors, abstract and DOI be read from pages 1-2 of a PDF for roughly $0.001, with no full pipeline?

> And if possible, use DeepSeek v4.1 Flash or similar (i.e. very cheap, but still pretty modern
> and smart for its price) via OpenRouter for this (but via a ZDR provider, e.g. Fireworks).
>
> — Greg, 2026-10-01 (quoted in the plan)

## What was measured

1. **No model** (`evals/pdf/minimal-metadata/no-model-spike.mjs`, pdf.js, 14 eval PDFs): the PDF Info
   title was right once in ten; largest-font heuristic got the title 4/10 on the hard fixtures, authors about 5/10;
   abstract after a heading 6/10; DOI 4/10. Unreliable (plan 261001m).
2. **Luna spike** (`cheap-model-spike.mts`, `openai/gpt-5.6-luna`, effort low, 6,000 chars): titles 13/13,
   authors 13/13, ~$0.0005 a paper, 1-6 s. Scans with no text layer not tested. Those figures are from the
   raw-call version (20abc3379); since 261001o the script goes through the gateway at the `eval` row's
   default effort, so a re-run is not the same experiment and will probably cost more.
3. **The gate**: `npx tsx evals/pdf/minimal-metadata/score.mts --runs=3`, 13 PDFs (11 distinct texts) against
   `expected.json`, production's `extractPaperMetadata` for both arms (2026-10-01 18:09Z).

## The numbers (source: the results file above)

| | DeepSeek v4.1 Flash, Fireworks only | Luna |
|---|---|---|
| title exact | 37 (+1 close) of 39 | 39 of 39 |
| authors recall / precision | 97% / 97% | 100% / 100% |
| cost a paper | $0.00022 | $0.00047 |
| 429s retried | 21, on 8 of 39 papers | 0 |

- Fireworks' shared pool refused hard. One call failed after retries. The route became
  `order: [fireworks, deepinfra, together]`, ZDR-only, fallbacks allowed. Re-run with `--runs=2 --arms=deepseek --concurrency=3`:
  26/26 titles, 0 429s seen, $0.00036 a paper, Fireworks 18 and DeepInfra 8 of the answers.
- One real regression: the Wellcome catalogue-line scan, where DeepSeek kept `/ by L.N. Fowler.` in the title
  (3 of 4 extra runs; Luna 0 of 3). After the Stage 3 kind-neutral prompt, a 2-run re-run of DeepSeek was 26 of 26 including that scan, at $0.00055 a paper.

## Decision

The session building it shipped DeepSeek (2026-10-01): the brief's bar was "if it's clearly worse ... report
back rather than ship"; it was not clearly worse, the production route was 26/26, the cost to a reader is a
renamable shelf title, and reversal is one constant (`PAPER_METADATA_MODEL`) plus the route block. It was put to Greg in
the feedback note. Now in [setup-dev.md](../project/setup-dev.md) (paper metadata row).

## Dead ends

- No-model heuristics (above). Fireworks-only routing (rate limits). A Fireworks BYOK key was the error
  message's own advice but is a secret and Greg's call; the fallback route was taken instead.
- The gateway does not retry a 429; a refusal surviving all three providers fails the job.

## Caveats

Small corpus, 11 distinct layouts; the byline regression was 3 of 4 extra runs in one run and 0 of 2 in later ones, so call it "not recurred", not "fixed". Luna's cost in the plan ($0.0005, token-count estimate, BYOK so OpenRouter said 0) and in
the gate ($0.00047, ledger) are different measurements.

Up: [research.md](../project/research.md)
