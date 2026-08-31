DO NOT COMMIT AS-IS.

The four happy-path fixtures resolve, but there are three commit blockers: existing note block IDs are lost, duplicate IDs redirect notes incorrectly, and the recognition rule can remove ordinary content from the article.

## Blockers

1. Re-extraction orphans existing note annotations

The `spya-note-…` reasoning itself is sound: it does not match the anchored six-character block-ID pattern ([ids.ts:17](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ids.ts:17)), so stage 3 treats it as an author anchor and retargets it.

But stable block IDs are recovered from block text, not from `noteId` ([blocks.ts:317](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:317)). This implementation removes every original backlink and writes `↩` instead ([notes.ts:505](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:505), [notes.ts:545](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:545)).

I measured a before/after re-extraction using the old blocks as carry-over:

- Gwern: 0 of 34 note blocks kept their IDs.
- Wikipedia: 90 of 121 kept them; 31 were reminted.
- The citing paragraphs remain stable when their marker labels remain unchanged.

For Gwern, the sole relevant difference is the author’s `↩︎` becoming `↩`. The old glyph includes a variation selector that the folded key preserves, so even fallback matching fails.

This directly violates the repo’s primary ID contract and contradicts the plan’s instruction that Gwern and Wikipedia be “left alone” ([260828o-footnotes.md:594](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:594)). The later renumbering fix does not repair IDs already lost during this migration.

Preserve the existing backlink text/DOM for already-working shapes, annotating it in place. Canonical reconstruction is necessary for Substack and Tufte, not for every Gwern/Wikipedia backlink.

2. Duplicate IDs make a working link point to the wrong note

`indexTargets` claims browser semantics, but the `[id]` loop overwrites earlier entries ([notes.ts:210](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:210), [notes.ts:221](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:221)). Browsers and the existing stage-3 implementation take the first duplicate ID in document order ([blocks.ts:784](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:784)).

I reproduced:

- A marker linked to `#n1`.
- Two paragraphs had `id="n1"`.
- The browser resolved the first.
- `canonicaliseNotes` moved the second and rewrote the marker to it.

Thus an existing correct link becomes confidently wrong. This is both a real CMS-malformation case and an easy hostile construction.

Use first-ID-wins, with IDs taking precedence over named anchors. This fragment-resolution rule should be shared rather than reimplemented.

3. Round-tripping is not a sufficient recognition rule

The guard only excludes certain target tags; it does not reject targets nested inside tables, navigation, headers, or footers. `TD` is explicitly accepted as a note body ([notes.ts:171](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:171), [notes.ts:178](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:178)), and `noteBodyFor` never checks excluded ancestors ([notes.ts:260](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:260)).

I reproduced two worse-than-no-op cases:

- A numbered link to a reciprocal `<td>` caused the table to disappear and its cell to be moved into Notes.
- A numbered link to reciprocal navigation prose caused that prose to be rescued from `<nav>` and dressed as a note.

A hostile page can therefore get ordinary prose stamped as apparatus without forging any reserved attribute. It merely supplies the topology that causes this code to mint the stamp.

For the measured-v1 scope, use explicit shape evidence—Gwern roles, Wikipedia reference markup, Substack component attributes, and Tufte classes—with round-tripping as validation. The current generic inference is broader and less safe than the brief.

## The supposed negative fixture is not negative

The plan and test say ar5iv has no footnote system ([260828o-footnotes.md:108](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:108), [notes-canonical.test.ts:279](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:279)). But the fixture contains two genuine LaTeXML footnotes marked `ltx_role_footnote`, including substantive note prose at [ar5iv.html:256](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/fixtures/ar5iv.html:256) and another at [ar5iv.html:617](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/extraction/fixtures/ar5iv.html:617).

This is the direct answer to “what real system does round-tripping exclude?”: LaTeXML’s inline footnotes, already present in the chosen negative fixture. They have no anchor round-trip and remain embedded in body prose.

Supporting LaTeXML can remain outside this four-shape stage, but the plan and test must stop claiming it has no footnotes. The current byte-identical test pins a known omission as correctness.

## Security assessment

The narrow claims are good:

- Reserved attributes are scrubbed recursively through templates ([notes.ts:196](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:196)).
- New IDs and attributes are constructed through DOM APIs.
- Raw descendants are moved, then the ordinary stage-3 sanitiser still runs ([blocks.ts:691](/Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:691)).
- I found no route for executable markup or an unsafe URL to bypass that sanitiser.

But two qualifications matter:

- Semantic forgery remains possible through false-positive topology, as above.
- `noteId` is hashed before `moveContents` removes `NEVER_ADMITTED` descendants ([notes.ts:511](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:511), [notes.ts:442](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:442)). Changing hidden `<script>`, `<style>`, or form text can therefore change a note’s identity while leaving its stored visible prose unchanged.

Strip forbidden descendants before computing the hash.

## Other stable-ID problems

The known marker-renumbering trap is not foreclosed: the minted attributes survive and give stage 3 enough DOM information for the planned control-node-aware key.

However:

- Tufte paragraphs newly acquire generated digits, so this stage makes them renumber-sensitive until stage 3 lands.
- Identical notes use order-dependent suffixes ([notes.ts:408](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:408)). Insert a new identical “Ibid.” first and every later identical note changes identity—or worse, the old identity now names a different occurrence. The test uses only unique prose and misses this.

## Tests

The targeted suite does pass: 34/34.

Strong tests:

- The four named prose journeys.
- Plural Wikipedia backlinks.
- The forged-stamp/template test.
- Exact Readability-output comparison for Gutenberg.

Weak or theatrical tests:

- Fixture-wide checks iterate only over already-minted markers ([notes-canonical.test.ts:98](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:98)). Any source note the detector misses is invisible to them.
- “Gathered into one container” proves only that one stamped container exists, not that every note was gathered ([notes-canonical.test.ts:207](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:207)).
- The stable-ID test checks only `noteId` equality in two fresh DOMs; it never runs block carry-over ([notes-canonical.test.ts:404](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:404)). It therefore missed the 34 Gwern and 31 Wikipedia block-ID losses.
- There is no nested/multi-block note test, despite the plan requiring note ranges.
- Ar5iv’s byte-identical test validates a false premise.

A definite green mutation: delete `back.textContent = "↩"` at [notes.ts:548](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:548). All 34 tests still pass, leaving every synthesized backlink invisible. Changing it to arbitrary garbage also remains green.

## Simplicity

The real over-build is not the raw line count; it is the universal anchor inference. It requires tag allow/deny sets, one-level body guessing, foreign-marker inference, common-ancestor placement, and pruning, yet still accepts tables/navigation and disagrees with browser fragment semantics.

The whole stage-3 anchor mechanism cannot be reused because it runs too late for Tufte. But fragment decoding and resolution are duplicated here, in `blocks.ts`, `internal-links.ts`, and `graph.ts`; that duplication has already produced the duplicate-ID bug. Extract the small shared rule, then keep four explicit pre-Readability adapters.

The Substack and Tufte fixes are good and evidenced. The generic recognition and rewriting of already-working shapes are what make this unsafe to commit.