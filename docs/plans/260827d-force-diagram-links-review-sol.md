# Verdict: NO-SHIP

The reading-order idea is sound, but the paid route, semantic candidate selection, anchor resolution, arrow geometry, and link typing are not safe or specified tightly enough to build as written.

1. **HIGH — The reading-order algorithm works, but its required invariant and tests are underspecified.**

   - **What is wrong:** “Deepest drawn” must mean “non-root drawn node with no drawn child,” not merely `depth === MAX_DRAWN_DEPTH`. The plan’s one collapsed-part fixture does not cover mixed-depth leaves, truncation, root collapse, or cross-part transitions.
   - **Evidence:** `walk()` is preorder, retains a collapsed node, and stops at the draw ceiling (`src/web/diagram.ts:383`, `src/web/diagram.ts:411`). `buildSummaryTree` preserves stored child order (`src/web/tree.ts:324`), while tree construction enforces children tiling their parent in block order (`src/toc.ts:325`). Therefore `startRow` order is guaranteed for valid trees. The plan only names one collapsed case (`docs/plans/260827d-force-diagram-links.md:164`).
   - **Concrete change:** Define the chain explicitly as non-root entries with no child among the drawn entries, sorted defensively by `startRow`. Test: collapsed L1, a mixture of L1 leaves and L2 children, a depth-2 node with hidden depth-3 children, cross-part transition, and collapsed root. Assert strictly increasing `startRow`, every selected node once, and exactly `n-1` edges.

2. **BLOCKER — The proposed arrow shortening can reverse the arrow.**

   - **What is wrong:** With source radius `rs`, target radius `rt`, and centre distance `d`, the proposed path has signed length `d - rs - rt - 6`. If `d < rs + rt + 6`, the line reverses and `orient="auto"` points the arrow back toward the source. At `d = 0`, the direction vector is undefined. `r+5` is also meaningless until the marker’s `refX`, dimensions, and `markerUnits` are fixed.
   - **Evidence:** The plan specifies `r+1` and `r+5` without an overlap rule (`docs/plans/260827d-force-diagram-links.md:44`). The current layout explicitly accepts residual overlaps (`src/web/diagram-d3.ts:119`); collision strength is below 1 and positions are subsequently clamped without rerunning collision (`src/web/diagram-d3.ts:250`, `src/web/diagram-d3.ts:259`).
   - **Concrete change:** Implement one tested `circleEdgePath` helper. Specify a user-space marker with its tip exactly at `refX`; calculate offsets from that geometry. When the available segment is non-positive, suppress the straight arrow or draw a displaced curve—never emit an inverted segment. Test separated, touching, overlapping, and coincident circles.

3. **BLOCKER — The anchor scan does not reproduce browser/stage-3 resolution.**

   - **What is wrong:** A simple per-block string index cannot truthfully claim the same result as `internalTarget`. It must handle duplicate IDs globally, ID-before-name precedence, first-in-document order, percent-decoding, malformed `%`, bare `#`, nested link text, and block IDs separately. A normal `Map.set` scan would make the last duplicate win. `CSS.escape` is irrelevant to a string-key index.
   - **Evidence:** Stage 3 deliberately resolves all IDs before names and keeps the first occurrence (`src/blocks.ts:784`). Click-time resolution rejects bare `#`, decodes the fragment, gives IDs precedence over names, and catches selector failures (`src/web/internal-links.ts:44`, `src/web/internal-links.ts:77`). Also, the claim that every smaller ID survives untouched is false: DOMPurify deletes clobber-prone IDs, which is why stage 3 stamps them before sanitisation (`src/blocks.ts:503`).
   - **Concrete change:** Parse all block HTML as one ordered DOM and extract anchors structurally. Build first-wins ID and name indexes in separate passes; resolve raw then safely decoded fragments; reject empty fragments. Reuse a shared fragment-decoding/resolution helper rather than independently approximating `internalTarget`.

4. **HIGH — Anchor edges need aggregation and a density bound.**

   - **What is wrong:** Dropping self-links does not control footnote traffic. Footnote markers and back-links can create many edges between a references section and prose sections, including duplicate or reciprocal links between the same drawn-node pair. The corpus measurement of five links does not establish a bound.
   - **Evidence:** The plan only drops same-node links (`docs/plans/260827d-force-diagram-links.md:94`). Existing resolution explicitly treats inline footnote targets as ordinary internal destinations (`src/web/internal-links.ts:28`).
   - **Concrete change:** Canonicalise and aggregate by drawn-node pair, preserving direction, count, and a bounded sample of link texts. Add a global edge cap and a per-node degree cap after collapse mapping. Decide explicitly whether recognised footnote back-links are excluded or displayed as an aggregated relationship.

5. **BLOCKER — Per-block top-K cannot reliably produce the client’s global top handful.**

   - **What is wrong:** Raw cosine scores remain comparable within one model/article; the problem is censoring. If server-side `K < MAX_SEMANTIC_EDGES`, a globally top-ranked pair can be absent because both endpoints had `K` stronger incident pairs. Mapping afterward makes this worse: same-node pairs consume the server’s K and are then discarded. Directed duplicates are also unspecified.
   - **Evidence:** The server returns each block’s top neighbours, while the client subsequently collapses, globally sorts, and truncates (`docs/plans/260827d-force-diagram-links.md:105`, `docs/plans/260827d-force-diagram-links.md:119`).
   - **Concrete change:** Since all pair scores are computed anyway, canonicalise undirected pairs and return a globally ranked, bounded candidate pool with deterministic tie-breaking. Oversample relative to the displayed limit, then map/dedupe/cap on the client. If degree coverage is desired, apply that policy after node mapping instead of mixing per-block K with a global final cut.

6. **BLOCKER — `|i-j| ≤ 1` does not remove reading-order duplication.**

   - **What is wrong:** Reading-order edges join drawn sections, not adjacent blocks. Paragraphs several rows apart can belong to consecutive drawn sections, survive the block-index exclusion, and recreate the thick sequence edge as a dotted semantic edge. Under collapse, the relevant adjacency changes again.
   - **Evidence:** The plan excludes only adjacent block indices (`docs/plans/260827d-force-diagram-links.md:115`), while the proposed chain operates over deepest drawn nodes (`docs/plans/260827d-force-diagram-links.md:33`).
   - **Concrete change:** After mapping block pairs to the current drawn nodes, discard both same-node pairs and any node pair already connected by a `sequence` edge. If section-aware filtering moves server-side, include the tree/structure hash in that cache key.

7. **BLOCKER — The proposed extraction copies an eval client that is not production-safe.**

   - **What is wrong:** `embedBatch` checks response count and missing slots, but not duplicate/out-of-range indices, dimensions, finite values, zero norms, timeout, abort, or `Retry-After`. It also throws the raw provider body; `handleApi` returns unexpected error messages directly to the client.
   - **Evidence:** Current validation stops at length and missing entries (`evals/embedding-retrieval.ts:418`). The semantic-search plan already records the additional mandatory production checks (`docs/plans/260826n-semantic-search.md:238`). The router exposes thrown messages in its JSON 500 response (`src/routes.ts:2848`).
   - **Concrete change:** Extract shared transport primitives only after adding exhaustive response validation, an abortable deadline, bounded jittered retries honoring `Retry-After`, and a scrubbed application error. Normalise every vector once, then use dot products; do not recompute both norms for every pair as the eval’s cosine currently does (`evals/embedding-retrieval.ts:466`).

8. **BLOCKER — The paid GET and memory cache are neither bounded nor dependable.**

   - **What is wrong:** A GET causes external spend, while the cited `useIdeas` pattern uses GET only to read an artefact—the model call is a separate write operation. Concurrent cold requests can embed the same article repeatedly. A module cache coalesces nothing unless it stores the in-flight promise before the first `await`; it does nothing across serverless instances; and slug+hash entries grow without bound across articles and revisions. The plan’s word “bounded” is false.
   - **Evidence:** The route is a paid `GET` (`docs/plans/260827d-force-diagram-links.md:105`); the plan calls the cost “bounded, cached” (`docs/plans/260827d-force-diagram-links.md:175`). `useIdeas` explicitly separates its GET read from the job that performs the model call (`src/web/useIdeas.ts:1`). Fluid Compute serves concurrent requests in one instance (`docs/project/logging.md:689`), while process-local state cannot guarantee reuse across instances.
   - **Concrete change:** Make generation a POST. Coalesce identical in-flight work with a promise cache and evict failures. Add a bounded LRU/TTL, block-count ceiling, total text/token ceiling, per-input ceiling, and rate limit. Either persist the compact ranked-pair result—pgvector is not required for that—or state and budget for the worst case where every invocation is cold.

9. **BLOCKER — The plan never specifies how late semantic edges change the physics.**

   - **What is wrong:** Painting dotted paths after the request completes will not change the diagram’s shape, which is the experiment’s stated purpose. To affect shape, the edges must enter `ArticleGraph` before `layoutForce` runs its 300 ticks, causing a second layout when the request resolves. Strength and distance are undefined for both new edge kinds; the current fallback would accidentally treat them like vocabulary edges.
   - **Evidence:** The plan says the edges arrive after the initial picture (`docs/plans/260827d-force-diagram-links.md:124`). The graph and layout are currently synchronous memos (`src/web/DiagramPanel.tsx:251`); `layoutForce` constructs its simulation exclusively from `graph.edges` (`src/web/diagram-d3.ts:222`). `DiagramPanel` does not even receive a slug yet (`src/web/DiagramPanel.tsx:69`).
   - **Concrete change:** Specify the data flow: pass `slug`, fetch only when `kind === "force"`, guard stale responses, map pairs into an augmented graph, and rerun Force once when they arrive. Define exhaustive distance/strength rules for all five kinds and test that semantic arrival changes node coordinates, not merely line count.

10. **HIGH — Optional `DiagramLink.kind` leaves the exact compiler trap this refactor should remove.**

   - **What is wrong:** Optional `kind` permits a new Force edge to omit its relationship kind without a type error. Keeping required `depth` also preserves the overloaded field. The plan misses that Arc already uses `depth` as a weight bucket, not depth.
   - **Evidence:** `DiagramLink.depth` is currently required (`src/web/diagram.ts:185`); Arc assigns it from similarity weight (`src/web/diagram-d3.ts:400`); the panel emits only the depth class (`src/web/DiagramPanel.tsx:489`). The plan proposes an optional discriminator (`docs/plans/260827d-force-diagram-links.md:140`).
   - **Concrete change:** Use a required discriminated union or separate link types. Graph links must require `kind: parent | sequence | anchor | vocabulary | semantic`; tree links can carry `depth`; Arc links can carry an explicitly named `weightBand`. Render classes through an exhaustive switch. Also correct the plan’s counting: it adds two kinds to three existing kinds, yielding five, not four.

No files were changed.