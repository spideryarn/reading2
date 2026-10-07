You are reviewing a short plan before it is built. Read-only.

Plan: docs/plans/261007n-usage-limits-tab-codex-24-hour-graph-beside-claude.md

Code it touches: tools/fleet/web/src/usage-history-series.ts, tools/fleet/web/src/UsageHistory.tsx,
tools/fleet/web/src/usage-history-client.ts (types), tools/fleet/web/src/AccountUsageSections.tsx
(isGeneralBucket), tools/fleet/web/src/UsagePanel.tsx (codexWindowLabel, duplicate-window rule),
tools/fleet/usage-history-record.ts (CodexObservation), tools/fleet/usage-history-wiring.ts,
tests/fleet-usage-history-series.test.ts, docs/project/usage-history.md ("What the chart may not claim").

Questions:
1. Is each of the eight series rules right? Any wrong, missing, or that contradicts an existing rule
   in usage-history.md / usage-history-series.ts?
2. Rule 8 (x = record source instant, not codex readAt): agree or not, and why.
3. Is there a simpler design that keeps the honesty rules?
4. Anything in the renderer plan that will look wrong at phone width?

Answer as a numbered list of findings, each with severity (P0/P1/P2) and a concrete fix. Be brief.
