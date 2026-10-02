You are reviewing built code in the repo at the current directory, and you may FIX what you find (workspace-write). Fix inside the scope of this change only; report anything wider instead of fixing it. Do not commit; do not touch git state.

The plan, including your own plan review and what was done about each finding: docs/plans/261002e-interactive-tooltip-prop-and-help-link-in-band-about-cards.md
The diff under review: docs/plans/261002e-interactive-tooltip-prop-code-review.diff (commit 982025104 against its parent).
Files: src/web/Tooltip.tsx (the `interactive` prop, `changeOpen`, `FocusReach`), src/web/BandAbout.tsx, src/web/ModeSurface.tsx, src/web/styles/mode-band.css, tests/tooltip-interactive.test.tsx, tests/band-about.test.tsx. Floating UI is @floating-ui/react 0.27.20 in node_modules.

Check especially:
1. `changeOpen` — is the focus logic right for every OpenChangeReason Floating UI can emit here (hover, safe-polygon, focus, focus-out, escape-key, outside-press, click, reference-press)? Can it make the card stick open (e.g. focus inside the card, then the pointer leaves, then focus leaves by a click elsewhere)? Does refocusing the trigger on Escape re-open the card through useFocus?
2. The `placed` ref written during render — stale-element risk?
3. The default (non-interactive) path is byte-for-byte the same behaviour as before: class, role, aria-describedby merge, handleClose null, no focus guards. The spine must be untouched.
4. BandAbout's controlled toggle + interactive: mouse click on (i) while hover-open; touch tap then tap on the link.
5. The tests: can each go red for the reason its name gives? Run them: npx vitest run tests/tooltip-interactive.test.tsx tests/band-about.test.tsx
6. Run npm run typecheck after any fix.

Reply with numbered findings (P0-P3), evidence (file:line), and for each either "FIXED: what you changed" or "NOT FIXED: why / what you recommend". End with a one-line verdict.
