# A quiet catch erases errors from later stages

The C5 follow-up to [plan 261007l](../plans/261007l-hidden-text-opus-check-code-review-sol.md)
made non-JSON browser SSE frames throw `MalformedReply`. Reviewing every consumer found that
link summaries still swallowed it. No live reader incident was established.

## The class: an optional fallback suppresses diagnostics from a later stage

Commit `eb6fdbd28dfa1669a4c09dfde050bdb5b86b120b` introduced the catch in
[`loadSummary`](../../src/web/link-facts.ts), with the assumption that `apiFetch` already logged
failures. Frame parsing happens after that promise resolves. A quiet card is intentional; an
unreported malformed reply is not.

The regression in [link-summary-forget.test.tsx](../../tests/link-summary-forget.test.tsx) failed
with **zero reporting calls** while the partial text was correctly cleared. Existing fallback
tests checked the card and never the reporting seam.

## Fix and countermeasures, ranked

1. **Report `MalformedReply` through `describeFetchFailure` and retain the empty-card fallback.**
   Applied, with a regression checking exactly one report, partial-text removal and stream release.
   This is also the long-term behavior: optional presentation need not mean optional diagnostics.
2. **Inspect every consuming catch when a shared parser gains a throw.** Include consumers that
   deliberately hide failures from the UI; checking the parser alone misses this class.
3. **Add an error row to every link card** — rejected. Reporting the fault closes the diagnostic
   gap without changing the optional summary's product behavior.

Up: [Postmortems](../project/postmortems.md).
