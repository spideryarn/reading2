The guard resolves the earlier P1 sufficiently to ship. It blocks an old historical year from dating unrelated yearless events. A recent date can still supply the wrong year elsewhere, but the panel header, open row and margin explicitly label that assumption. Given the narrower rule, this remaining uncertainty is acceptable.

The code is correct: `dayFrame` validates the first ten characters of an ISO timestamp without timezone conversion; missing or invalid fetch dates produce `NaN`, so both comparisons fail; `fetchedYear - 1` correctly accepts the preceding year. `generateTimeline` passes the real metadata’s fetch time, and a usable publication date takes precedence.

All **165 targeted tests pass**, and typechecking passes via `node --import tsx scripts/typecheck.ts`. No files edited.

VERDICT: ship

- **P0:** None.
- **P1:** None remaining.
- **P2 — misleading plan wording:** [Plan line 107](/home/greg/code/spideryarn2/.claude/worktrees/fb-fyjac4-timeline-which-year/docs/plans/261005d-timeline-dates-without-a-publication-date.md:107) describes “a piece we fetched this year or last.” The code compares the stated year with the **recorded fetch year**, regardless of today’s year. Suggested wording: “a piece whose sole stated year matches its fetch year or the preceding year.” The changed sections of `docs/project/timeline.md` otherwise match the implementation.