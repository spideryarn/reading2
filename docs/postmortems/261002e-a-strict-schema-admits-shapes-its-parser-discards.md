# A strict schema admits shapes its parser discards

Up: [postmortems.md](../project/postmortems.md) · Change:
[261002e](../plans/261002e-summary-sentences-point-at-their-passage.md).

Caught in code review; no reader incident established. Commit `28f99cdf1` added
summary sentences to the live answer schema, but allowed an empty sentence list
and blank sentence text. Both shapes pass constrained decoding and are discarded
by `keptSentences` / `toParagraphs` in `src/simple-summary.ts`. Losing enough
paragraphs can spend a validation retry or fail the whole orientation.

## The class: the decoder permits what the reader necessarily discards

The schema stated types, required fields and nullable ids, but omitted the
reader's nonempty invariants. The provider subset can express both:
`minItems: 1` and a non-whitespace string pattern. Defensive parsing remains
necessary; it is not a substitute for constraining live output.

The root cause was checked independently in the review's `schema_root_cause`
subagent. Preexisting siblings are the unconstrained `paragraphs` and `ids`
arrays, introduced in `de5015eed8`; those were reported, outside this patch.

## Why nothing went red

The schema test checked required keys, the nullable id and closed objects.
Parser tests demonstrated that malformed answers were dropped. The model stub
does not enforce the schema, so these two sets of passing tests did not show
that the live decoder excluded answers the parser could never use.

## Fix and evidence

The working-tree fix adds `minItems: 1` to `sentences` and `pattern: "\\S"`
to its `text` field. Two new tests in `tests/simple-summary.test.ts` failed on
the candidate before the fix, then passed. Blank cases include empty text,
spaces, newline/tab and a nonbreaking space; actual words remain permitted.
The tolerant parser and stored-row fallback are unchanged.

## Countermeasures, ranked by ease against value

1. **Test the schema's unusable boundaries** — implemented for the new fields;
   cheap, and the tests were seen red before green.
2. **Compare new schema fields with parser rejection conditions** — low cost;
   the existing [strict-output rule](../project/prompting-guide.md#what-the-model-writes-back)
   already requires this, so no new policy is needed.
3. **Add a generic validation dependency** — rejected for this fix. The shared
   provider-subset validator already accepts these constraints; another validator
   cannot infer a missing semantic requirement.

The long-term fix is to keep expressible live invariants in the schema while
retaining defensive parsing at storage boundaries. I would check rejected shapes
alongside accepted shapes whenever adding a field to a constrained answer.
