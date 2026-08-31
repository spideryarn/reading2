No — one blocker remains.

## Blocker: ordinary figure prose can still be hoisted

The Gwern adapter accepts bare `fnref…` and `fn…` IDs without roles or classes ([src/notes.ts:264](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:264)). The shared body finder then accepts a `<p>` nested inside `<figure>` because `figure` is missing from `NEVER_INSIDE` ([src/notes.ts:235](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:235), [src/notes.ts:410](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:410)).

I reproduced this through Readability and block splitting:

```html
<a id="fnref1" href="#fn1">1</a>
<figure>
  <img ...>
  <p id="fn1">Ordinary figure caption... <a href="#fnref1">back</a></p>
</figure>
```

Result: the figure became empty and its caption moved into Notes as `shapes.gwern: 1`. No `role`, footnote class, or forged Spideryarn attribute was needed. The same generic promotion accepts prose inside `details`, `dialog`, `menu`, and `form`.

This contradicts the documented claim that Gwern recognition requires `doc-noteref` evidence ([260828o-footnotes.md:659](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:659)). It is also inconsistent with Tufte’s explicit figure protection ([src/notes.ts:540](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:540)).

Require stronger adapter-specific evidence/topology; merely extending the ancestor blacklist will remain whack-a-mole.

## The repair itself

- Preserved backlinks are safe. Their children move into the new `<li>` first, are mapped and stamped afterward, and only the empty source shell is removed ([src/notes.ts:759](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:759), [src/notes.ts:768](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:768), [src/notes.ts:789](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:789), [src/notes.ts:814](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:814)).
- Wikipedia’s plural backlinks are mapped and stamped consistently. I found no repair regression there.
- Duplicate fragment resolution now matches stage 3: first ID wins, then named anchors ([src/notes.ts:346](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:346)).

## Stable-ID measurements

My independent steady-state results:

- Substack migration: 78 blocks carried, 18 minted. Every citing block carried; only the 18 newly joined note blocks minted.
- Tufte migration: 58 carried, 10 minted—five changed citing paragraphs plus five new note blocks.
- Second canonical extraction: Substack 96/96 carried, Tufte 68/68 carried, zero minted in either.

That is minimal for the chosen one-`<li>` canonical shape and, importantly, one-time rather than recurring.

## New green mutation

Change the synthesized backlink’s `href` at [src/notes.ts:797](/Users/greg/Dropbox/dev/experim/spideryarn2/src/notes.ts:797) to `#missing`, or omit it.

The 50 tests still have no assertion on synthesized backlink destinations: the shared fixture assertion checks only the reported count ([notes-canonical.test.ts:282](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:282)), and the Tufte test checks existence and visible text only ([notes-canonical.test.ts:713](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/notes-canonical.test.ts:713)). Substack and Tufte return links would visibly stop working.

## “Ibid.”

Deferring the order-dependent suffix is still reasonable for stage 2 ([260828o-footnotes.md:701](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/260828o-footnotes.md:701)). It must become a stage-3 exit criterion before `noteId` backs persisted reader state; then wrong-occurrence reassignment becomes unacceptable.

Verification: targeted 50/50 passed; typecheck passed. The full suite initially had three unrelated concurrent failures, but both affected files passed independently.