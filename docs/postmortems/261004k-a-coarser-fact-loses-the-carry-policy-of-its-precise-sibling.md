# A coarser fact loses the carry policy of its precise sibling

Up: [postmortems.md](../project/postmortems.md)

Stage 1 review of [261004h](../plans/261004h-year-only-publication-dates-journal-and-date-for-visitors-and-the-registry-backfill.md)
found F7: **Read this could lose a minimal paper's confirmed publication year**. No reader impact
was reported. The defect was introduced by `698c9052d`, confirmed by `git log -S` and blame on
`withRegistryFacts` in [article-registry.ts](../../src/article-registry.ts).

## Precision-asymmetric carry

[`keptPaperMetadata`](../../src/pipeline.ts) preserves confirmed facts while reading the same
minimal paper in full. The new year followed the day through that function, but not through the
registry merge that followed it: a carried day counted as existing evidence; a carried year was
removed before considering the new record.

A local reproduction supplied `publishedYear: 2011` and an agreeing Crossref record with neither
day nor year. The result was `outcome: "agreed"`, with no `publishedYear`. The equivalent input
with a carried day retained that day. Matching the article's identity had been treated as permission
to replace every fact, even where the successful response supplied no replacement.

The class is **precision-asymmetric carry**: two representations of one fact receive different
merge policies because the newer representation is treated as disposable enrichment. The day is
the sibling that exposes the difference here; the audit found no other instance in this stage.

## Why nothing went red

The existing extraction tests exercised a registry outage during the minimal-to-full transition,
and all five passed during review. An outage returned the carried metadata unchanged. They did
not exercise an agreeing but incomplete response, the branch that removed the year. The database's
day-or-year check also accepted the result: it prevents contradictory facts, not missing ones.

## The fix and the countermeasures

The narrow fix retains a valid carried year when the new agreeing record supplies no usable date.
A new valid year or whole day still wins. This is also the appropriate long-term merge policy:
absence of replacement evidence must not erase a fact deliberately preserved by the caller.
Ordinary re-extraction still asks afresh because it does not carry the old year into this merge.

Ranked by ease against value:

1. **Test incomplete success alongside outage and complete success whenever facts are merged.**
   Cheap, and directly catches this class. The review adds a registry unit regression and a real
   extract-step regression in [article-registry.test.ts](../../tests/article-registry.test.ts) and
   [article-registry-pipeline.test.ts](../../tests/article-registry-pipeline.test.ts).
2. **Compare the preservation cases across sibling precisions.** A small test matrix catches a
   policy that preserves a day but loses a year, beyond merely proving both fields round-trip.
3. **A new publication-date abstraction across every consumer — rejected for this fix.** It would
   broaden the stage without ensuring that an incomplete successful response preserves evidence;
   the merge regression provides that guarantee directly.
