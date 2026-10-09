Code review of plan docs/plans/261009i-add-page-sharing-clearer.md, in the worktree /var/tmp/spideryarn-worktrees/fbnsrkju-add-page-clearer. You may edit files in this worktree to fix what you find (workspace-write); do not commit, do not push, do not touch any database, do not run a browser. Run the suites you touch.

Read the plan first, including § Review (your own plan review, docs/plans/261009i-add-page-sharing-clearer-plan-review-sol.md, and what was done with each finding). The uncommitted diff is in docs/plans/261009i-add-page-sharing-clearer-code-review.diff (also `git diff`).

What changed: the add page's Sharing section (src/web/AddSharing.tsx, AddShare.tsx, AddShareLink.tsx) — the row text/icon, an intro line with a Help link, private link before public, the public tick box replaced by buttons (AddShare.tsx `press` / `sharedOrAsked`), new and reworded constants in src/messages.ts (SHARE_AT_ADD_*, LINK_AT_ADD_*, SHARING_AT_ADD_*, sharingAtAddSummary, IMPORT_LINK_COPY_TIP, SHARE_AT_ADD_RECALLED); the JobCard copy icon (src/web/AddArticle.tsx); `textHasGone` in src/web/AddPage.tsx (qi-9x3akt5n: a refused paste no longer says "has been sent"); src/web/help/pages/sharing.md and the regenerated src/help-corpus.generated.json; docs; tests.

Check in particular:
1. The button mapping in AddShare.tsx: every ShareAtAddState offers the right press, and each press calls the controller method the tick box called (`open` for tick, `untick` for untick; the confirmation's own Cancel stays `cancel`). No state looks on when nothing is asked for, and no on-or-maybe-on public state lacks a way to take it back.
2. Every reader-facing sentence that changed is true in every state it can be drawn in, and the plan's "Which published sentences change meaning" list is complete and accurate against the diff. Greg's rule: a sentence about what sharing does is a published promise.
3. The tests: do the reworked helpers (`shareBox` in tests/add-page-share.test.tsx and tests/add-page-sharing-section.test.tsx) still test what the old ones did, or did the rewrite make any assertion vacuous (e.g. a helper that returns the container when no press is found, so a click silently does nothing where the old test clicked a live box)? Are the new tests capable of failing?
4. Accessibility: the headings' levels (h2 row, h3 controls), the link inside the description, tooltips on buttons, the icon-only copy button's accessible name.
5. Anything else: consistency with docs/project/controls.md § Controls that do the same job look the same, stale comments that still describe the tick box as drawn, Help wording vs. the UI labels.

Write your findings (ranked P1/P2/P3 with file:line), then what you fixed, then anything wider you did not fix and why, then a one-line verdict.
