# Restoring words discards a draft whose origin survives empty text

Up: [postmortems.md](../project/postmortems.md).

Caught in the review of `eaf3a3fee`; no evidence this reached readers. Open a Debate claim in
Chat, clear the seeded question, leave Chat and return. The replacement draft lost the claim's
origin, so a newly typed question would create an ordinary chat instead of the claim's chat.

The class is **a restoration predicate that recognizes only one field of a richer draft**.
The origin store deliberately keeps provenance independently of the text; clearing the box
does not clear the origin. But the arrival rule only recovered a draft with nonblank words.
An empty local conversation disappeared with the band, and its replacement did not receive
the origin still held under the old id. The store preserved the field correctly while its
consumer skipped the operation that would move it.

`git blame` puts the text-only predicate in `0e3633def5`, before origins existed.
`eaf3a3fee` introduced this defect by adding independently persistent origin metadata without
widening that predicate. Existing tests covered clearing text in the store and moving a
handoff with its seeded words intact, but never combined clearing with the mode-change arrival.

The fix recovers the previous destination when it holds nonblank words **or a pending origin**.
The existing freshness check still permits recreation only for a draft known never to have
been submitted. The replacement receives the empty words and origin together through
`moveThread`; typing a new question then sends the retained origin.

The regression in
[conversation-band-origin.test.tsx](../../tests/conversation-band-origin.test.tsx),
`keeps a claim's origin on returning to Chat after the reader cleared the seed`, clears the
text, unmounts and remounts Chat, then checks both the moved origin and the eventual request.
Before the fix, its claim-origin expectation received `undefined`. The independent review run
after the fix passed all 14 tests in that file.

Countermeasures, ranked by ease against value:

1. **Exercise empty text through the consumer's restore path.** One cheap integration
   regression, added here. Store retention alone does not prove its consumer restores retained
   metadata.
2. **Review restoration and discard predicates when adding independently meaningful draft
   fields.** Those predicates must decide from the draft's whole meaning, rather than using
   one formerly sufficient field as a proxy for existence.
3. **Put the origin inside the text or prevent clearing the seed.** Rejected: readers must be
   free to replace the proposed question, and provenance remains meaningful when the composer
   is empty. Coupling those values would conceal the missing restoration rule.

The durable fix keeps text and provenance independent, while making restoration recognize
both. Adding a field to storage is incomplete until the lifecycle that carries it can see it.
