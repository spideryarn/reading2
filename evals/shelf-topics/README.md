# Shelf topics: can a model pick the pills?

Stage 1 of [plan 260929c](../../docs/plans/260929c-shelf-topics-chosen-by-a-model.md). Read its
§ Reviews (R5–R9) first, because they set this design. The deterministic chooser proposes candidate
topics. Each model arm scores every candidate 0–3 against one anchored rubric, and production's own
greedy (`chooseTerms` with `ChooseOptions.quality`) picks the 30. Two secondary arms instead ask a
chat model for the order directly.

## Rerun

```
npx tsx evals/shelf-topics/build-cases.ts        # cases/*.json: synthetic + the local shelf (read-only) + 3 subsets
npx tsx evals/shelf-topics/run-arms.ts           # PAID: every arm × case × runs 1–3 → results/<case>/<arm>-<run>.json
npx tsx evals/shelf-topics/derive-jev-floor.ts   # free: jev-floor arms from the SAVED Jev scores
npx tsx evals/shelf-topics/summarise.ts          # results/summary.md: coverage, overlap, distractors, topics, cost, latency
npx tsx evals/shelf-topics/make-pairs.ts --full  # results/pairs-full/<case>.json + results/pairs-full-key.json: every member title
npx tsx evals/shelf-topics/tally.ts [--full]     # join judgements to their key: independent votes, duplicates, controls, scores
```

**`jev-floor` and `jev-floor-0.75` were added after seeing the results. They were not predeclared.**
Jev's expected scores never reach 0, so planted distractors scored 0.5–0.9 and the greedy took them
anyway. These arms set any saved Jev score below 1.0 (or 0.75) to 0 and rerun the same greedy.
They make no model call. `summary.md` marks them with † on every row.

`run-arms.ts` takes `--case <id>`, `--arm <arm>` and `--force`. It skips a run whose file already
exists without an error, so running it again retries only the failures. `--synthetic` on
`build-cases.ts` skips the database. Rebuilding the cases changes the candidates, so delete
`results/` before a fresh run: each case's `candidates.json` is written once and reused, so that
every arm and run sees the same list.

## Files

- `synthetic/<id>.json` holds shelves written for the eval, each with a profile and pre-labelled
  `good` topics and planted `distractors`. **`greg-like` is the case that matters most.** It stands
  in for Greg's production shelf, which is not available: computational neuroscience,
  consciousness, Buddhism and AI, plus a few off-topic articles that plant *food*, *bowl* and
  *female*.
- `case.ts` has the case shape, the arms, and the run-file shape.
- `prompt.ts` has what every model is shown: the rubric, the shelf (titles and gists), and the
  candidates (the baseline's own picks first, then the pool best-first with restatements removed,
  up to 80).
- `jev.ts` makes the one call to Jev on `POST /api/alpha/decisions`. It is a declared bypass
  (`shelf-topics-jev` in `src/spend-declarations.ts`), metered through `evals/declared-spend.ts`,
  and the full response is saved to `results/<case>/raw/`.
- `results/<case>/raw/` also keeps every chat arm's full response.

## The judge

The judge is a fresh Opus subagent that reads **only** `results/pairs/<case>.json`, one case per
file, and never the key. Each topic currently shows at most five member titles plus a count of any
others; the plan's R6 required all member titles, so the committed verdicts are weaker on membership
coherence than intended. Brief the judge to answer, for each pair: which list would this reader
rather filter with (A, B or tie), and score each list 1–10 on *meaningful to this reader*, *covers
the shelf* and *no near-duplicates*.

Each case has these pairs, all using run 1:

- **Contrasts:** jev-floor vs baseline, luna-score vs baseline, jev-floor vs luna-score, and
  luna-order vs luna-score.
- **greg-like only:** jev-score vs jev-floor, and deepseek-score vs luna-score.
- **Controls:**
  - luna-score run 1 against run 2, which measures the combined effect of model run-to-run
    variation and the judge; the lists are not identical, so it does not isolate judge noise.
  - baseline against itself, which is the same list twice, so the answer should be a tie.
  - One swapped duplicate: jev-floor vs luna-score shown again with its sides reversed. It tests
    whether the judge favours a side; it is not a second independent vote on the contrast.

`make-pairs.ts` prints the key's A/B counts per arm. Check them before judging.

**The full-membership round.** `make-pairs.ts --full` writes the same contrasts again with every
member title, as R6 asks. It uses a fresh shuffle and ids `f001`…, and puts them in
`results/pairs-full/`, keyed by `results/pairs-full-key.json`. Save that round's verdicts to
`results/judgements-full/<case>.json`.

Without `--full`, `make-pairs.ts` refuses to overwrite `results/pairs-key.json`. The first round's
verdicts in `results/judgements/` can only be read through that key.

Both keys mark a swapped duplicate as `independent: false`. The new key also names the pair it
repeats (`duplicateOf`). `tally.ts` counts only independent votes per contrast and reports the
duplicates' agreement separately.

## The 2026-09-29 run files

The per-run lists, raw model responses and built cases of the 2026-09-29 runs are gitignored
(regenerable, but $0.26 to regenerate). A copy is on the Hetzner box at
`/home/greg/spideryarn-eval-archives/260929c-shelf-topics-eval-runs.tgz` (381 files, 2 MB).
