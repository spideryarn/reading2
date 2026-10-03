Found and fixed five issues, with failing tests seen before the fixes:

- **F10 — P1, established, fixed:** handoff advertised stored sources that Claims’ filters could hide. It now clears both filters before opening Claims.
- **F11 — P1, established, fixed:** Reception offered ineffective order buttons after thread narrowing. Orders now depend on visible rows.
- **F12 — P1, reasoned, fixed:** unjudged claim rows lost their relevance disclosure. Restored it on each affected row.
- **F13 — P1, established, fixed:** `?name=`-only links could be overwritten by last-view restoration. Historical links now retain priority.
- **F14 — P2, established, fixed:** the browser-safe Scholar helper was missing from the client import manifest. Registered it with the existing purity guard.

F1–F9 were checked. The title-only Scholar search, visitor withholding sentence and Summary class reuse are acceptable.

The requested 353 tests passed initially. Broader checks exposed F14; its rerun and all added regressions pass. Typechecks and client build pass. Database and live-browser checks were not run.

[Full review and evidence](/home/greg/code/spideryarn2/.claude/worktrees/fbcaue42-debate-claims-and-reception/docs/plans/261003o-debate-reception-and-claims-code-review-sol.md). Changes remain uncommitted.

**VERDICT: land with the fixes I made** — no unresolved blocker was established.