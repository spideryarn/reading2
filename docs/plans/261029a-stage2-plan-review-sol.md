## Findings

1. **Blocker — heading hierarchy is underspecified and conflicts with the hard-boundary rule.**  
   [src/structure.ts:115](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:115), [src/structure.ts:270](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:270)

   “Deeper than the heading the section starts with” treats raw `<hN>` levels as trustworthy and appears to require every deeper heading to become a depth-3 node. That is incompatible with the depth cap when, for example, an `h4` subsection contains `h5` headings. It also conflicts with the unqualified rule that every heading is a hard node boundary.

   The target paper demonstrates why tags alone cannot decide this: its semantic `2.4.5(a)`, `(b)`, and `(c)` headings are extracted as `h2`, while `2.4` is `h3` and its ordinary subsections are `h4`. “Same level as neighbouring sections” does not tell the model whether numbering/context or the literal tag wins.

   I would replace the relevant wording with:

   > Article headings are hard boundaries at the levels represented by this tree. Infer the author’s hierarchy from surrounding headings and numbering as well as `<hN>` tags. A heading at the neighbouring sections’ level starts a sibling section. The author’s next level down starts a sub-section. Still-deeper headings remain inside that sub-section because this tree stops at depth 3.

   That explicitly makes `2.5` a sibling of `2.4`, makes `2.4.1–2.4.6` its children, and prevents `2.4.5(a–c)` from demanding a fourth level.

2. **Should-fix — the existing long-run rule makes invented depth 3 much less rare than the plan intends.**  
   [src/structure.ts:117](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:117), [src/structure.ts:274](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:274)

   The base prompt orders the model to create boundaries in every run longer than about nine blocks. The new rule permits depth 3 when a section is longer than about ten blocks and its topic shifts. Those are nearly the same condition; “most sections have none” then fights a concrete earlier instruction.

   State the scope directly:

   > The ~9-block rule helps choose chapters and sections; it does not by itself justify sub-sections. Apart from the author’s own sub-headings, add sub-sections only when a section of at least 10 blocks contains several unmistakably separate topics. Length alone is not enough.

   The 5–9 exception and gist/question rules otherwise fit: depth 3 already receives the 22–32-word gist band, and the schema gives it no question.

3. **Blocker — the measurements do not detect the primary hierarchy error.**  
   [src/structure-depth.ts:53](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure-depth.ts:53), [evals/structure-fourth-level/score.ts:48](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/evals/structure-fourth-level/score.ts:48), [tests/structure-fourth-level-eval.test.ts:66](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/tests/structure-fourth-level-eval.test.ts:66)

   `swallowedHeadings` considers any heading that starts the deepest containing node preserved. Therefore an `h3` section incorrectly demoted to a depth-3 subsection scores as successful; the test explicitly blesses that case. Conversely, comparing raw heading levels produces false positives for the target paper’s malformed `h2` nested headings.

   The scorer has three related blind spots:

   - `headedSections` requires two deeper headings, missing opening prose plus one author subsection.
   - Any subdivision makes `undividedHeadedSections` pass, even if it is unrelated to the author’s headings.
   - `singleSubsection` is effectively unreachable after `collapseRestatedRungs` removes a sole whole-range child.

   Annotate expected section and subsection starts for this small corpus, at minimum for the target paper. Score separately:

   - expected section starts present at depth 2;
   - expected subsection starts present at depth 3;
   - expected headings put at the wrong depth;
   - invented starts;
   - annotated headings left inside prose.

   Keep raw `swallowedHeadings` only as a diagnostic, not a shipping measure. If lone proposals matter, measure the parsed proposal before collapse.

4. **Blocker — the ship rule has no quality gate and its performance comparison is not reproducible enough.**  
   [docs/plans/261029a-structure-one-level-deeper.md:334](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/docs/plans/261029a-structure-one-level-deeper.md:334)

   A prompt that never emits depth 3 could pass the stated cost/time rule. Add quality requirements before performance:

   - On the report paper, `2.4.1–2.4.6` are depth 3 under `2.4`; `2.5` remains a depth-2 sibling; `2.4.5(a–c)` are not promoted because of their misleading tags.
   - No regression in annotated author-boundary recall.
   - Zero invented subdivisions below the ten-block floor.
   - No increase in failed answers, re-asks, dropped nodes, or collapsed rungs.
   - Manual inspection of every invented subdivision.

   Then define the cost rule exactly, for example: compute each article’s mean over its two runs, compare paired before/after values, and require corpus-median cost and latency growth each to be at most 20%. Report heading-rich and no-subheading articles separately, plus the book and latency tail; an overall median can hide a large regression on precisely the documents that use the new level.

5. **Blocker for the planned production rerun — rerunning Structure plus Labels can silently truncate Arc.**  
   [src/pipeline.ts:3898](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/pipeline.ts:3898), [src/pipeline.ts:4511](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/pipeline.ts:4511)

   A Structure rerun may change ranges. A job containing only Structure and Labels does not enqueue Arc; the old Arc artifact still appears complete, and the reading view silently drops entries whose ranges no longer match.

   Do not perform the proposed targeted rerun as Structure plus Labels. Include Arc and any other explicitly range-keyed descendants, or first add reliable consumer invalidation. This is an existing rerun hazard rather than a new depth-3 traversal bug, but this plan would trigger it.

6. **Should-fix — keep the opening-prose decision, but forbid it from borrowing the parent’s heading provenance.**  
   [src/start-ranges.ts:173](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/start-ranges.ts:173), [src/structure.ts:1942](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:1942), [src/web/tree.ts:431](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/web/tree.ts:431)

   The simpler decision is right. The starts-only representation pins the first child to the parent start, so a bare paragraph alongside subsection nodes is not expressible. Folding opening prose into the first authored subsection would misattribute it.

   The reading view will draw an opening subsection normally; it does not require a heading at its start ([src/web/structure.ts:687](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/web/structure.ts:687)). Do not add mixed bare-paragraph code.

   However, because the opening subsection’s range contains the parent heading, `backedHeading` will accept that heading anywhere in its range. The UI can then mark a duplicated parent title as author-written. Add:

   > An opening-prose sub-section is your own division: give it a new title for that prose and omit `sourceHeading`. Do not repeat the parent section’s heading.

7. **Should-fix — the schema permits an explicitly empty `children` array although it can express non-emptiness.**  
   [src/structure.ts:329](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure.ts:329), [docs/project/prompting-guide.md:200](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/docs/project/prompting-guide.md:200), [src/messages-structured-output.ts:189](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/messages-structured-output.ts:189)

   The provider cannot express the semantic minimum of two, but it supports `minItems: 1`. Use `nonEmptyArrayOf(depth3Schema)`. Absence then means “not divided”; presence guarantees at least one proposed child, while the prompt and collapse repair continue to handle the minimum-two rule.

I found no further depth-3 traversal failure: Labels selects the lowest internal sibling sets by shape ([src/labels.ts:796](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/labels.ts:796)); invariants accept arbitrary parent-plus-one depth ([src/tree-invariants.ts:168](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/tree-invariants.ts:168)); slice seams intentionally concern promoted top-level sections only ([src/structure-slices.ts:271](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/structure-slices.ts:271)); and library counts intentionally stop at depth 2 ([src/library-scalars.ts:117](/var/tmp/spideryarn-worktrees/fbpn7gvw-structure-stage2-fourth-level/src/library-scalars.ts:117)). Diagram, Summary, Arc, and Marginalia deliberately retain their present shallower views; Skim and export traverse or serialize the full tree.

The new measurement tests themselves pass. In the broader targeted run, 56 of 57 tests passed; the sole failure was the whole-document request parity fixture still pinning the old prompt. Typechecking could not start in this sandbox because `tsx` was denied its `/tmp` IPC socket, not because of a reported TypeScript error.