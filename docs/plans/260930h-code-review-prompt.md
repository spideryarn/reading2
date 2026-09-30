You are reviewing code that is already built, in the Spideryarn repo (TypeScript, React web client). You may FIX what you find inside this change's scope (the files listed below); report anything wider for me to decide. Do not run git commands that change history or the index; do not commit. Do not reformat whole files (the Biome formatter is off on purpose).

The plan: docs/plans/260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md (read it all, including your own plan-review findings in docs/plans/260930h-plan-review-sol.md and how they were answered, and the browser evidence at the end).

The change is the single commit 1c8939b9 — see it with `git show 1c8939b9`. Files: src/web/TrajectoryPanel.tsx (RouteHead, the new StepTip, TrajectoryDoor), src/web/styles/trajectory.css (.traj-head, .traj-head-end, .traj-depth), tests/trajectory-panel.test.tsx (the new describe "the step controls name their keys", and one changed assertion near "last in the head"), docs/project/tooltips.md (new § A shortcut is named on its card), keyboard.md, icons.md, trajectory.md.

Check especially:
1. Are the card sentences TRUE against the code (src/web/trajectory-route.ts, src/web/keynav.ts, src/web/reader/Reader.tsx, the Trajectory mode wiring under src/web/modes/trajectory/)? Is "Or press → (not while typing in a box)" true for the prose door's Next stop too? Any state where ← / → are not wired while the buttons are shown (e.g. a visitor on a public article, the band stepped aside, the dock drawer open)?
2. Tooltip mechanics: Tooltip requires a ReactElement child whose props it merges; the arrows had `disabled` and a changing aria-label; the TooltipGroup wraps only the stepper, alongside the controlled sparkline Tooltip. Any bug (stale card, focus lost after a step, a card that won't close, the door's card inside the prose affecting layout or comment anchors)?
3. CSS: `.traj-head-end { flex: 1 0 auto }` with the (i)'s `margin-left: auto` — any case where the (i) ends up alone, or where one-depth routes (no .traj-depths) look wrong?
4. Tests: would each new test go red if its feature were removed? Is anything asserted weaker than it looks?
5. Docs: is anything in the new tooltips.md section false or stale (e.g. the claim about the Metadata card's wording — check src/web/Dock.tsx; the claim there is "no keys prop")?
Also check the conclusion, not only the details.

Write your findings to the answer file as a numbered list, each with severity (P0/P1/P2), file:line evidence, and what you fixed (with the diff summary) or what you recommend. Say plainly if you find nothing. After fixing, run `npx vitest run tests/trajectory-panel.test.tsx tests/doc-links.test.ts` and `npm run typecheck` and report the results.
