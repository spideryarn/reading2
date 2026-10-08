# What topic pills on the public shelf would cost, measured

Up: [investigations.md](../project/investigations.md) · the plan is
[261008j](../plans/261008j-public-shelf-topic-pills-automatic-billed-to-the-site.md) · the feature
is [shelf-terms.md](../project/shelf-terms.md)

**In one paragraph.** Greg would take topic pills on `/read/public` that regenerate by themselves,
billed to the site, *"if it was only half a cent and you were confident about that"* (2026-10-08,
reply `spya-hbtqvc` to `q-deh67j`). Measured on the shipped code: a full re-think of today's public
shelf (6 articles) costs **0.03–0.04¢**; of 20 articles about **0.09¢**; of 45 about **0.5¢**; of 96
about **1.4¢**. Filing one newly shared article into the measured 20-article tree costs about
**0.01¢**. A one-article filing stays one bounded call as the shelf grows, so it should remain far
under half a cent; that larger-shelf claim is an inference, not a measurement. A full re-think is
comfortably under the bar up to 20 articles. At 45, one of two runs was already over it. **Greg's bar
is per regeneration**, so the plan makes full re-thinks automatic only up to 20 articles.

## Method

`evals/shelf-topic-clusters/public-shelf-cost.ts` (run 2026-10-08, prompt version 2, GPT-6 Luna via
OpenRouter, total spend **2.82 cents**). It calls production's own `rethink` and `fileWorks`
(`src/shelf-terms/model-topics.ts`) with **no reader profile**, as a public tree would have none,
and takes each run's spend from the cost collector, the same figure `npm run cost` counts.

- **public-6** is the real public shelf: the six articles `/read/public` lists today, read from
  production read-only with the listing's eligibility, ordering and 1,200-character gist cap. They
  are already shown to anyone. The title fallback is checked below.
- **wide-N** are seeded samples of the synthetic `greg-wide` shelf (96 articles over twelve areas),
  standing in for a public shelf of mixed subjects as it grows. 8 is the smallest shelf that shows
  pills at all.
- **file-one** is three one-article filings into the wide-20 tree, each with a different newcomer:
  three examples of what one more share costs between re-thinks, not three repeats of one input.

The saved `public-6` result predates the review fix to the script. Its production query had the same
eligibility and ordering, but omitted the listing's first-`<h1>` title fallback and its 200-row
ceiling. Six rows made the missing ceiling immaterial, and the fallback was too: a read-only count on
production afterwards (2026-10-08) found all six listed articles have a stored title, so the
fallback is never reached for any of them and the inputs were the listing's own. The paid eval was
not re-run. The script now matches both for any future run.

Raw results: `evals/shelf-topic-clusters/results/261008-public-shelf-cost.json`.

## Results

| shelf | runs | calls per run | cost per run | seconds |
|---|---|---|---|---|
| public-6 | 3 | 1 | $0.00030 – $0.00040 | 5–8 |
| wide-8 | 2 | 1 | $0.00029 – $0.00034 | 6 |
| wide-20 | 2 | 1 | $0.00088 – $0.00097 | 13–19 |
| wide-45 | 2 | 4 | $0.0048 – $0.0052 | 67–80 |
| wide-96 | 1 | 9 | $0.0144 | 130 |
| file-one (into wide-20) | 3 | 1 | $0.00007 – $0.00011 | 3–5 |

**Where the step is.** The measured 20-article run stayed at one call. At 45, at least one subject
had the twelve works that earn finer topics, so the per-subject calls and widening pass took each
run to four calls. The eval did not locate the exact shelf size where that step occurs.

## What a share actually costs

A re-think is not run on every share. It is due when the shelf has grown or shrunk by a quarter
(and at least five works) since the last one, or when the prompt or the model changes; every share
in between is one filing call
([shelf-terms.md § Two jobs](../project/shelf-terms.md#topics-a-model-names-broad-to-fine)).
Averaged over the shares that cause it, a growth re-think works out to under a tenth of a cent a
share at every measured size. **That average does not answer Greg's question**, which was about a
single regeneration, and it leaves out re-thinks caused by a prompt or model change, which no share
pays for. GPT Sol's plan review made that point, and the plan's cut-off at 20 articles is the
answer to it.

What is measured and what is not: the widening pass is included (`rethink` runs it), and every call
was priced. The saved result does not record per-call outcomes or attempt numbers, so it does not
independently establish whether an internal retry occurred. A retried call can roughly double that
part of a run. The eval did not measure 150 articles on version 2.

## What it does not show

- Not the quality of a six- or eight-article tree. public-6 came back with two topics each time; on
  a shelf that small the pills narrow very little. The pills appear only from eight articles.
- Not the worst case under abuse: an owner sharing and un-sharing repeatedly to make the site
  re-think. The plan bounds that with the existing allowance (which counts runs, not money)
  applied to the site account, and the cut-off; the figure is in the plan.
