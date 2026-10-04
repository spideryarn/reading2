Reviewed `c9900a0e2` against `1698c6448`.

- **F4 — P2, established, fixed:** The historical report trusted `check.levels.simple` after the reader’s guard stopped validating it. Malformed records could distort counts or crash the report. Fixed in [simple-check-report.ts](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/scripts/simple-check-report.ts:97), reusing the validator exported from `src/types.ts`. Added `tests/simple-check-report.test.ts`: five cases failed before the first fix; the missing-check case failed before the follow-up fix. All eight now pass. Reader compatibility remains unchanged. Root cause recorded under `docs/postmortems/261004i-…`.

- **F5 — P2, established, fixed:** The migrated old-link test lost its distinct middle-level fixture, weakening “never renders Simple” coverage. Restored that fixture and owner/visitor assertions in [simple-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/tests/simple-panel.test.tsx:933). A temporary mutation that rendered the historical middle level failed both cases; removing it restored green.

- **F6 — P2, reasoned, fixed:** Identical prompts do not establish unchanged latency or attribute slow runs to Fuller. Corrected the main plan and `docs/project/summaries.md` using recomputed raw results. Mean cost falls **15.75%**, from **$0.256434 to $0.216033**. Median wait changes **30.904 → 31.314 s**, but mean wait rises **33.667 → 35.796 s** and maximum **41.240 → 51.084 s**. Separating `nosimple2` is appropriate because its cache state differs; its **87.232 s Fuller retry** remains explicitly acknowledged. This is a prose correction verified against the result files.

- **F7 — P3, established, fixed:** Corrected stale descriptions in `docs/project/prompt-caching.md`, `docs/project/summaries.md`, `evals/simple/probe.ts`, `src/types.ts`, `src/web/SimplePanel.tsx`, and `src/pipeline.ts`: the retired paid spike, historical middle-check readers, call counts, and the omitted `unchecked` outcome.

The four claims hold for ordinary guarded writes without retries. Directly loaded base and HEAD prompts are byte-identical: **Brief 9,146 bytes; Fuller 8,914 bytes**. Versions remain unchanged. Existing rewrite triggers are unchanged. Valid historical rows remain usable; public projection selects two levels, while export preserves stored JSON whole. F1–F3 are addressed.

Retiring the spike’s paid arms is appropriate: converting them would change the historical experiment. I verified that `report` succeeds and a retired arm refuses.

Final verification: **283 tests passed**, including the requested five files and added checks. Typechecking passed through `node --import tsx scripts/typecheck.ts`; the requested npm command encountered sandbox IPC restrictions. Lint passed with existing warnings. Database export tests and the full suite were not rerun.

No commit made; protected `*-sol.md` files untouched.

**Verdict: approve.**