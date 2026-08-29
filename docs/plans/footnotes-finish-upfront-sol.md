Verdict: **PROCEED WITH SMALL CHANGES.** All four fixes belong in v1. None needs a large redesign.

### F6 — require at least one child

Your smaller rule is correct. Add “a supplement has at least one child”; do not duplicate the stronger tiling rule.

Once a supplement has children:

- The generic parent invariant already requires them to tile its range exactly.
- Each child must be a leaf under supplement invariant 5.
- The generic leaf invariant already makes each leaf cover one block.

The one-note, childless supplement test is exactly the needed non-vacuous case. Treat this as strengthening invariant 5, not adding a seventh invariant.

### F5 — hard failure after `mergeLabels`

Throwing is right. An invalid tree is not a recoverable article representation; publishing it merely converts a visible pipeline failure into a silent reader-facing one.

The stranded-apparatus fallback remains valid: [`splitBlocks`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/supplement.ts:114>) returns every block as `body`, so `buildTree` still creates a full legacy tree over all blocks. `checkTree` should accept it.

For v1, use **one check after `mergeLabels` and before `checkCoverage`/writes**:

```ts
const tree = mergeLabels(structure, labelRun.labels);
assertTreeSound(blocks, tree);
checkCoverage(labelRun.labels, tree, blocks);
```

That checks the exact artifact being written, including labels. Leave the pre-label check for later; it would save money on a rare bad structure but adds a second guard that deserves its own mutation test. Correctness does not require it.

The set `buildTree` accepts and `checkTree` rejects is not empty: missing internal gists, empty titles, and false `sourceHeading` claims are examples. Those should fail stage 4.

One necessary safety correction: [`checkTree`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/tree-invariants.ts:249>) currently includes the author’s heading text in the `sourceHeading` problem. A thrown job error is logged, and article prose must not enter logs. Remove the quoted heading from that message before putting capped problem strings into the thrown error.

A red-first integration test should make `generateToc` produce a structurally invalid but buildable tree, then assert rejection and that the three final artifacts were not written.

### F7 — retain both identities, but avoid selector interpolation

Marking both notes is wrong. The highlight states where the reader actually came from, not every plausible route back.

I would make two small adjustments:

- Pass the `NoteMarker` as one value rather than passing `to` and `noteId` separately. That makes an impossible mismatch unrepresentable.
- Pass one `NoteReturn` object into `markReturnPath`, rather than two strings.

```ts
type NoteReturn = {
  from: BlockId;
  noteId: string;
};
```

Update all three marker-following paths—not only `TableView`: [`TableView.tsx`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/TableView.tsx:624>) and both calls in [`ProseHoverCard.tsx`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/web/ProseHoverCard.tsx:260>).

For selection, I prefer neither another regex nor `CSS.escape`. Query the fixed selector and compare raw attributes:

```ts
root.querySelectorAll(`a[${NOTE_BACK_ATTR}]`).filter(
  a =>
    a.getAttribute(NOTE_BACK_ATTR) === origin.noteId &&
    a.getAttribute("href") === `#${origin.from}`
);
```

That removes dynamic selector construction entirely.

One note cited twice in the same passage may still mark two identical back-links. Leave that for v1: both return to the same block, and Spideryarn’s navigation contract is block-level.

Keep the DOM unit test, but also update the mounted hover-card test so its recorded callback includes the note identity. Otherwise the selector test can pass while the UI wiring still drops it.

### F4 — conditional legacy framing works

Your argument closes the framing collision for valid trees:

- Legacy input without raw NUL/newline delimiters has a unique five-field/fixed-row decoding.
- Any input containing either delimiter takes JSON framing.
- JSON escapes those characters.
- The JSON and legacy canonical forms cannot be textually identical because legacy rows contain raw NUL field separators while JSON does not.

The remaining theoretical SHA-256/truncation collision is unrelated to framing.

`range.join("..")` is safe under the block-id contract because valid block ids contain no dots. Do not expand this patch to redesign the whole row shape.

### `hashBlocks` — fix it in the same patch

Yes, it has the same bug. Normal extraction collapses whitespace in [`extractText`](</Users/greg/Dropbox/dev/experim/spideryarn2/src/blocks.ts:156>), so ordinary generated blocks do not retain tabs or newlines. But imported blocks are still enough to make the collision reachable.

Route unclassified blocks to the v3 JSON form whenever an id or text contains tab/newline. This is a tiny adjacent fix and preserves every ordinary legacy hash.

Pin the actual old example hash:

```ts
expect(hashBlocks(bodyBlocks)).toBe("21189fa4eb0bceca");
```

Comparing the hash to a cloned copy is tautological and cannot detect accidental mass invalidation.

### Deferred work

- **PDF stage 6:** leave it. Greg cut it, and it is additive once the web representation is sound.
- **Stage 3b carry-over key:** acceptable to defer from v1, but it is the highest-priority follow-up. Adding or renumbering notes during re-extraction can remint passage and note block ids, orphaning comments and saved positions. Do not claim footnote identity survives re-extraction until 3b lands.

All proposed fixes can be tested red-first. The only extra tests I would insist on are the F7 wiring check and a literal compatibility pin for `hashBlocks`.