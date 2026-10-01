No P0 findings. I would not ship v1, and the proposed evidence-checking guard is the right next experiment.

## P1

- **One v1 output classified as “right” contains another direction error.** `pidpost9` Fuller says “feedback connections **to** the target,” but the paper defines feedback as target → source. It preserves the synergy effect but reverses the connection direction. [Result](</home/greg/code/spideryarn2/.claude/worktrees/fix-summary-synergy-reversal/evals/results/simple/high-none-pidpost9/entropy-24-00930-spya-pywwkq.json:72>)

  The requested term-swap counts are still correct:

  - Baseline: 6 clear / 18.
  - v1: 3 clear + 2 glossed / 36.
  - v2: 7 clear + 1 glossed / 18.

  But v1 has **six related errors**, not five: those five term collisions plus the direction error. I updated the table and statistics in the [plan](</home/greg/code/spideryarn2/.claude/worktrees/fix-summary-synergy-reversal/docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md:91>).

- **The probe’s `model` field did not record an eval model override.** It used the stable production generator stamp rather than the model actually resolved for the call, so an overridden time-separated arm could be misattributed. It now uses `modelFor("simple", "standard")`, which includes overrides. [probe.ts](</home/greg/code/spideryarn2/.claude/worktrees/fix-summary-synergy-reversal/evals/simple/probe.ts:157>)

## P2

- **The historical 24/27 guard-recall tally excluded the two v1 gloss errors.** Including all term collisions gives 26/29; including the newly found direction error gives **27/30**, with the same three uncited misses. Corrected throughout the plan.

- **“Reversal” was too strong for the clear swaps.** “Feedback loops between source neurons” describes the correct source-to-source topology but borrows the paper’s name for another category. It is still a real fidelity fault—none of the counted swaps should be reclassified as right—but “terminology collision” is more exact. I corrected the plan and both pointers.

- **One wider overclaim remains outside the authorised files.** `src/models.ts` still says the outputs turn recurrent connections into feedback loops “which … lower” synergy. The paper’s *feedback connections* lower it; the outputs’ qualified source-to-source loops preserve the topology while corrupting the terminology. [models.ts](</home/greg/code/spideryarn2/.claude/worktrees/fix-summary-synergy-reversal/src/models.ts:1719>)

## Conclusion

“No prompt change reliably helps” is too broad. The honest conclusion is:

> v1 may reduce the clear phrase, but neither tested wording reliably prevents the semantic fault or met the predeclared threshold.

The p-values reproduce:

- Clear swaps: `p = 0.0467`.
- Clear + glossed: `p = 0.1504`.
- Including the separate direction error: `p = 0.1842`.
- Corresponding run-level values: `0.043`, `0.152`, `0.316`.

I would not ship v1. Its significant result is limited to the surface phrase most directly targeted by the prompt; glosses appeared, another direction error remained, six of 36 outputs were still wrong, and the controls were checked only for length/validation. V2 is not a formal replication of v1 because it is a different wording, but it demonstrates how brittle this intervention is.

## Guard

Checking each paragraph against its own cited blocks is the cheapest sound *general kind* of guard I see. Regexes are paper-specific, while an ignored self-check field remains the same generation judging itself.

Three per-level checks are the simplest integration with `writeLevel` and can overlap in time. [simple-summary.ts](</home/greg/code/spideryarn2/.claude/worktrees/fix-summary-synergy-reversal/src/simple-summary.ts:654>) One batched check after all three levels would be cheaper in request overhead and less exposed to quick-model rate limits, but requires restructuring retries around the settled levels. I would measure both packing options after first validating classifier recall and false alarms.

The `$0.01` and 2–5 second estimate is plausible and probably conservative, but remains unmeasured. Fail-closed availability is the larger concern. The guard’s declared ceiling is honest: cited-block-only checking misses three of 30 known faults even with a perfect classifier.

## Edits made

- Corrected the plan’s classification, statistics, guard recall, and terminology.
- Corrected the two pointer docs’ “reversal/opposite” language.
- Made probe model provenance override-aware.
- Made `term-swap.ts` print arms in numeric order (`1, 2, … 10`) rather than lexicographic order.

Verification:

- Typecheck passed.
- Scoped Biome lint passed with two pre-existing complexity advisories.
- `doc-links` and `plain-words-coverage` passed.
- Full `npm test` could not run because the sandbox could not reach the local Postgres/Docker service.