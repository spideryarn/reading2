You are reviewing a finished change, and you may FIX what you find. Work only in this worktree.

The plan, with what landed and how your plan review was folded in:
docs/plans/261007n-usage-limits-tab-codex-24-hour-graph-beside-claude.md
Your plan review: docs/plans/261007n-codex-graph-plan-review-sol.md

The change (uncommitted, run `git diff HEAD` and `git status`):
- tools/fleet/web/src/usage-history-series.ts — the Codex series (`codexInto`, `CodexPlot`), the
  record loop now shared between Claude and Codex lines.
- tools/fleet/web/src/UsageHistory.tsx — `SeriesChart` extracted, drawn for Claude and for Codex;
  `CodexHistory`, `codexLines`.
- tools/fleet/web/src/codex-buckets.ts (new) — `isGeneralCodexBucket`, `codexWindowLabel`, moved from
  AccountUsageSections.tsx and UsagePanel.tsx.
- tests/fleet-usage-history-codex-series.test.ts (new).
- docs/project/usage-history.md § The Codex chart.

Look for: a Codex line that joins across something it should break at; a Claude behaviour changed by
the refactor (especially the collector-failed branch, which no longer `continue`s before the Codex
step, and the `live` set now holding both families); anything that draws a zero for an absence;
the legend/colour order; the renderer at phone width (390px); stale comments.

Rules for fixes: keep them inside these files and the test file; every defect you fix gets a test
that fails without your fix. Run `npx vitest run tests/fleet-usage-history-codex-series.test.ts
tests/fleet-usage-history-series.test.ts` and `npm run typecheck`. Do not commit. Do not invent quotes
from anyone.

Answer: a numbered list of findings (P0/P1/P2), each saying FIXED (with the test) or NOT FIXED (why,
and what you recommend). Be brief.
