# A marker kept after its target was dropped

A new reader's first article, 2026-10-10: Romans 1:18-32 from Bible Gateway
(`passage-spya-p0gb4y`). The verses were full of `(A)`, `(B)` … `(W)`, drawn in the link colour,
with no hover card and a click that did nothing. Greg, 2026-10-11:

> It was confusing to the user, and I wondered if something was broken.

Parent: [postmortems.md](../project/postmortems.md).

## What happened

Each `(A)` is Bible Gateway's cross-reference marker,
`<sup class="crossreference">(<a href="#cen-NIV-27949A">A</a>)</sup>`, pointing at
`<li id="cen-NIV-27949A">` in a "Cross references" list after the passage
(`Romans 1:18 : Jn 3:36; Ro 5:9; …`). Read out of production (read-only): the stored article kept all
23 markers and none of the 23 targets. Readability had dropped the list — it is all links, and it
sits *beside* the passage's own `<div>`, not inside it — while the markers, being inside ordinary
verses, survived. So every marker named an id nothing in the article answered to, and the reading
view did exactly what [links.md § The one destination we can show](../project/links.md#the-one-destination-we-can-show)
says it does with such a link: no card, because `internalTarget` returns null, and no jump.

## Root cause

[`src/notes.ts`](../../src/notes.ts) exists to rescue precisely this — a footnote system whose notes
Readability would throw away — but it recognises publishers one at a time, and Bible Gateway was not
one of them. Underneath that, there is no check anywhere in stage 2 that an in-article `#fragment`
the extracted article still contains still has a target. A marker and its target are removed by
different rules (Readability's link density and sibling scoring for one, nothing for the other),
so they can part company silently, and the result looks like a working link.

A second fault was found on the way: once the new shape was recognised, the notes container was
still lost. `canonicaliseNotes` appended it to the common ancestor of the markers *and* the notes,
which here is one level above the passage — outside Readability's top candidate, so it was dropped
in turn. Introduced with the container in `2ba408a32` (2026-08-28), and harmless until a publisher
put its notes list beside the prose rather than inside the same wrapper.

## The class

**A reference that survives the pass which removed its referent.** Two halves of one link are
filtered by different rules, and nothing checks that both made it through. The same shape as a
signpost committed before the thing it points at, inside one document.

## The fix

- Shipped: a fifth shape in `ANCHOR_SHAPES` for Bible Gateway's cross-references and footnotes
  (`sup.crossreference` / `sup.footnote` → `li#cen-…` / `li#fen-…` in `.crossrefs` / `.footnotes`),
  without the round-trip requirement — its back-link aims at the verse, and the first verse after a
  heading has no id of its own. Its authored verse links keep their text and return to the citing
  marker. For Bible Gateway alone, the container goes at the end of the element that holds the
  markers; other publishers and mixed systems retain the common ancestor of markers and bodies,
  promoted to a structural container. Extraction is byte-identical on all 39 committed fixtures,
  including the six with notes, measured on the shipped version.
  `tests/notes-biblegateway.test.ts` was red first.
- Right for the long term: the same, plus the general check below, because the next publisher with
  a shape we do not know will produce the same dead links.

The existing article is not repaired by this: it needs re-importing (or a re-extract) to pick it up.

## What review caught before this shipped

Moving every publisher's notes into the markers' wrapper changed Readability's scoring. A single
Gwern marker in an opening div, a long external note, and genuine prose in a sibling div made
Readability select only the opening div: the note survived while both later paragraphs disappeared.
The fixture comparison missed this topology. **Candidate-score contamination from moving content
before extraction** is the class; the narrower placement now applies only to Bible Gateway.
The real-pipeline regression in `tests/notes-canonical.test.ts` was red before that correction.

The matcher also accepted arbitrary `fen-history` ids and mismatched marker/list kinds without a
round trip. Recognition now requires a translation, numeric verse and letter suffix, with
crossreference/cen/crossrefs and footnote/fen/footnotes agreeing. Six synthetic negatives were red.

Finally, the first note's authored "Romans 1:18" link still landed on the heading. The test followed
only stamped links, so a synthesised arrow hid that wrong destination. An assertion following every
authored verse link went red; the fix preserves those links' words and aims them at the citing marker.

## What would have caught it, ranked by ease against value

1. **Unwrap or flag a dangling in-article fragment at the end of stage 2** — an `<a href="#x">` with
   no `x` left in the extracted html. Unwrapping keeps the text, so no block id changes, and a dead
   marker stops looking alive. Cheap, and it covers every publisher we have not met. Not done here:
   it changes what readers see on every article with such a link, which is Greg's call — proposed in
   the report.
2. **Count dangling fragments in the extraction eval** (`evals/extraction/corpus.mts`) — a number
   that would have been non-zero for this page the moment it was added. Cheap; worth doing with 1.
3. Recognise more publishers' note shapes ahead of need — rejected. It is the whack-a-mole the
   header of `src/notes.ts` warns about; 1 is the floor under it.
