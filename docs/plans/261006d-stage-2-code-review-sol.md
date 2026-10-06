Fixed within stage 2. No commit made.

- **F24 — P1, fixed:** The authoritative timeout definition overstated what the metric proves. Deadlines can cover a call, turn or processing step. Corrected shared copy, tooltip and docs. Wording guard: red → green.
- **F25 — P1, fixed:** Page, terminal and HTML gates suppressed breakdowns for unnumbered stops despite known evidence. They now use the shared visibility rule. Isolated-stop regressions: red → green.
- **F26 — P1, fixed:** `nothingMeasured` hid known counts of unclassified stops in task tables. Those rows now remain visible. Fold and rendering regressions: red → green.
- **F27 — P1, fixed:** The terminal called mixed days quiet despite unclassified stops, and omitted unnumbered ordinary-stop days entirely. Both now remain listed. Regressions and restored-defect mutations: red → green.
- **F28 — P2, fixed:** A mutation admitting successful rows into the causes table survived the original tests. Added coverage rejects it; the correct filter passes. No production filter change was needed.

Final verification: **7 files, 283 tests passed**; typecheck passed through Node’s `tsx` import hook; touched-file lint clean. All six follow-up mutations were rejected. No double counting found.

Full `npm test` stopped at database setup because sandbox access to local Postgres was denied. Browser checks were not performed.

Root cause recorded in the [postmortem](/var/tmp/spideryarn-worktrees/qi-pwhxm2t2-count-stalls/docs/postmortems/261006d-visibility-borrows-another-measure-s-coverage.md).

VERDICT: ship it