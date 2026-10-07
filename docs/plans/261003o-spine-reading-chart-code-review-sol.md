No established P0 or P1. Four findings, all fixed within the allowed files:

- **F4 — P2, established, fixed:** Zero-height runs emitted horizontal strokes and changed neighbouring easing budgets. `readingAreaPaths` now ignores them. Two regression tests failed before the fix. Production already excludes folded rows, so this was a helper-contract risk.
- **F5 — P2, established, fixed:** Reverting both opacities left all 22 original tests green. Added assertions for fill `0.22` and stroke `0.8`; the same mutation now fails.
- **F6 — P3, established, fixed:** Corrected stale “opaque line” and “has to step” wording, plus remaining half-span ambiguity in comments.
- **F7 — P2, established, fixed:** The new coordinate parser failed scoped lint because its `forEach` callback returned `push`’s result. Removed that return.

The remaining geometry checks out for measured, ordered runs: cubic controls bound x within **0…16**, and the y clamps prevent backtracking. Single runs, fractional gaps/overlaps, and a 600-row input were checked. Bounds retain the existing hundredth-pixel rounding; gaps below one document pixel intentionally count as measurement discrepancies. Construction remains linear in run count.

The `useMemo` dependencies are correct. `docHeight` follows `metrics`, making its explicit dependency redundant but appropriate.

**F2 is supported by the supplied images:** the skyline is softer and isolated bumps remain visible. Tapers can still add stroke to tiny bumps, so this supports the chosen appearance rather than proving every mark is quieter. Those images show stroke opacity `0.7`, not the final `0.8`.

The dip explanation is conditional: seeding **unfloored word time** gives reaches **9, 13, 15** for one-, two-, and three-word blocks. Seeding `3.5 × expectedSeconds(words)` gives **16** throughout. The floor alone does not establish which seed produced the dip.

Validation: **25 focused tests pass**, scoped lint passes, and typechecking passes via `node --import tsx scripts/typecheck.ts` after the standard wrapper hit sandbox IPC restrictions. No commits or wider edits.

VERDICT: land after fixes