## Findings

- **F1 — P1: list-follow will fail while the narrow-window band is hidden.** Movement calls `onAway()` immediately (`src/web/modes/trajectory/TrajectoryMode.tsx:423-446`), and narrow mode uses `display: none` (`src/web/styles/narrow-window.css:368-380`). A layout effect then sees zero geometry; reopening the unchanged stop will not rerun it. Pass the away/visible state into the panel and trigger measurement after the band returns, with a test covering: hidden band → door/arrow step → **All stops** → current row visible.

- **F2 — P1: the named eval cannot compare `/7` with `/8`.** It hard-codes the old `/6` API and asserts exactly `/6` versus `/7` (`scripts/eval/trajectory-coverage-eval.ts:79-95`). Generalise it to load two same-shaped `/7` and `/8` modules, or—closer to the prompting guide—run and preserve before/after arms separately. Otherwise Stage 2’s stated measurement cannot run.

- **F3 — P2: the qualitative and coverage gates need a defined unit.** “Coverage must not fall” ignores the run-to-run noise the old-old control exists to measure (`docs/project/prompting-guide.md:114-132`), while an “added stops” judge cannot detect repetition unless it also sees that arm’s preceding pass. Emit blinded fixtures containing the preceding pass plus each newly added quote/cue; score each addition as useful/repeat, aggregate by article/depth, balance the randomised key, and allow coverage variation within the old-old range rather than requiring every cell never to fall.

- **F4 — P2: the house tooltip is keyboard-capable, but touch is not automatic.** `Tooltip` supplies hover, focus and dismissal only (`src/web/Tooltip.tsx:184-220`); controlled mode merely disables synthetic touch-hover (`src/web/Tooltip.tsx:108-126`). Put the info button last in `.traj-head`, after the depth control, and explicitly control it from a tested touch press while retaining focus/Escape/outside dismissal. `ControlTip` is only the content shape, not the touch gesture.

- **F5 — P2: Stage 1 omits the canonical-doc update.** `trajectory.md` still specifies two end doors and says deepest offers **Go round again** (`docs/project/trajectory.md:130-134`), plus several earlier references. Add that doc and the existing door/control tests to Stage 1’s scope. In code, `again()` is used only through `TrajectoryControl` → `Reader` → `TrajectoryDoor` (`src/web/reader/Reader.tsx:1191-1200`); deepest can retain an `end` view solely to render its end line.

The Stage 2 instruction itself is sound: nesting is structural—one ordered list, with depth *d* showing every stop whose depth is `≤ d` (`src/web/trajectory-route.ts:7-9,27-32`). The added wording also preserves the standalone-cue rule. The spend is modest: 12 route calls plus a small judging pass.

For 54, `.tl-scroll` is definitively the scrolling element (`src/web/styles/timeline.css:30-36`); `ModeSurface` adds no body wrapper (`src/web/ModeSurface.tsx:173-202`). Updating only its `scrollTop` cannot move the page. Use exact top/bottom rectangle deltas against the current row’s button, not `scrollIntoView`.

**Verdict: approve with changes.**

Worktree note: despite the brief, `src/trajectory.ts` and `tests/trajectory.test.ts` became modified during review; I treated them as in-flight work and changed nothing.