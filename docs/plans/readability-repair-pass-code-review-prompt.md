# Second review — the built extraction spike, with its numbers

**Weight this higher than your review of the plan.** That one read prose; this one can read the
code that produced the numbers, and the most useful finding is usually about the experiment rather
than the conclusion. Your earlier review is at
`docs/plans/readability-repair-pass-review-sol.md` and most of it was acted on.

## What to read

- `docs/plans/readability-repair-pass.md` — the plan, rewritten after your review
- `evals/extraction/inventory.mts` — the instrument. No model, no network. `compare()` is the seam.
- `tests/extraction-inventory.test.ts` — its tests, one per bug it shipped with
- `evals/extraction/rescue.mts` — the model arm: one call that both detects and produces a repair
- `evals/results/extraction-rescue-*.json` — the actual answers, every id the models chose
- `src/extract.ts`, `docs/project/block-ids.md` — the stage, and the contract

## What was found, so you can attack it

1. `data/constitution` loses 48,147 characters (26%) through stage 2, silently. Cause: the prose is
   inside `<div role="region" aria-hidden="true">` collapsed accordions, and Readability skips
   `aria-hidden` nodes by design (`Readability.js:2701`).
2. Removing `aria-hidden="true"` before parsing recovers 39,355 characters and 4 of 5 probes, and
   changes nothing on the two pages that were already clean.
3. Readability option variants and re-rooting at `<main>`/`<article>` change nothing at all.
4. Provenance via the `serializer` option plus stamped source ids: 92.7% / 99.8% / 40.9% of output
   elements carry a source id. Stamping is inert (byte-identical output).
5. The model arm, over the blocks Readability dropped, asking only which are article and which are
   furniture, answering with ids only:

   | page | candidates | Luna restores | Sonnet restores | "restore everything" |
   |---|---:|---:|---:|---:|
   | constitution | 157 | 135 | 125 | 157 |
   | noema | 29 | 2 | 1 | 29 |

   Luna: ~4.3k in / 1.4k out tokens, ~22s on the big page.

## Questions

1. **Is the control sound?** The `--with-short` population is "blocks absent from the extraction,
   including ones too short to fingerprint". Its first version swept in short blocks Readability had
   *kept* — eight section headings — so the model's correct "these are the article" counted as a
   rescue. It is now filtered on `survived === 0`. Is there still a way this flatters the model? In
   particular: is "restore everything dropped" the right null, or is there a stronger cheap baseline
   I should be beating (e.g. a link-density or text-density rule over the same rows)?

2. **Luna and Sonnet agree closely.** Does that mean the task is easy, or that both are anchored by
   the same prompt and the same row format? How would you tell those apart with one more cheap run?

3. **The two interventions overlap.** Un-hiding recovers 39,355 chars for free; Luna restores 49,753
   on the same page. Are they redundant, and if the free one runs first, is there enough residual to
   justify the paid one? What experiment settles that, on the evidence I have rather than on a
   corpus I have not built?

4. **The instrument.** `compare()` shingle matching with a longest-increasing-subsequence contiguity
   check, `coverage` as the self-guard, and the four bugs recorded in the tests. What is the fifth
   bug? Be specific about an input that makes it lie.

5. **Anything in the rewritten plan that is still wrong**, and anything in my reading of your first
   review that I got backwards. I checked several of your claims and one of your tables — the
   extracted/raw ratios (0.239 / 0.873 / 0.535) — appears to be computed over unstripped
   `body.textContent`, which on the Constitution is 68% `<script>`. The harness strips
   script/style/noscript/template/svg first, giving 0.737 / 0.974 / 1.000. Confirm or correct me.

Answer in prose with headed sections, most important first. Where you disagree, say what you would
do instead and what evidence would settle it.
