# A local prefix is not a global namespace

Up: [postmortems.md](../project/postmortems.md)

Code review found this before the multi-page importer shipped, so nothing reached a reader. Page 2
renamed `id="target"` to `p2-target`; page 1 could already own that predictable name. The joined
document then had duplicate ids and stage 3's first-match resolver sent page 2's link to page 1's
prose. An ordinary page-1 id could preclaim a later stamped note id in the same way.

## The class: a local transform mistaken for global uniqueness

The code made every name *look* page-specific, but uniqueness is a property of the whole joined
document, not of the string transformation. Its collision sets contained stamped notes and callout
contexts, not every ordinary `id` and legacy anchor name. Direct tests of the prefix therefore
agreed with the implementation while the first-wins consumer exposed the bug.

Commit `cff6e504e` introduced it while implementing stage 2 of plan 261024p. The intent—keep dead
links dead and preserve the special note-id shapes—was right; the reservation boundary was not.

The shipped fix collects every anchor name from page 1, extends that set after each page, and gives
defined and unresolved later-page names the next free deterministic suffix. That is also the
long-term design: the join owns one allocator for the namespace it creates. Re-extracting the same
pages remains deterministic.

## What would have caught it, ranked by ease against value

1. An end-to-end adversarial test through `readParts` and `splitIntoBlocks`, asserting that a later
   link resolves to its own block despite a page-1 preclaim. Done.
2. Include ordinary ids in every collision fixture, not only the reserved shapes the feature was
   designed around. Done for ordinary, unresolved and note names.
3. Random prefixes were rejected: they make collisions unlikely, not impossible, and would make
   stable block ids change on re-extraction.

The thing I would tell myself: a prefix is a naming convention. It becomes a namespace only when
the owner of the combined document checks every name already in that document.
