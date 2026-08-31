## Findings

1. **High — a one-block overlap can delete the article’s largest section and fabricate a four-block gap.**

   Input for parent `[0,5]`:

   ```text
   child 1  [0,0]  "Preamble"
   child 2  [0,4]  "Large middle"
     child 2.1 [0,2]
     child 2.2 [3,4]
   child 3  [5,5]  "Close"
   ```

   The answer has one local fault: children 1 and 2 overlap at block 0. At [src/hierarchy.ts:757](/home/greg/code/spideryarn2/src/hierarchy.ts:757), child 1 is kept because it appears first, child 2 is dropped because its start is equal, and child 3 is kept. The result is:

   ```text
   Preamble [0,4]
   Close    [5,5]
   ```

   The entire “Large middle” subtree disappears. The report says:

   ```json
   {
     "repairs": [{"where":"root > child 3","kind":"gap","at":5,"size":4}],
     "droppedChildren": ["root > child 2"]
   }
   ```

   That four-block gap never existed between adjacent children in the model answer; it is created by skipping child 2’s end during accounting. If child 2 had `sourceHeading`, that provenance disappears too. If it had 100 descendants, the CLI still says “1 dropped section.”

   This is the concrete case where starts-authoritative is materially worse than ends-authoritative. The old cursor rule would move child 2’s start from 0 to 1 and preserve all three sections. On a headingless PDF, the argument that starts are grounded in headings does not apply.

   I would not ship the claim that this is clean and robust until this case is resolved. Ends are useful evidence specifically when starts are equal or non-increasing; always keeping the earliest child is arbitrary.

2. **Medium — different boundaries can still share `at`, so `repairedBlocks` undercounts.**

   Input:

   ```text
   root
     left  [0,2]
       only child [0,1]   // short by block 2
     right [3,5]
       only child [4,5]   // starts one block late
   ```

   The repairs are:

   ```json
   [
     {"where":"root > child 1 > child 1","kind":"short","at":3,"size":1},
     {"where":"root > child 2 > child 1","kind":"gap","at":3,"size":1}
   ]
   ```

   These are independent: one changes block 2’s membership, the other changes block 3’s. But [repairedBlockCount](/home/greg/code/spideryarn2/src/hierarchy.ts:612) deduplicates globally by `at`, returning `1`, not `2`.

   The new fuzz assertion only proves coordinates are distinct within one parent ([tests/hierarchy-repairs.test.ts:709](/home/greg/code/spideryarn2/tests/hierarchy-repairs.test.ts:709)). Adjacent sibling subtrees can share the same boundary coordinate.

   Therefore `at` alone cannot distinguish a cascade from unrelated repairs. The boundary identity needs structural identity as well as its coordinate, or `repairedBlocks` should be computed from the actual changed block memberships.

3. **Medium — clamping changes `size` before it is measured, contradicting its documented semantics.**

   For an inner parent `[0,3]`:

   ```text
   child 1 [0,1]
   child 2 [5,5]
   ```

   The model’s claims about the internal boundary are `2` and `5`, three blocks apart. Child 2’s start is first clamped to `3`, so the report instead contains:

   ```json
   [
     {"kind":"gap","at":3,"size":1},
     {"kind":"over","at":4,"size":2}
   ]
   ```

   The internal gap is reported as one rather than three. Consequently `largestRepair` is `2`, although one model-boundary disagreement is `3`.

   [The reporting loop](/home/greg/code/spideryarn2/src/hierarchy.ts:800) must compare the raw proposed start with the previous raw end if `size` is “the distance between the model’s two claims.” The clamped value is appropriate for constructing the tree, not for measuring the answer or naming faults to a re-ask.

4. **Medium — the noise-floor eval no longer measures the tiling failures; it only measures their normalized outputs.**

   The main runner does record `repaired`, which fixes the earlier review finding for successful rows. But [floor.ts](/home/greg/code/spideryarn2/evals/hierarchy-structure/floor.ts:28) does not read that field, and its scalar measures omit repairs and dropped children. Its remaining tiling instrument is `throwAnatomy`, while tiling faults no longer throw.

   Feed the finding-1 answer through an arm repeatedly:

   - every row is `outcome: "ok"`;
   - `validity.otherProblems` is necessarily zero for the tiling;
   - the floor reports zero throws;
   - repair size and dropped-subtree variance are absent.

   Thus the floor now measures the variability of the normalizer’s output, not how often or how badly the model failed to tile. Add at least repaired ranges, repaired blocks, largest repair, dropped roots, and lost descendant count to the per-document floor. `throwAnatomy` remains useful only for historical result files or unplanned nodes.

5. **Low — an eval row that ultimately throws loses repairs encountered before the fatal node.**

   `ArmFailure` carries calls but not `BuildReport` ([model-arms.ts:151](/home/greg/code/spideryarn2/evals/hierarchy-structure/model-arms.ts:151)); the runner therefore returns only `threw` and `calls` ([run.ts:227](/home/greg/code/spideryarn2/evals/hierarchy-structure/run.ts:227)).

   Breaking input:

   ```text
   root
     child 1 [0,2]
       [0,0], [2,2]      // records a gap repair
     child 2 [3,5]
       [5,4]             // later throws as backwards
   ```

   `buildTree` has already populated the report before it throws, but the eval result drops it. Production’s catch preserves this information; the eval should do the same.

## Other conclusions

I found no structural totality failure for resolvable, forward ranges. The construction has a straightforward proof: it always keeps the first child at `P0`, keeps only strictly increasing clamped starts, computes each end from the next start, and closes at `P1`. A single-block parent keeps one child and drops the rest. No kept plan can remain `{keep:false}`. I also exercised 54,240 shallow combinations and 50,000 nested generated proposals without producing a `checkTree` failure.

I would not restore a size/count refusal threshold. It would be another unsupported number and would again discard the whole article. A dropped child should instead be a degraded outcome and, once re-asking exists, an automatic re-ask trigger. Before that, report both dropped roots and the total descendants/provenance claims lost.

The normalization fallback is directionally a step toward re-asking, not a detour. But findings 1–3 mean its present report is not yet a reliable trigger or repair prompt: it can name a gap the model did not make, understate repair totals, and measure after clamping. Fixing those does not require undoing the fallback.

I found no new article-prose leak. `where`, `kind`, `at`, `size`, and dropped-child paths are structural; malformed endpoints still pass through the withholding helper.

Focused Vitest execution was blocked by the read-only filesystem. Direct adversarial executions succeeded. Typechecking ran and found only existing unrelated errors in two diagram tests plus the untracked `scratch4/rebuild.ts`.