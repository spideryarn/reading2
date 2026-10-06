# A commit label cannot identify a mutable build

Stage 1 review of `8649ab8d804072c478a94649796b971bc8818360` reproduced two fleet-bundle
provenance failures before the planned relaunch. No live runner was changed in this review.
The root-cause investigation was delegated to a read-only subagent. Findings and verification:
[round 3 review](../plans/261006h-readiness-runner-round-3-code-review-sol.md), C3R-01 and C3R-02.

The introducing commit added `PreparationState.fleetBuiltFor` to distinguish a build this process
performed from one found on disk. It stored only a sha. After one successful build, replacing the
entire bundle and its manifest with another clean-stamped bundle at that sha still satisfied both
reuse guards. A hand-run build can consume an untracked input without making the build stamp dirty.

There was also a partial-success path. Vite observes the tree when its config loads; compilation
can consume subsequent source edits. The manifest can pass while the final tree stamp fails.
`latchPreparation` cleared `preparedFor` but retained `fleetBuiltFor`. Restoring a clean target tree
then allowed reuse of the suspect build. Rebuilding an already-prepared sha skipped the final tree
validation altogether.

The class is **provenance detached from a mutable artefact**, with a sibling:
**a partial-success latch surviving failed provenance validation**. A commit identifies source
history, not which bytes currently occupy a mutable output directory. Successful integrity checking
against the manifest currently on disk does not identify the producer of that manifest.

The original tests damaged individual files, changed the sha, and tested final-tree refusal with a
fake build. None substituted a complete, internally consistent build at the same sha or followed a
failed tree check through the real fleet-build seam. The new substitution test failed with
`expected … to have a length of 2 but got 1`; dirty, unknown and wrong-sha final-tree cases also
reused the first build.

The fix retains the accepted manifest with the sha in process memory and compares that exact
manifest during reuse, then checks all its files. Final-tree validation runs every preparation
attempt, including an already-prepared sha, and failure clears both claims and throws, so later
cleanliness in the same tick cannot override an observed failure. This is the intended lasting
repair within the runner's existing observation model. It does not continuously lock source files
against transient edits between observations.

Countermeasures, ranked by cost and value:

1. Test complete replacement under an unchanged cache key and failed validation followed by retry.
   These cheap tests are added, red first, and the new guards were independently mutation-checked.
2. Store the evidence needed to distinguish artefact identity alongside a successful build claim;
   clear all dependent claims when a required provenance check fails. Implemented in this stage.
3. An immutable source snapshot and atomic publication of a separate output directory would
   strengthen concurrent-build guarantees. Rejected for this patch: it needs a broader lifecycle
   design and does not replace the missing identity and failure-path assertions.

Up: [postmortems](../project/postmortems.md).
