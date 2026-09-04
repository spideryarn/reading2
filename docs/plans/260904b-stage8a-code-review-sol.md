## Findings

1. **Medium — `repairedBlocks` and `repairedRanges` can count one boundary twice.**

   `recordBoundaryFaults` records the raw boundary at its original coordinate ([src/hierarchy.ts:1184](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1184)); the snap records the same logical boundary at its new coordinate ([src/hierarchy.ts:1281](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1281)). `repairedBlockCount` groups first by coordinate, so it cannot recognise those as one repair ([src/hierarchy.ts:934](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:934)).

   The new “gap and snap separately” fixture already demonstrates it ([hierarchy-repairs.test.ts:1430](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/tests/hierarchy-repairs.test.ts:1430)):

   - child 1 ends at index 0;
   - child 2 claims start 4;
   - indices 1–3 are the three-block gap;
   - the heading snap changes the derived boundary from 4 to 3.

   Only blocks 1–3 required resolution. Block 3 is first counted in the three-block gap, then counted again by the one-block heading snap. `repairedBlockCount` returns 4, not 3. Likewise, `built.repairs.length` reports two “misaligned boundaries” even though this is one interior boundary ([src/hierarchy.ts:2384](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:2384)).

   The reverse is also possible: the coordinate-plus-`where` cascade heuristic at [src/hierarchy.ts:950](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:950) can fold an outer heading snap and an independent, oppositely directed first-child fault at the same coordinate.

   Keep the current ordering, but calculate the metric from the union of affected half-open intervals per logical boundary. A stable boundary identity plus `from`/`to` coordinates would make both ordinary repairs and cascades unambiguous.

2. **Low — matching one heading does not justify taking the whole heading run.**

   The `sourceHeading` gate is right, but the target is broader than its evidence. The code matches any heading in `[first, start)` and then transfers all of them ([src/hierarchy.ts:1268](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1268), [src/hierarchy.ts:1278](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/src/hierarchy.ts:1278)).

   Consider consecutive `Part One` / `A Sub Heading` headings where the previous sibling claims `sourceHeading: "Part One"` and the current child claims `"A Sub Heading"`. The current code snaps to `Part One`, invalidating the previous sibling’s previously backed provenance and potentially leaving its title/gist attached only to the preamble. The run fixture does not exercise that conflict because its previous child has no `sourceHeading` ([hierarchy-repairs.test.ts:1249](/home/greg/code/spideryarn2/.claude/worktrees/long-pdf-no-retry/tests/hierarchy-repairs.test.ts:1249)).

   The safest discriminator is to snap to the nearest heading that actually matches the current child’s claim. If moving to the beginning of the run is important, stop before any heading claimed by the preceding sibling; using tag levels as proof would be weak given the stated extraction problem.

## Answers to the five questions

1. The `sourceHeading` gate is necessary and appropriately conservative. Do not replace it with title matching or adjacency alone. The seven unrepaired starts lack sufficient evidence. However, the gate supports moving the matched heading, not necessarily every preceding heading in its run.

2. The numerical floor is correct. Before snapping, starts are strictly increasing and inside `[p0,p1]`. For `k ≥ 1`:

   `first ≥ previous.start + 1 > p0` and the guard requires `first < start ≤ p1`.

   Moving the current start backwards cannot cross its following start. Consequently, no non-increasing sequence, out-of-parent start, or empty child range can result.

3. Measuring raw faults before snapping is the correct order. Moving it afterwards would indeed invent overlap telemetry. The defect is in aggregating the two records afterward: raw gaps and snaps can overlap, while same-coordinate nested repairs are not necessarily one cascade.

4. The rise is directionally honest—self-consistent one-block-late boundaries genuinely add one repaired heading each—but the exact `86` is not trustworthy under the current aggregation. Any snap overlapping an existing gap inflates it. The Kuhn repairs need an interval-overlap audit or replay after correcting the metric.

5. The tiling remains structurally sound: no block is lost or duplicated, and the snap itself adds only heading blocks, not preceding prose. The run-wide transfer can nevertheless invalidate the previous sibling’s authored-heading claim and thereby leave its title/gist attached to a materially different structural section.

`PROMPT_VERSION = "toc/4"` is correct for checkpoint invalidation. The focused suite passes all 47 tests, and the repository typecheck passes when run without the sandbox-blocked `tsx` IPC wrapper. No files were changed.