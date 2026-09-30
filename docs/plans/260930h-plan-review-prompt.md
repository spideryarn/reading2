You are reviewing a plan before it is built, read-only. Repo: Spideryarn (TypeScript, React web client in src/web/). Plan: docs/plans/260930h-trajectory-info-button-on-the-controls-row-and-shortcut-keys-in-tooltips.md — read it in full, and Greg's words in it.

Read the code it touches: src/web/TrajectoryPanel.tsx (RouteHead, TrajectoryDoor), src/web/styles/trajectory.css, src/web/Tooltip.tsx (Tooltip, ControlTip, TooltipGroup), src/web/route-spark.ts, tests/trajectory-panel.test.tsx; and docs/project/tooltips.md, docs/project/keyboard.md (§ ← / → in Trajectory), docs/project/icons.md (§ Navigation), docs/project/touch.md, docs/project/controls.md.

Check, and say where the plan is wrong or will be wrong once built:
1. The layout arithmetic and the two-part CSS fix: will the (i) actually land on the controls row at a 377px head for a 5-stop route, and will it never sit alone on a row for longer routes, one depth, or a phone? Any better, still-simple fix?
2. Wrapping the arrows in Tooltips (with a TooltipGroup) beside the sparkline's and (i)'s controlled Tooltips: any interaction bug (touch tap = step AND card? focus after a step? the stop-1/other label switching while a card is open? the door in the prose)?
3. Are the card texts true to the code (does ← really go to stop 1 on stop 1; does → work from anywhere on the page; any guard that makes "Or press ←" false in some state, e.g. a text box focused)?
4. Is tooltips.md the right single home for the rule, and are the deferrals reasonable?
Also check the conclusion itself, not only the details. Write findings as a numbered list, each with severity (P0/P1/P2), the file:line evidence and the fix. Say plainly if you find nothing.
