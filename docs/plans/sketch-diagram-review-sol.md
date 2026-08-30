## Verdict

Do not product-integrate this yet.

Keep the constrained JSON scene; raw SVG would add risk without proving better diagrams. But Sketch is an AI-authored argument map, not really a fifth peer of Tree/Force/Drift/Trail. Its cost, latency, interpretation, required width, and drill-down interaction are materially different.

## Findings

1. **P1 — Generation can write a completely empty artefact as success.** Missing `scenes` becomes `[]` with no fault, and `generateSketch` writes whatever survives without any acceptance threshold. `{"scenes":[]}` produces zero faults and `reach: 0.9`. `OVERVIEW_MIN/MAX` are prompt advice only. See [readSketch](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:472) and [generateSketch](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:429). This is the clearest silent-success blocker.

2. **P1 — Profile and staleness handling are missing.** The profile enters the prompt, but Sketch does not append `PROFILE_RULES`, record `profileHash`, or set `sourceHash`. It therefore cannot tell current from stale, or one reader’s map from another’s. See [renderPrompt](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:300), [Sketch](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:179), and the write path above. For v1 I would remove profile input entirely: document structure should be reader-independent. Otherwise copy Ideas’ full fingerprint/profile treatment.

3. **P1 — `readSketch` is not the validator its comments describe.**

   - Unknown enum values are silently defaulted, contradicting “survives intact or is dropped and counted” ([oneOf](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:225)).
   - Regions can still exceed the canvas: `x=750,w=100` survives on a 760-wide canvas, with no fault ([region reader](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:355)).
   - Empty node text, duplicate node/scene IDs, colon-bearing IDs, self-edges, unlimited strings/items, and missing titles all survive.
   - Clamping is defensible for diagnostic rendering, but not as product acceptance. `x=-1_000_000` is not a rounding error. Permit a small tolerance; reject the scene beyond it.
   - An unknown block may keep its node in the diagnostic picture, but any stale artefact should be rejected before validation rather than having its clicks progressively removed.

4. **P1 — `cleanPath` is injection-safe but not a parser.** The current case-sensitive change correctly rejects relative commands, but `M10 10 L100` still passes despite having an incomplete `L`. Command arity, arc flags/radii, closure semantics, and coordinate bounds are unchecked ([cleanPath](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:250)). Thus it can accept an invisible or malformed path. The alphabet prevents attribute/script injection; the remaining danger is confidently wrong geometry.

5. **P1 — The sixth renderer bug is vertical control-point overflow.** Only x control points are clamped. This accepted edge:

   ```text
   from a:top at y=5, to b:top at y=400
   ```

   produces `C150 -137.2 …`, leaving the canvas. The test named “nothing a curve draws leaves the canvas” checks only x ([painter](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:348), [test](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/sketch-paint.test.ts:163)).

   Other surviving painter errors:

   - Free paths ignore `arrow:"start"` and draw only the end of `"both"` ([paintPath](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:499)).
   - Arc arrow direction cannot be recovered by subtracting the final two numeric pairs.
   - A self-edge is routed through its own node and mostly disappears beneath it.
   - `nodeFits` and `wrap` disagree. A 60×20 `sm` node containing `supercalifragilisticexpialidocious` scores as fitting but renders as `superc…` ([linesNeeded](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:594), [wrap](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:107)).
   - End-aligned labels calculate available width to their right rather than left, so labels near the left edge can disappear off-canvas ([paintLabel](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-paint.ts:557)).

6. **P2 — `flow` computes Kendall tau correctly, but overclaims.** It measures ordinal y-order, not visible top-to-bottom flow. Nodes at `y=100`, `100.001`, and `100.002` score 1 while appearing on one row. Conversely, deliberately parallel premises sharing a row are penalized. It is blind to edge direction, visual traversal, spacing, crossings, and whether labels describe their linked blocks truthfully.

7. **P2 — `reach` is wrong for its stated definition.** It uses nodes from every zoom scene, although the overview is what the reader initially sees. Its gap arithmetic counts distance between marks rather than blocks with no mark: between indices 1 and 9 there are seven unlinked blocks, but it reports eight. With no nodes it reports 90% rather than 100%. Overlap is also pooled across scenes, so clean zooms can dilute a broken overview ([scoreSketch](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch-scene.ts:625)).

8. **P2 — The prompt is selecting from a menu more than demonstrating free composition.** All three reported results—funnel, ladder, spine—are named in the prompt, which then provides exact worked layouts. There is no raw-SVG or lighter-prompt comparison showing that these examples help rather than anchor. The hub instructions are internally inconsistent: satellites cannot proceed clockwise around a ring while always moving downward ([SYSTEM](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:91), [worked layouts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/sketch.ts:215)).

9. **P2 — Generate the overview first, not three scenes together.** At 125–145 seconds, streaming character counts does not help: no JSON is usable until the entire response finishes. Return the overview, then generate a zoom only when requested, reusing the cached article prefix. That shortens the first wait and avoids paying for two zooms most readers will never open.

10. **P2 — The interaction contract is unresolved.** The prompt encourages one node to carry both `block` and `opens`, but the plan assigns click to both jumping and opening. Keyboard Enter is specified as jump, with no keyboard operation for opening. Model item order is also not guaranteed to match spatial reading order. `?scene=<model-id>` is stable only until regeneration; after that it can silently select another scene or none.

11. **P2 — Accessibility needs a semantic alternative, not only ARIA on nodes.** Regions, convergence, edge direction/type, and spatial grouping are the feature’s content. A list of node labels exposes none of them. Tone may also become the only grouping carrier, contrary to the project’s colour rule. Store an accessible textual graph description and explicit group membership/relationship roles; do not attempt to infer them from coordinates.

12. **P2 — The experiment evidence is not reproducible from the workspace.** No Sketch result JSON/PNG/README is present. Moreover, the harness saves the cleaned scene, not the raw response; `--render` then revalidates already-cleaned data and cannot recover the original faults ([renderOnly](/Users/greg/Dropbox/dev/experim/spideryarn2/evals/sketch/run.ts:129)). Preserve raw response, report, prompt version, and rendered output together.

The model registrations are functionally correct: capable tier, Messages wire, ID-bearing article, and exclusion from `ChatJob`. The comments now repeatedly say “seven” pipeline tasks although there are eight, and the claim that Sketch shares no prefix “with anything” is false: Ideas and Sketch both use `high` plus `ids`, so the cache predicate groups them ([models](/Users/greg/Dropbox/dev/experim/spideryarn2/src/models.ts:482), [ai-call](/Users/greg/Dropbox/dev/experim/spideryarn2/src/ai-call.ts:190)).

## Central design claim

The JSON trade is right, but the justification is overstated.

Because `path` is an arbitrary SVG path, the vocabulary can visually fake almost any ordinary 2D argument diagram. What it cannot express directly is rotated or path-following text—for example, a radial dialectic whose labels follow the orbit. More importantly, it cannot represent a Toulmin-style rebuttal that attacks an inference rather than a node: edges may target nodes only. A free path can imitate that picture, but its attachment is no longer checkable.

That lost freedom does not justify raw SVG. Extend the semantic grammar only when an offline raw-SVG comparison demonstrates a useful missing form.

## Direct answers

- **Should it ship as a fifth diagram?** No. Ship it, eventually, as an “Argument Sketch” or “Article Map” launched from Diagram. At 288px, 12-unit text scales to roughly 4.5px; the band is only a thumbnail, and the lightbox separates the map from the prose it navigates.
- **Cut one thing:** the two pre-generated zoom scenes. They are not the central hypothesis and create most of the latency, URL, interaction, and accessibility complexity.
- **Highest-value change:** add one hard `buildSketch` acceptance boundary before writing. It must reject empty/duplicate/malformed scenes, invisible or truncated nodes, bad paths and geometry, insufficient overview linkage, and unacceptable per-scene scores; then stamp source/profile provenance. A failed build must leave no “ready” artefact.

Verification: the latest focused Sketch suites passed, 47/47. The root typecheck currently has four unrelated unused-variable errors in `src/collect-assets.ts`; web and test TypeScript projects passed. No files were changed.

