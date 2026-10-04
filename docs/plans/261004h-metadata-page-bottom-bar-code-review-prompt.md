Code review, with fixes, of the uncommitted change in this worktree. It implements docs/plans/261004h-metadata-page-bottom-bar-draws-the-same-frames-as-the-reading-view.md (read it first, including your own plan review recorded at its end). The diff as it stood when this prompt was written is docs/plans/261004h-metadata-page-bottom-bar-code-review.diff; `git diff HEAD` is the live one.

What changed: `DockModeLinks` in src/web/Dock.tsx (the bottom bar's modes on the Metadata page, owner and visitor) now draws `.dock-modes` holding the same non-empty `.dock-frame` boxes as `DockModes`, with links inside. The loose-link class `dock-mode` and its three selectors in src/web/styles/dock-fit.css are gone. Tests: tests/dock-fit.test.ts (two rewritten, one new "both arms" test, one stylesheet test inverted), tests/dock-mode-tooltips.test.tsx and tests/dock-experimental-modes.test.tsx (selector only). Comments in dock-fit.css, narrow-window.css, docs/project/mode.md and web-client.md.

Please check, with file:line evidence:
1. Correctness of the new markup against every CSS rule that reaches it: dock-fit.css, dock.css, narrow-window.css (coarse pointer flex shares: the reading view nests two frames inside `.dock-modes-radios`, the links arm does not; is the spare-width split the same or visibly different on a tablet?), dock-quick-search.css, and any `.dock > .dock-btn` or `.dock-btn.on`/`aria-current` rule that used to reach a loose link as a direct child of `.dock` and no longer does, or the reverse.
2. The fit ladder: src/web/dock-fit.ts and `fitSignature` - does anything measure or assume direct-child mode links? Does the Metadata bar still step rungs correctly?
3. Anything else that keyed on `dock-mode` (src, tests, docs outside docs/plans) that the sweep missed.
4. The tests: can each new or changed assertion fail? Is there a mutation of DockModeLinks that all of them survive (e.g. dropping a frame, a different order, an `.on` link, a lost `keepLabel`, a lost tooltip, a visitor's marked modes)?
5. Accessibility of links in unlabelled div frames; focus ring on an anchor inside `overflow: hidden`.
6. Whether any comment or doc I edited now says something false, or attributes words to Greg that are not in the report quoted in the plan. Do not add any quotation attributed to Greg.

Fix what you find inside this scope (the files above), keeping the code's existing comment style; report anything wider rather than changing it. Do not move or remove any button in the bar, do not touch DockQuickSearch, and do not commit. Run individual test files with `node --import tsx` or vitest as the sandbox allows; say which you could not run.

End with: findings as P0/P1/P2, what you changed (files), what you left for me, and a one-line verdict (SHIP / SHIP AFTER FIXES APPLIED / DO NOT SHIP).
