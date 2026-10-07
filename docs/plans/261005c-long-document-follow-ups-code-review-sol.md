- **H1 — P0, established, fixed:** A second credential attempt could overwrite the first attempt’s report before preservation. The regression went red with `ENOENT` for `.earlier-attempt.txt`. The wrapper now saves the report before retrying; the test passes. Changed: `scripts/run-codex.ts`, `tests/run-codex.test.ts`.

- **H2 — P0, established, fixed:** `--activity-log` could collide with either new sidecar, destroying the transcript, last message, or earlier report. Four regression cases went red with `expected 0 to be 1`. Both wrappers now check all destinations for filesystem aliases before running. Changed: `scripts/subagent-cli.ts`, both wrapper scripts, both wrapper test files.

- **H3 — P1, established, fixed:** A tree containing only labelled block leaves produced an empty sticky breadcrumb bar. The reader regression went red with `<nav><ol /></nav>` instead of no bar. Reader and `crumbPath` now share section eligibility. I also qualified the documentation to preserve the intended window-section breadcrumbs. Changed: `src/web/crumbs.ts`, `src/web/reader/Reader.tsx`, `tests/headings-crumbs-wiring.test.tsx`, `docs/project/experimental-features.md`.

- **H4 — P2, established, reported beyond scope:** Ragged trees still expose individual paragraphs as unnamed navigation sections. A temporary diagnostic produced `["", "", "", ""]` instead of `["Afterword"]`. This matches the plan’s existing wider finding. No changes retained.

G1–G5 and G8 are closed after these fixes. The model-family early return retains the correct last-attempt snapshot. Failed launched runs retain their report while recording failure. The two-page read leaves cleanup intact, and newly eligible long uploads still take the per-owner allowance before paid search. The reusable docs and authoritative write-ups (a)–(d) match the code.

Validation:

- The requested command reported **181 passed, 77 failed**; wrapper execution encountered sandbox IPC, spawn, and tmux restrictions.
- Follow-up checks passed **86 core/reader tests and 26 focused wrapper tests**. `tests/helpers/wrapper-env.ts` provides socket-free launching and file-backed capture for those wrapper checks.
- Every fix was mutated, produced the intended red result, and restored.
- Direct typecheck passed; lint completed with warnings. No network, database, or browser verification claimed.

All changes remain uncommitted.

**Verdict: ship with the fixes made.**