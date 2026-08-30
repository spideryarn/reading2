CHANGES REQUESTED — four defects found.

1. Medium — Force folding is unreachable. Confirmed by code reading.

[diagram-d3.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram-d3.ts:303) hard-codes every Force node to `hasChildren: false` and `collapsed: false`. Both keyboard toggle branches require `hasChildren` at [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:776). With Tree’s chevron removed, `toggle` is dead, ArrowRight cannot enter a child, and Force never exposes `aria-expanded`. The claim that ←/→ preserves collapse is false.

2. Medium — Force can still show no picture and no explanation. Confirmed path; reachability supported by existing root-only article fixtures.

When a graph contains only its root, [layoutForce](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram-d3.ts:179) returns a non-null layout with zero nodes. The panel therefore takes the SVG branch at [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:1069), bypassing `Waiting`, and draws an empty SVG. Root-only trees are an acknowledged stored shape at [store-shelf-reads.test.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/store-shelf-reads.test.ts:329).

3. Low — unusable trees still trigger the default’s paid call. Confirmed by code reading.

Force is now the default, but [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:432) enables `useSimilar` solely from `kind`, before the `root === null` message. The hook then POSTs at [useSimilar.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/useSimilar.ts:81). Thus opening Diagram on an unusable tree buys embeddings and displays “Reading … related passages” above “nothing to draw.” Gate paid hooks on usable/drawable input.

4. Low — the step bar misnames mixed-depth Force rungs. Confirmed by code reading.

`unit` uses the layout’s maximum depth at [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:593), while `stepStops` chooses a node independently for each row at [diagram.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram.ts:577). Supported mixed articles contain both depth-1 parts and depth-2 sections ([test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram-force-links.test.ts:189)), so every button can say “section” even when its destination is a part. Restoring collapse makes this more common.

Also, the removal sweep is incomplete: current statements still say “four/six pictures” in [security-map.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/security-map.md:114), [performance.md](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/project/performance.md:293), and [DiagramPanel.tsx](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/DiagramPanel.tsx:420).

Other conclusions:

- `nodesOf` is honest: `stepStops`, `nodeAt`, and `siblingRuns` do not read geometry.
- The current tree—not the pasted diff—guards hypothetical Force null layouts from projection-specific copy.
- The new panel tests meaningfully cover loading/fallback removal, but not error, ready-empty, collapse, or mixed units.
- The clean no-fourth-picture way to avoid the default charge is Force’s free base graph plus an explicit “add semantic links” action. That is a product trade-off, not itself a defect.

Focused result: 223 tests passed. Full `npm test` was blocked by the read-only sandbox’s Vite temporary-file write. Direct typechecking found two unrelated errors in `tests/sketch-scene.test.ts`.

