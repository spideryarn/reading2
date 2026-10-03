# A fence covers the page but trusts the article label

Stage-2 review of [261003m](../plans/261003m-citations-influence-unknown-unless-confident-and-dig-deeper-fills-it-in.md),
2026-10-03. Root cause independently checked by the storage-review subagent. Introduced in
**a2e9977cd**, which added `citationInfluencePrompt` in `src/citation-influence.ts`.

The work's title, authors and year came from third-party article content but appeared outside
the prompt's untrusted region. The system rule and final reminder identified only web pages as
data. The boundary followed presentation: the citation label looked like our setup, though its
provenance was the article. The class is **third-party metadata promoted into instructions**.

The original request test required these fields to precede the web-results fence; its hostile
marker test attacked only page titles and extracts. It defended layout without inventorying the
origin of every string. The new metadata test failed because the work fence was absent, then
passed after title, authors and year went through `untrusted` together. The system rule and
reminder now cover both regions. `INFLUENCE_VERSION` is bumped so earlier assessments stop being
used, while their investigation answers remain visible.

That is also the lasting fix for this prompt: fence every third-party input, and retain the
source-index, title and quote checks. Fencing does not prove a quotation concerns the work.
A wider sibling remains reported, outside this stage: `src/citation-paper-passages.ts` also
places work context outside its paper-text fence.

## A second class: a settled race mistaken for a cancelled operation

The same commit described the influence call as settled before the answer starts. Its
`Promise.race` actually settles the wait; cancellation of the losing request depends on the
transport honoring abort. A deferred, signal-ignoring request reproduced settlement after the
allowance was released. The original test supplied a never-settling request but observed only
the wrapper's timeout result.

The review corrects the claim and preserves the bounded wait and abort signal. The retained test
shows the late result is ignored and cannot change the saved answer. Production's fetch receives
the signal; this review did not test provider-side cancellation or late metering. An unconditional
operation-lifetime guarantee would require evidence at that transport boundary, rather than
another assertion on the race's return value.

## Safeguards, ranked by ease against value

1. **Adversarial boundary tests, implemented here.** Put forged closing markers and instructions
   into the metadata; use a deferred transport to observe what remains after a timeout.
2. **Inventory provenance and lifetime at review.** Cheap: identify each third-party string and
   exactly which promise a timeout settles. These two defects shared a boundary narrower than its
   description.
3. **Real-transport abort and metering tests when changing the gateway.** More expensive, but
   required before claiming the actual request and its cost record always settle before release.
4. **Rejected: wait indefinitely for a transport ignoring abort.** That holds the press open when
   cancellation fails. The bounded wait is useful; the stronger claim was the defect.

Up: [Postmortems](../project/postmortems.md)
