# Plan review: 261001o, show each Simple level once it has passed its check

You are reviewing a plan, read-only. The plan is docs/plans/261001o-summaries-show-each-level-when-checked.md.
Its conclusion is that the work should NOT be built: every way to deliver a level to the browser before
the whole press finishes needs a new transport or a new storage shape, which the brief ruled out.

The brief (from the Overseer, on Greg's condition "that would be nice, but not if it adds too much complexity"):
- show each summary level (Brief/Simple/Fuller) once it has passed the fidelity guard, the reader's level first;
- reuse existing streaming plumbing, no new transport;
- if the plan shows it needs a new transport, a new storage shape, or more than a few hundred lines,
  stop after plan review and report the estimate instead of building.

Please check the CONCLUSION, not only the prose. In particular, try hard to find a route the plan missed
that fits the budget (no new transport, no new storage shape, a few hundred lines at most). Places to look:
- src/simple-summary.ts (generateSimpleSummary, FIRST_LEVEL, writeLevel, the all-or-none abort)
- src/pipeline.ts, the `simple` step (around line 3870), and how a step's `parts` are committed
- src/jobs.ts (StepContext, report(), advanceJob), src/routes.ts (/api/jobs/:id/advance, /api/simple/:slug)
- src/web/jobEngine.ts, src/web/useJobs.ts, src/web/useStepJob.ts, src/web/useSimple.ts,
  src/web/modes/summary/SummaryMode.tsx
- src/stream-run.ts, src/web/lib/sse.ts, src/messages-stream.ts, docs/project/comments.md (streaming)
- docs/plans/261001j-simple-press-cost-and-latency.md (section "Streaming — for Greg")

Also check: are the line estimates plausible; are the four answered questions (failure after a level is
shown, cached artefact and cost metering, reopening, reader's level first) correct; is the claim that a
FIRST_LEVEL change alone is invisible and slightly slower right.

Answer with: a verdict (agree it should stop / disagree, with the route that fits), then numbered findings
with P0/P1/P2 severity, each citing file:line.
