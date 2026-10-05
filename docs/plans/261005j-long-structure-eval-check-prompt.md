# Check an eval write-up against its own results

Read-only: edit nothing. Do not run anything that calls a paid model.

## What to check

`docs/investigations/261005c-long-document-structure-top-level-first-against-slices-and-one-call.md`
claims things about the files under `evals/results/long-structure-2026-10-05/` (`matrix/cells/`,
`matrix/judge/`, `matrix/ledger.jsonl`, `smoke/`). The harness is `evals/long-structure/`
(`run.ts`, `arms.ts`, `calls.ts`, `judge.ts`, `score.ts`, `prompts.ts`). The plan section that
rests on it is `docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md`
§ Result: stage 2.

`npx tsx evals/long-structure/run.ts report --name matrix` prints the cells table from the stored
files and costs nothing; you may run that.

## Check each of these against the raw files, not against the prose

1. Every number in the write-up's two tables (times, calls, answers not accepted, cost, parts
   and sections; each judge's verdict per pair, and which judge is which in "Opus's verdict, then
   Sol's").
2. The totals: $32.42 spent; $8.34 of $22.37 on first calls; 4 of 14 staged runs with no tree;
   9 of 14 with an answer refused by the parser; the judges agreeing on 9 of 12 overall verdicts.
3. "Every failure but one was an answer that did not parse or did not tile its blocks, twice
   running, in a per-part call … None was a transport failure or a refusal." Read the failed
   cells.
4. "The same prompt on the same book gave 15 parts once and 8 the next time": are B's and C's
   first calls really the same request for the book, apart from what follows them?
5. The quoted judge sentences: are they the judges' own words, from the pair files named?
6. Is the judge really blind and able to fail: is the X/Y seat shuffled, are the sampled passages
   chosen without reference to either tree, and does the spoiled-tree check gate which judges are
   used? Anything in `judge.ts` that could leak which arm is which (part counts in a fixed order,
   an arm name in the materials, a seat that correlates with the arm)? The log says the
   first-named arm sat in X for 9 of 12 pairs: is that the shuffle's luck or a bias?
7. Is the comparison fair: do the arms get the same blocks, the same model and effort, the same
   final build and checks? Is anything timed in a way that favours one arm (for example an arm's
   cold start, or eight-at-a-time concurrency that production would not give)?

## And the conclusions

Do the six bullets under "The short answer" and the five under "What it means for the plan"
follow from the evidence, or does any go further than one run per cell allows? In particular:
"it should not be built yet", "C is dropped", and "past the line it made the better table of
contents". Say which you would soften, and how. Is there a conclusion the data supports that the
write-up missed, or an inconvenient result it explained away?

## What to return

A verdict (the write-up stands / stands with corrections / does not stand), then findings
numbered F1…, each with a priority, the file you read it in, and the exact correction. Say
plainly which of the seven checks you did and found true. Under 900 words.
