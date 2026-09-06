# A tolerated page-label error reordered the article

The published Kuhn paper moves PDF pages 50 and 51 into its opening section and joins unrelated
paragraphs across those moves. Greg reported the apparent missing section on 2026-09-06. The
bad order already exists in the saved extraction HTML, before stable IDs or the reading view.
The [plan](../plans/260906g-pdf-ingestion-preserves-the-complete-article.md) holds the measured
block-to-page boundaries and the implementation status.

## A quality exception became permission to change identity

The model returns both the transcription and the page it claims each record belongs to. Chunk
boundaries come from the PDF; those are authoritative. `runPdfExtract` checks the model's claims
against them, but an unsuccessful second attempt still enters the final output. The subsequent
global sort uses those same failed page claims as document order. `renderHtml` then honours
`continues` without requiring neighbouring pages.

The resulting sequence, 2 → 50 → 3 → 51 → 4, is consistent with a chunk containing context
page 49 being labelled by its local positions: 2 and 3 instead of source pages 50 and 51.
The failed raw responses were not checkpointed, so this particular choice of numbers is inferred.
The wrong order and the reachable mechanism are directly observed. Identifiable text exists
from every body page; that proves these large skips are principally reordering, not that every
sentence survived correctly.

The global sort was introduced in `f68a6016f274b8c744cd2fe0383407463db5eb0c` alongside a
strict pre-publication check. `1ed4407e4e8a7bd3087af9e4f86fdcf50638f60b`, on 2026-08-30,
changed failures into notes after genuine papers had been refused over sideways watermarks,
figure labels and maths. The product decision had real evidence behind it. The engineering
mistake was making identity failures and noisy content comparisons share that exception.

## Why success did not establish correctness

- A content recall of 0.981 over 140 pages says little about where those words will end up.
  Checks happen before the global sort and before paragraph joining.
- The coverage checker detected wrong or missing page claims, but its verdict was advisory too.
- Passing chunks were checkpointed, while failed chunks could still be published. A cache hit
  also skipped the fresh-read retry loop even when rescoring it failed.
- Detailed `Meta.quality` complaints were not a durable, reader-visible warning: the Postgres
  metadata columns and reader do not carry that field. The published recall remained plausible.
- The saved initial import attempts show extraction completing and hierarchy failing later.
  Repeated attempts are therefore not evidence that extraction completeness was ever established.

## The long-term fix

Page identity is a structural contract, independent of the tolerance for imperfect typography.
Validate it before a response becomes reusable or contributes to the article. Keep authoritative
chunk provenance through assembly; use bounded, smaller reads when the original chunk cannot
meet that contract, and report a page-specific failure if recovery is exhausted. Apply the same
rule to checkpoints read today, regardless of whether an older checker accepted them.

Rendering must require an adjacent-page or same-page continuation and must track the final page
of a joined paragraph. The final transformations need their own witnesses: certifying an earlier
representation does not certify the one the reader receives.

Implementation and red/green evidence are tracked in the plan; this account does not claim the
fix has landed before that evidence exists.

## Countermeasures ranked by ease and value

1. **Separate structural refusal from noisy quality notes.** Small, high value: page identity and
   substantive missing-page failures cannot share a blanket publish-anyway branch.
2. **Test the complete transformation with displaced source pages.** Cheap deterministic input:
   late pages claim early numbers, a continuation spans the gap, and the assertion reads final
   HTML rather than the intermediate score. Add the corresponding stale-checkpoint case.
3. **Recover only defective chunks and retain successful work.** Moderate implementation cost;
   improves robustness without buying the entire document again or increasing concurrency.
4. **Audit real source-to-output ordering.** A distinctive-fragment page map caught what a
   document-level recall number cannot. Use it as an eval witness, not a proof that every word
   or every two-column reading order is exact.
5. **Reject every old quality warning or switch OCR providers.** Rejected: the first repeats
   demonstrated false refusals; the second does not remove our willingness to trust a failed
   page claim. A larger concurrency limit addresses neither correctness nor this failure.

The lesson is to inspect what a relaxed check authorises downstream. A number that was merely
reported became a sort key. Once the code permitted the former to be wrong, the latter no longer
had a valid input contract.
