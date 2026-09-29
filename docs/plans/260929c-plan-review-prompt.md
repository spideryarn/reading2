# Plan review — 260929c (no notice when a mode was made by an older prompt)

Read-only; do not change any file. The plan is
`docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md` (uncommitted; the only
change in this worktree). Greg's report is quoted in it. Start with the nine `src/web/*Panel.tsx`
it names (grep "older version of the prompt" and `outdated`), `src/web/TrajectoryPanel.tsx`
`outdatedBy`, `src/web/stop-card.ts`, `src/web/useQuotes.ts`, and
`docs/plans/260929b-one-place-to-re-run-ai-processing.md` (the work this builds on).

Attack, briefly: (1) is the stale / profile-changed / outdated split right in each panel — any
panel where one banner or condition mixes them so removing "outdated" also hides a stale or
profile notice, or leaves an empty box? (2) the status-only footers' `!outdated` gates: which
panels, and is dropping them safe? (3) anything else that shows the outdated state to a reader —
Metadata rows, the shelf, the command bar, chips, visitor views (do not propose changes to
access/visitor code; just say if one shows it)? (4) Quotes' hidden *Find more* on an outdated
list: acceptable, or does it now need to show? (5) docs that describe the outdated banner.

Severity P0–P3; IDs from **F1**; file:line; a fix each. Verdict: approve / approve with changes /
rethink. Short.
