You are reviewing a small change in this repo (Spideryarn), and you may fix what you find inside its
scope (sandbox workspace-write). Do not commit; do not touch git state.

The request (Greg, product owner, 2026-10-21): "I think we generate the brief and fuller summaries by
default because they're main modes. That's great. I don't think we need to generate the thread
submode by default. I think we should generate that if someone presses on it, not until then."

Plan: docs/plans/261022b-summary-thread-writes-only-when-pressed.md (including § Plan review, where
your earlier plan review's two High findings were declined, with reasons — do not re-raise them
unless you find something new). See the working-tree diff (`git diff`) for the change: `tweets`
off AUTO_MODE_STEPS (src/auto-mode-steps.ts) and DELEGATED_MODE_STEPS (src/web/auto-modes.ts),
tests that pin the list updated, docs and a Help page updated, help corpus regenerated.

Check: correctness; any eager producer of the `tweets` step still left; any test or doc still
claiming the thread is queued on import or for a gift; comments that are now stale (search for
"Summary is here twice", "two steps", "thread" near "main modes" etc.). Fix what is clearly wrong.
Then report: findings (severity, file:line), what you changed, and a final line
VERDICT: approve / approve-with-changes / reject.
