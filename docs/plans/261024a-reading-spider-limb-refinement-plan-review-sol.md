LOGO-LIMBS-PLAN-261024

**Verdict: proceed.** This is a sensible small follow-up. Shortening the lower limbs preferentially, preserving pose and identity, and comparing implied strand lengths respects the request. The plan already covers history preservation, derived outputs and geometry rechecks. No established P0/P1; no blocking findings.

Concrete traps, all **P2 prospective risks**, not established defects:

- **F1 — Unchanged upper SVG paths do not guarantee unchanged Semaphore joints.** Established: the [generator](/Users/greg/.codex/worktrees/spideryarn-knot-reader-logo/reading2/scripts/generate-brand-assets.ts:81) crops to visible bounds and recentres the result. Reasoned consequence: shortening the bottom can move upper limbs vertically in the generated PNG even if scale stays constant. Check actual generated pixels against Semaphore’s polygons, pivots and overlap; the plan’s remeasurement fallback is appropriate.

- **F2 — Keep the crossing mask synchronized.** Established: [mark.svg](/Users/greg/.codex/worktrees/spideryarn-knot-reader-logo/reading2/assets/brand/source/mark.svg:8) repeats the foreground crossing strand’s geometry inside its mask. Moving that strand requires updating both. Reasoned consequence: shortening paths independently can leave gaps, erase the wrong section or merge the crossed limbs. Inspect the crossing and book clearance at actual favicon sizes.

- **F3 — Regeneration success is narrower than complete visual verification.** Established: the generator makes the public family and ICO; preview is opt-in, and OG generation is absent from this script. Run generation/check with `--preview` and handle OG separately as planned. Reasoned risk: valid transparent files can still lose a limb visually or drift in pose; side-by-side inspection must establish those properties.

No edits made. This reviews the plan, not an implemented result.