Stage-local fixes are applied. One established wider P1 remains unfixed.

- **F15 — P1, established: preview not bounded.** Long wire-supported headings, status reasons, paths and option labels escaped the caps; combined content had no height limit. Six regressions failed first. **Fixed:** cap each text field, bound the complete height, and put a measured overflow notice outside the clipped body.

- **F16 — P2, established: missing capture caveat.** `question.options` contains what the pane showed, potentially only part of a scrolling menu. **Fixed after a failing test:** restore the warning that more options may exist below.

- **F17 — P2, established: contract tests had gaps.** All nine original tests passed with a swallowed fetch, and with a cached old row under a live heading. **Fixed:** new guards failed on both mutations. Both mutations are removed.

- **F18 — P2, reasoned: title-node replacement remains a risk.** Changing preview eligibility remounts the button. An additive `Tooltip.enabled` would remove this local replacement; **recommended, unapplied** under the unchanged-Tooltip constraint. Selection focus, one-pane restoration, `aria-current` and preview tab order survive the tested paths.

- **F19 — P1, established, wider: desktop closing loses focus.** At 1280px: open alpha, focus beta’s title, then navigate to `#sessions`. Focus becomes `<body>`. The probe also failed on `38ed43920`: the whole list changes ancestry. **Left unfixed as requested.** Restore focused-row identity independently of saved scroll pixels, or preserve the list subtree. `Tooltip.enabled` alone cannot fix it.

- **F20 — P3, established: inaccurate prose.** “Whole description” contradicted truncation; full-width cards still clamp descriptions. **Corrected** the paragraph and associated comments.

No current stale-row or cross-session text defect was found. Wire text remains escaped, noninteractive text. The accessible name remains the heading; the current preview is linked through `aria-describedby`, which Escape removes. Real-browser touch and geometry remain for the separate browser check.

Validation: preview **18/18**, history **31/31**, doc links **17/17**; typecheck passed via `node --import tsx scripts/typecheck.ts` after npm’s entry point hit the sandbox socket restriction. Lint reported two existing informational findings. Original tests and `Tooltip.tsx` are unchanged. No commit or network access.

Files changed:

- [SessionPreview.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/SessionPreview.tsx)
- [SessionsPanel.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tools/fleet/web/src/SessionsPanel.tsx)
- [fleet-session-preview.test.tsx](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/tests/fleet-session-preview.test.tsx)
- [overseer-direction.md](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/project/overseer-direction.md)
- [Bounds postmortem](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/postmortems/261006q-character-caps-do-not-bound-the-delivered-surface.md)
- [Focus postmortem](/var/tmp/spideryarn-worktrees/fleet-borrow-reading-machinery/docs/postmortems/261006r-logical-list-continuity-does-not-preserve-dom-focus.md)

do not ship