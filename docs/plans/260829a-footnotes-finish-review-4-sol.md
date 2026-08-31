Verdict: **BLOCK**. Seven is not the closed list. There is an eighth unhandled consumer, and diagram mode itself is still only partly fixed.

## Blockers

1. **The reader-facing structural counts still absorb the apparatus.**

[`articleStats`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/stats.ts:40) counts every depth-1 and depth-2 node, including the supplement and its leaves. The shelf correctly excludes them via `supplementIndex` in [`library-scalars.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/library-scalars.ts:102).

My probe over two body parts plus two notes produced:

```text
reader: 3 parts, 2 sections
shelf:  2 parts, 0 sections
```

The wrong figures appear in the [masthead](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Masthead.tsx:124), [metadata page](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/Metadata.tsx:580), and [public page](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/PublicPages.tsx:76). `depth` can also be inflated when the supplement subtree is deeper than a shallow body tree.

This is the eighth consumer.

2. **Diagram membership is fixed, but diagram scale still includes the apparatus.**

Force still builds its prefix and `totalWords` from every block in [`graph.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:323). [`layoutForce`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram-d3.ts:200) divides body-node positions by that total.

With 200 body words and 1,800 note words, two body nodes landed at y≈35 and y≈54 in a 420px picture. The notes are no longer nodes or terms, but they compress the argument into the top of the panel.

Drift and Trail likewise use `blocks.length` as their denominator in [`scatter.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:420). Consequently:

- Drift leaves apparatus-sized blank space and still draws its reader-position line inside the notes via `nowY`.
- Accessibility labels count body paragraphs against body-plus-notes: “paragraph 2 of 4” for the final body paragraph.
- Trail’s progress colour does not reach the final step. My final body point reached 3/8 rather than 8/8.

The new graph tests check node membership and terms, but not `totalWords` or layout geometry ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram-graph.test.ts:648)). The scatter tests check only Trail brightness ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/scatter.test.ts:476)); Drift and the denominators remain uncovered.

3. **The scatter fix handles trailing apparatus only.**

For the supported trailing-note shape, stopping at `lastBody` preserves the tiling guarantee exactly: short or unembedded body blocks remain covered through the final body row.

But [`splitBlocks`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/supplement.ts:114) explicitly permits the stranded-note fallback, where a supplement occurs mid-article and no supplement node is built. In that shape, the intervals between dots still cover the note. My probe placed a note between body points and Trail lit three body-chain links while the reader stood on that note.

At minimum, reader-position lookup must first reject `!isBody(blocks[at])`. A contiguous range cannot itself represent a body interval with an apparatus hole.

## Closed consumer inventory

| Consumer family | State |
|---|---|
| ToC generation, labels, tree validation, flat ToC | Handled |
| Summary generation and root-summary reattachment | Handled |
| Arc, glossary, ideas and tweets | Handled |
| Embedding, similarity and projection point selection | Handled for membership |
| Fisheye, `?at=`, keyboard navigation and arc cells | Handled through `navigableItems` |
| Spine | Handled: one proportional, dimmed band |
| Outline mode | Handled: one unnumbered row, no descent |
| Summary mode | Handled: one unnumbered row, no missing-summary warning |
| Diagram Tree | Handled as explicit structure |
| Diagram Force, Drift and Trail | **Partial; blockers above** |
| Shelf words/parts/sections | Handled |
| Reader/public metadata counts | **Not handled—the eighth** |
| Search, chat, explain, prose and note previews | Intentionally include apparatus when explicitly requested |

Storage, hashes and DTOs are pass-through machinery rather than interpretations; they preserve the fields needed by the consumers above.

## Predicate answers

`!isBody(b)` is the right predicate for graph terms. Terms are block evidence, so block treatment is authoritative. A supplement index would be weaker: the documented stranded fallback has supplement blocks but no supplement node.

Stopping the last dot at the last body block is also correct for the normal trailing-apparatus shape and does not break short-body-paragraph tiling. It simply does not solve non-trailing apparatus, Drift’s independent `nowY`, or the full-array scale denominators.

So, explicitly: **seven is not all of them, and the current list is not yet closed as handled.**

