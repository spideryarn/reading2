1. **P2 — save failure was hidden during recovery** — [Dock.tsx](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/src/web/Dock.tsx:1437).  
   `error && !loaded && !stale` became ordinary `waiting`, so the Dock said only “Loading…” and drew no warning. Fixed with a distinct `save-failed-waiting` appearance: centred unknown knob, no `aria-pressed`, inert, visibly marked, and described as “Not saved. Loading this setting again…”. Added coverage at [dock-experimental-switch.test.tsx](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/tests/dock-experimental-switch.test.tsx:365). The 32-state `hasValue`/Dock equivalence still holds.

2. **P3 — documentation overstated what was recorded** — [browser-testing-playwright.md](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/project/browser-testing-playwright.md:259).  
   The postmortem said the browser guide required reading a changed setting back, but the guide only required a named locator. Added the read-back rule. Also corrected the plan’s test count and its now-obsolete plain-`waiting` description in [the plan](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/plans/261030a-experimental-checkbox-unknown-is-not-off.md:39) and [postmortem](/var/tmp/spideryarn-worktrees/qiydgn7smk-experimental-checkbox/docs/postmortems/261030a-a-check-that-found-a-control-by-its-kind-read-a-different-one.md:83).

No other scoped defects found:

- Settings is mixed exactly when `hasValue` is false, always disabled then, and its separate “Try again” button remains reachable.
- High-powered AI is mixed and disabled exactly while `since === undefined`.
- The new tests were genuinely red against the old code: no indeterminate refs, no description link, the reload-failure box remained enabled, and Dock exposed the pre-load save failure as a known toggle.
- The transcript and source confirm the first closed-profile checkbox was Feedback’s hidden consent box; Settings was unmounted.

Checks:

- Requested Vitest suite: **5 files, 101 tests passed**.
- Typecheck logic: **passed all five projects; all 4,112 source files covered** via `node --import tsx scripts/typecheck.ts`.
- Exact `npm run typecheck`: sandbox blocked tsx’s `/tmp/tsx-1000/14.pipe` with `EPERM`.
- `npm test`: could not collect because the shared Postgres service was unavailable and sandbox networking returned `EPERM`.
- Scoped lint: only the pre-existing `Dock` complexity advisory at line 1962.
- `git diff --check`: passed.
- No commit made.

**Verdict: approve after fixes.**