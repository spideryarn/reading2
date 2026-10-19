# A paid eval must fail closed at every evidence boundary

The guide eval added in `385f08e55` reported a valid blind 19–2 preference, but several independent
gaps could have made a broken future run look equally convincing: pairing silently intersected
arms, unblinding ignored malformed or missing verdicts, cited passages were clipped before the
judge saw all their support, baseline provenance was absent, and the mechanical screen omitted
several promises it claimed the new outputs met. Review found the gaps before the commit landed on
`dev`; no reader was affected and no paid calls were rerun.

The committed arms and verdicts are complete and unique, both keys are balanced 11/11, and strict
unblinding reproduces 19–2–1 and the 12–10 control. The evidence clipping did affect what the judge
saw: on pair 20 the quoted support lay beyond the 400-character excerpt, which the verdict itself
noticed. Corrected screens reduce the new arm's clean count from 22/22 to 14/22; the blind result is
unchanged.

## The class: an evidence pipeline that succeeds on a strict subset

Every boundary discarded something without failing: unmatched cohort rows, unparsable verdicts,
the tail of a cited block, one of two prompt-bearing source files, or acceptance criteria not
encoded by the screen. Each local operation looked convenient. Together they let the pipeline
print a complete-looking conclusion after seeing less evidence than the conclusion claimed.

This is silent success in an evaluation: a denominator, a source identity and the evidence shown to
the judge are part of the result, not optional metadata.

## Why nothing went red

There were no unit tests for pairing or unblinding. The generated files happened to be complete,
so manual line counts did not exercise the failure paths. The judge prompt asked it to check factual
support, while the renderer quietly truncated that support. The screen checked *a citation* and *no
refusal*, then the investigation promoted those weak predicates into *every sentence is cited* and
*the answer ends on the passage*. Finally, the after run added one hash after the baseline files had
already been written, and the plan recorded F5 as satisfied without reading all three headers.

## What would have caught it, ranked by ease against value

1. **Make joins and parsers prove cardinality** — done. Duplicate or unequal `(case, run)` sets,
   malformed keys or verdicts, duplicate verdicts and missing verdicts now throw. An unbalanced key
   also refuses to be written.
2. **Hand the judge complete cited evidence** — done. Fixture blocks here are small enough that
   truncation bought little and invalidated the factuality check.
3. **Test the acceptance criteria the result names** — done for the 60-word ceiling, three-sentence
   content answer, per-sentence citations and ending on a passage. The saved runs were rescored and
   the investigation corrected.
4. **Fingerprint every model-visible source that changed** — new runs now hash both `converse.ts`
   and `chat-tools.ts`. The two historical baseline files cannot be made self-authenticating after
   the fact, so the investigation says that limitation plainly instead of backfilling a claim.
5. **Record a cryptographic manifest of every input, output and judge environment** — rejected for
   now. The two source hashes plus committed fixtures address the observed risk without building a
   general experiment registry.

## The long-term fix

The narrow fixes are also the right design: comparisons are total joins, verdict parsing is strict,
judge evidence is lossless for the committed corpus, screens name only predicates they compute, and
new artifacts identify both prompt-bearing sources. If more prompt surfaces join this eval, its
source metadata should become an explicit manifest rather than another hand-added hash.

## The thing I would tell myself

An eval is not allowed to be forgiving. If any cohort row, verdict, source identity or cited support
is missing, the only honest result is no result.
