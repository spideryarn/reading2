# An invisible target needs space at every layout boundary

Caught in review of `f868ce9d9`, 2026-10-07. Findings and validation:
[F5a review](../plans/261007h-f5a-code-review-sol.md). The root cause was independently checked
by a read-only subagent; Chrome could not launch inside the review sandbox.

The new target preserved each control's drawn size, but its caller did not always reserve the
extra space. Quotes separated the info button from its own passage id while overlooking the
previous and next rows. A global 1.3rem passage-id target fitted ordinary prose lines but not
chip-only wrapped flex lines in Glossary, Tweets, spoken pointers, Simple or Quiz evidence.
At the supported 12px root, section headings also kept a physical 40px target while their new
bottom margin shrank to 12px.

The class is **spacing checked inside one row, but not across layout boundaries**. Source guards
confirmed the target and the Quotes column, so they agreed with the implementation's incomplete
model of the layout. The candidate introduced all three touch collisions; existing dense rows
had no enlarged target before it.

The fix reserves target overhang at container edges, adds room between wrapped id rows and
contains both Quotes controls inside each row. Section headings use a physical margin floor.
These are coarse-pointer rules; the drawn controls keep their sizes. The shared target still
requires caller-specific clearance: a generic pseudo-element cannot infer its neighbours' boxes.

Countermeasures, ranked by ease against value:

1. **Check boundary inequalities at both supported root sizes.** Added source guards, seen red
   before the fixes; removal mutations also make them fail. Cheap, deterministic, and sufficient
   for the specific spacing contracts, though they cannot establish rendered hit ownership.
2. **Measure hits across wrap and row boundaries in Chrome.** More valuable than checking only a
   control's centre; the review sandbox blocked it. Exercise shortest rows, chip-only wrapping,
   the first scrolled row, and both roots when browser access is available.
3. **A general target-layout engine was rejected.** It would add runtime measurement and layout
   complexity to a few static caller rules. Enlarging every id to 40px was also rejected: dense
   references need bounded targets, as the plan's R15 already requires.
