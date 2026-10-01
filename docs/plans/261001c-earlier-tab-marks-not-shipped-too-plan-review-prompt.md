You are reviewing a small plan before it is built, read-only. Repo: Spideryarn (TypeScript, React client in src/web/).

Plan: docs/plans/261001c-earlier-tab-marks-not-shipped-too.md
Prior work it builds on: docs/plans/260930e-earlier-tab-filters-by-done-from-the-notes.md
Code: src/web/FeedbackEarlier.tsx (EarlierList), src/web/styles/feedback.css (.fb-earlier-shipped), tests/feedback-dialog.test.tsx (around line 1240-1360).

The request (Greg, admin, 2026-10-01): "In Feedback / Earlier / All, add the indicator for whether each suggestion has shipped or not."

Check: does the plan actually answer the request? Is the reading of "what is missing" right given the current code (a not-shipped row shows nothing)? Is the copy/title honest given what "not shipped" covers (declined, awaiting, headerless notes, on dev not deployed)? Is showing it in every filter the right call? Accessibility (colour-only distinction? the words differ, so maybe fine), contrast of --ink-faint, anything in other tests or snapshots that asserts the meta-line text and would break. Also check the conclusion: is this the simplest right change?

Give findings as P0/P1/P2 with file:line, then a one-line verdict.
