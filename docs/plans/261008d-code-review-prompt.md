Code review (you may FIX what you find, inside this stage only) of commit HEAD in this worktree:
"261008d: Skim and More join Structure and Summary, Comments joins Marginalia".

Plan (with your own plan review folded in): docs/plans/261008d-bottom-bar-groups-skim-and-more-join-structure-and-summary-comments-joins-marginalia.md
Your plan review: docs/plans/261008d-plan-review-sol.md
Scoped diff: docs/plans/261008d-code-review.diff (images and the generated help corpus left out).

Look hard at:
- src/web/Dock.tsx: cutForMore, drawnCount/moreCount, DockModes and DockModeLinks frames and counts, the Comments node (commentsControl) now drawn inside .dock-modes, DockMore without its frame, data-mode on radios/toggle/mode links, the Metadata TooltipGroup removal.
- src/web/styles/dock-fit.css rung-2 rule scoped to [data-mode]. Does any other CSS (dock.css, narrow-window.css, dock-fit.css) treat `.dock > .dock-btn` or `.dock-modes .dock-btn` in a way that now misstyles Comments (e.g. its chip, its ChevronUp, the `.on` top marker vs fill, the coarse-pointer floor)? Does the phone hide-on-scroll guard or the drawer Escape/focus-return logic depend on Comments' position?
- fitSignature: does it still change on everything that changes the row's width?
- Tests: are the retargeted selectors right; any sweep left that counts Comments or More as a mode; any assertion weakened rather than updated.
- Stale comments/docs that still describe More after Learn / in its own frame, or Comments as a loose button.

Browser evidence (Playwright): desktop 1440 frames are [Plain] [Structure Summary (Diagram) Skim More | ... | Search Chat Learn] [Marginalia Comments]; no overflow at 1440 with or without the drawer; on a 390 phone the bar still scrolls (scrollWidth 1018) and More is at x 354-398.

Gates to run after any fix: `npm run typecheck`; `npx vitest run tests/dock-*.test.* tests/a-second-press-closes-the-mode.test.tsx tests/arrows-belong-to-the-article.test.tsx tests/command-bar.test.tsx tests/a-broken-mode-leaves-the-article-readable.test.tsx tests/the-dock-*.test.* tests/a-failed-comment-write-is-said-on-the-dock.test.tsx`.
Do not commit. Write your answer as: verdict line, then numbered findings CR-1.. with severity and whether you fixed it (name the files you changed).
