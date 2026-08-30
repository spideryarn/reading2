## Findings

1. **Medium — Trail’s ramp ends with the visible cliff it claims to remove.**  
   The progress rules set opacity from `0.16` to `0.5` at [styles.css:8422](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8422), but the equally specific, later `diag-near-*` rules replace that opacity. In an early-article segment with `diag-d0 diag-near-7`, [styles.css:8496](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/styles.css:8496) produces opacity `0.52`; the adjacent unclassed `diag-d0` segment is `0.16`. With the same 0.5-alpha violet stroke, that is roughly 0.26 versus 0.08 effective alpha—a greater than threefold drop. Source order correctly lets the near rule win, but that exposes the defect.

   This also undermines the 1/6 reach argument: Trail’s outer segments are not back at the chain’s own weight. Store the progress opacity in a custom property and compose the local ramp with it, with level 7 resolving exactly to the progress value. Add a Trail equivalent of the Force boundary test for every `diag-d*` level.

2. **Medium — Trail’s arrow window is shifted one segment forward and can use a different reach from the painted ramp.**  
   [scatter.ts:742](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/scatter.ts:742) measures `Math.abs(i - here)`, although `i` identifies a link from nodes `i` to `i + 1`. With `here = 10` and reach 8, it selects links 7–13. The symmetric inner half around node 10 is links 6–13: one backward link is always missing.

   Measure distance to the nearer endpoint instead:

   ```ts
   const distance = Math.min(Math.abs(i - here), Math.abs(i + 1 - here));
   ```

   The denominator can also disagree. With 28 placed dots and one omitted segment, geometry uses `chainReach(27) === 5`, while the panel uses `chainReach(26) === 4`. That can put a head on a segment outside the panel’s inner half. Determine drawable segments first, then use their count for both geometry and `chainNearness`, or explicitly pass one shared reach.

3. **Low — the endpoint contract permits a partially wrong ramp instead of failing closed.**  
   `from` and `to` are optional at [diagram.ts:289](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram.ts:289), and malformed sequence links are silently removed at [diagram.ts:419](/Users/greg/Dropbox/dev/experim/spideryarn2/src/web/diagram.ts:419). Given valid `n0→n1`, a drawn sequence link missing `to`, then valid `n2→n3`, a reader at `n1` gets only the first component highlighted; the malformed link still draws unclassed. The type allows this partial result.

   Make `DiagramLink` a discriminated union: `sequence` requires both endpoints, while other kinds forbid them. A runtime defensive check should return an empty map if any sequence edge is malformed. Non-sequence edges cannot currently enter the walk because `kind === "sequence"` is checked.

4. **Low — several tests overstate what they prove.**

   - The endpoint test’s claim at [diagram-force-links.test.ts:216](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram-force-links.test.ts:216) is false for the current implementation: adding endpoints to vocabulary edges does not flatten the ramp because `chainNearness` filters by kind. The test enforces producer cleanliness, not walk safety.
   - The short-chain scaling test at [diagram.test.ts:470](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/diagram.test.ts:470) distinguishes scaled distance from raw distance, but does not establish the exact reach rule. A constant reach of 4 would pass the new tests. Add table cases around the thresholds: 20→3, 21→4, 26→4, 27→5, 47→8.
   - “Same eight steps” is not literal. At reach 3, the emitted levels are `0, 3, 5`, followed by unclassed level 8. The arithmetic correctly lands the boundary on the base style; it cannot produce eight distinct graded steps in three hops.
   - The arrow test at [scatter.test.ts:341](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/scatter.test.ts:341) checks only that heads occupy one short window. It does not check that the window is symmetric or uses the same reach as `chainNearness`.

The core breadth-first walk is correct for the production simple-path shape. A one-link chain becomes level 0; an empty chain, off-chain reader, or collapsed root returns empty. Force’s producer builds a unique-node chain, so repeated node occurrences are not a current input. On arbitrary repeated-ID input, the walk would collapse occurrences and use shortest graph distance, brightening both positions; validate-and-return-empty if that shape must be defended against.

The floor of 3 is defensible on three- or four-section articles: there is too little chain for a local ramp to return to baseline, but the available links remain ordered outward. That is a design choice, not a correctness defect.

The Force marker claim is true. SVG paints stroke and markers as components of the graphics element, then applies object opacity to the rendered result, so path `opacity` fades its marker as well; changing the stroke colour alone would not affect the separately styled marker fill. [SVG 2 rendering model](https://www.w3.org/TR/SVG2/render.html#ObjectAndGroupOpacityProperties)

I made no edits. `git diff --check` passed. The targeted Vitest run could not start because the read-only sandbox prevented Vite from writing `node_modules/.vite-temp`, so these findings are from static inspection rather than a fresh green run.

