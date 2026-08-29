Verdict: **BLOCK**.

## Blocker: Diagram mode still absorbs apparatus into the argument

Diagram is the seventh projection. The anchor-edge fix covered only one edge family.

- Force walks the new childless Notes node as an ordinary leaf, reads its prose into TF-IDF, and adds it to the reading-order chain: [graph.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:325), [graph.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:467).
- The root’s term vector also includes every note because its range spans the apparatus: [graph.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/graph.ts:334). The plan explicitly identified this consumer: [footnotes.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/plans/footnotes.md:280).
- Drift and Trail correctly receive no note points, but their last body dot is stretched through `blocks.length - 1`: [scatter.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:243). Consequently a reader inside Notes is shown as standing on the final argument paragraph; Trail also brightens that paragraph’s chain position: [scatter.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:573).

My probe produced:

```text
Force sequence: s1 -> s2 -> notes
root terms: apparatus, note, body, ...
last body dot range: [1, 3]   // rows 2–3 are notes
nodeAt(note row): final body paragraph
```

The summary fix itself is correct:

- Ordinary siblings receive exactly one increment each; supplements receive none. No valid tree produces duplicates or an off-by-one.
- `currentEntryId` stops on the childless Notes row correctly.
- `showsChildren` and the panel rendering agree.
- Outline already handles supplements separately.

Add independent supplement cases to `diagram-graph.test.ts` and `scatter.test.ts`. At minimum, prove note vocabulary cannot enter graph terms or its sequence, and that a note row cannot resolve to the last body dot.

I could not rerun Vitest because this read-only environment prevents Vite writing `node_modules/.vite-temp`; the direct Node probe succeeded.