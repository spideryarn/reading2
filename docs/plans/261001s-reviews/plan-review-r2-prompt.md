# Plan review round 2: 261001s

Read-only. Same repo. Candidate: commit 78a6c88e3, file
`docs/plans/261001s-structure-answer-writes-code-to-correct-an-id.md`, revised after your round 1
(`docs/plans/261001s-reviews/plan-review-sol-r1.md`). The plan now drops the parser repair, takes
B (starts-only structure answer, toc/11) and adds a shared one-re-draw helper on MalformedJson for
Structure, Ideas and Sketch.

Attack, in order:
1. Did the revision address F1–F6, or misread any?
2. Stage 1: making the end optional on the answer path of `planChildRanges`/`buildTree` while
   src/hierarchy-deepen.ts and others keep real ends; reuse of `normaliseExpansion`'s rule in
   src/hierarchy-cascade.ts. Is there a cleaner seam (e.g. converting the starts-only answer at the
   boundary)? What breaks (tests, evals, the parity/hoist pins, checkpoint replay of toc/10 answers)?
3. Stage 3: the re-draw helper and its interaction with Structure's checkpoint, cost accounting
   (`collectSpend`, `structureUsage`), abort signals, onProgress, and job-failure kinds. Is
   adopting it in Ideas and Sketch a clean one-line change, or does each need more? Name files.
4. Is the measurement in stages 0–2 enough to say something, and is the stage-1 decision gate
   well defined? Propose a concrete threshold if not.
5. Anything the plan still says that is false.

Same severity scale (P0–P3), IDs on findings (G1…), file:line evidence, and the plan change you
want. One-line verdict at the end. As before, you will be the builder afterwards.
