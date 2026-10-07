# Repeated reader failures need occurrence identity

Up: [postmortems.md](../project/postmortems.md) ·
stage: [261007a](../plans/261007a-seventh-sweep-client-tier-0-six-defects.md)

The write-capable review of `02e4de13e` reproduced two related mistakes. These fixes and
trade-offs are the reviewer’s, following the orchestrator’s stage brief; they are not product-owner decisions.

## A sentence used as the identity of an event

Illustrated asks the Sketch’s readiness again after a refused start. No job is created, so no job
id changes. `8d619a060` interpolated a failure object already introduced by `46439f1c2`:
every object became `[object Object]`. `02e4de13e` replaced that with its message, but two distinct
refusals with identical words still collided. Its test explicitly accepted that collision.

Class: **event identity collapsed into message contents**. A content change is not an occurrence.
The review test changes the Sketch’s readiness between identical refusals: the committed stage
makes two Sketch reads rather than three and never discovers the new readiness.

The local fix counts refused starts in `useIllustrated`, shared by its three start verbs. Accepted
jobs retain the existing job-id/message triggers. A shared job-engine event counter would be a
possible longer-term home if another consumer needs this distinction; it is unnecessary here.

## Retrying a read also repeats its reporting side effect

Metadata’s four timed retries arrived in `134376afd`. `02e4de13e` changed its failure formatter to
`describeFetchFailure`, which reports unauthored exceptions. Five identical failed reads therefore
make five reporting calls. The test reproduced all five while the reader saw the same page-fault
sentence. It counts reporting calls, not delivery to Sentry after SDK filtering.

Class: **retrying work repeats incidental side effects**. Describing a failure and reporting it are
coupled, so a read retry repeats both.

The local fix reuses the last consecutive failure’s description for this slug, comparing error
constructor, message and transport branding. Success or a new article resets it; a different
failure is described and reported anew. This bounds repeated automatic reports without changing
the shared formatter’s contract. It deliberately does not distinguish separate code defects
that throw the same class and message during one consecutive failure sequence.

## Countermeasures, ranked by ease against value

1. **Test repeated identical outcomes**, not only different wording: implemented for Illustrated,
   with visible readiness checked as well as GET counts.
2. **Count reporting calls while exercising every retry**, not only the displayed sentence:
   implemented for Metadata, with a companion test for changed and authored failures.
3. **Give the producer an occurrence identity when multiple consumers need one**: potentially
   useful for jobs, rejected here because only Illustrated needs this local start-refusal count.
4. **Separate classification and reporting throughout the client**: a broader design option,
   rejected for this stage because changing every caller is unnecessary to stop these five reports.
