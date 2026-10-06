# A row count does not prove a judged comparison is complete

Review of [261006e Stage 2](../plans/261006e-skim-cue-situates-the-quote-and-term-chips-use-the-glossary-card.md)
found that the free cue scorer accepted incomplete or repeated judgments and unknown answer values.
Nothing reached a reader. The six recorded judgment files are complete and valid; rescoring them
after the fix accepted all six and regenerated identical keys.

## The class: counting rows while assuming their identities and vocabulary

The boundary was a JSON file from a judge, but the scorer treated a TypeScript assertion as a
runtime contract. It checked each pair existed, which cannot prove that each expected pair appears
exactly once. Even its row-count mismatch only printed a warning. Two judgments for pair 1 could
replace the judgment for pair 2 with the right total length and a successful exit. An unknown
`giveaway` or `invent` value counted as neither side, making a malformed answer look harmless.

The arm loader had the same identity assumption: `runOf` selected the first article with a slug,
while screens counted every run. Passing a coverage file with two runs per article silently scored
only one of them. Both defects entered with `c943494a9`, which introduced the cue comparison
instrument for the first wording round.

## Why nothing went red

The existing results were well formed, so recomputing their figures exercised none of these failure
paths. The first regression run of [skim-cue-pairs.test.ts](../../tests/skim-cue-pairs.test.ts)
showed seven failures: duplicate article runs, missing judgments, two forms of duplicate judgment,
and invalid values for each of the three answer fields all returned exit code 0. A judgment for an
unknown pair already failed correctly. Nine tests passed after the fix.

The sibling [skim-again-pairs.ts](../../scripts/eval/skim-again-pairs.ts) also joins judgment rows to
keys without requiring completeness or uniqueness. It is outside this stage and was reported,
not changed.

## What would have caught it, ranked by ease against value

1. **Validate identity and vocabulary before tallying** — implemented at the JSON boundary.
   Missing, repeated and unknown pair IDs, and invalid choices, now stop the scorer. Repeated
   article slugs stop the loader instead of silently selecting a run.
2. **Test corrupt input through the real CLI** — implemented with small temporary arm and judgment
   files. This exercises the actual parse and exit status without database reads or paid calls.
3. **Add a shared schema framework or support arbitrary repeated-run pairing** — rejected for this
   fix. The comparison expects one run per article per arm; explicit refusal covers that contract
   with fewer moving parts. A shared validator would be worth reconsidering when fixing the
   sibling, rather than refactoring other evals inside this stage.

## The fix that is right for the long term

Require a bijection between expected pair IDs and judged pair IDs, with every answer in the allowed
vocabulary, before producing a score. The shipped fix does this for the cue instrument. Applying
the same boundary contract to the older sibling remains separate work; changing recorded figures
or merely adding a warning would leave the harmful default intact.

I would not use a successful rescore of valid evidence to claim that the instrument rejects bad
evidence. Those are different assertions and require different inputs.

Up: [Postmortems](../project/postmortems.md)
