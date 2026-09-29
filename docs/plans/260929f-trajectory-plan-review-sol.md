F1 — P1 — The spine must not be resolved through a block.  
[Plan:112](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:112), [Spine.tsx:1228](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/Spine.tsx:1228), [section-path.ts:33](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/section-path.ts:33)

`whereRows(tree, index, blockId)` cannot faithfully describe a spine band. Converting the band to `node.range[0]` can descend into whichever child contains the section’s first block, rather than ending at the hovered node. It also confuses the hovered target with the reader’s actual location: only Spine’s existing `here` calculation can truthfully set `aria-current="location"`.

Change: make the projection node-based, with either a discriminated target or a small block adapter:

```ts
whereRows(tree, { kind: "node", nodeId })
whereRows(tree, { kind: "block", blockId, index })
```

Trajectory may resolve its block to the deepest meaningful section; Spine must pass `b.entry.node.id`. My recommendation is to leave the spine integration for later in this plan; when it returns, it should take a node, not a block.

F2 — P1 — The proposed spine card is not a one-line replacement in practice.  
[Plan:116](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:116), [Plan:132](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:132), [tooltip.css:23](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/styles/tooltip.css:23), [Spine.tsx:1421](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/Spine.tsx:1421)

Eight top-level rows plus up to roughly six rows at every level can turn the current crumb into 15–25 lines before the existing title, gist, children, footer and touch hint. Spine tooltips have no height cap, cannot scroll, and deliberately take no pointer events. On a short screen this can put the section name or “Tap again to go here” off-screen.

Change: defer the spine use, or design a spine-specific bounded projection—at most an ancestor chain plus a few immediate peers—and test the resulting card at a short viewport. Keep the existing `TooltipGroup`, identity-guarded `onOpenChange`, hover handover and reveal-then-commit code untouched. The old hover-card failure is not reintroduced merely by changing `BandCard` content, but the proposed content is not yet safe.

F3 — P1 — The FAQ placement currently claims a stronger association than the data proves.  
[Plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:84), [stop-card.ts:186](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/stop-card.ts:186), [types.ts:4092](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/types.ts:4092)

The card associates FAQ and Trajectory only by `blockId`. The FAQ’s exact quoted passage may be different words in the same paragraph from the Trajectory quote. Therefore “this passage is one of its answers”, placing the question directly over the Trajectory quote, and expanding to the “other” passages can all be false. Multiple FAQ questions can also touch one block.

Change: say “This paragraph contains a passage the FAQ pairs with this question,” and state that the pairing is the model’s reading. Carry the exact `FaqPassage[]` into `CardQuestion` and show all of those checked passages on expansion. Only omit a “current” passage if the implementation first establishes an exact FAQ-passage match; block equality is insufficient.

F4 — P1 — Moving an expandable question onto the row requires a row decomposition that the plan does not name.  
[Plan:84](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:84), [TrajectoryPanel.tsx:476](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:476), [TrajectoryPanel test:667](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/tests/trajectory-panel.test.tsx:667)

The entire current row is already a button. The FAQ disclosure and its navigation icon cannot go inside `.traj-go`; that would create nested controls and make expansion also invoke `onRow`. Existing tests explicitly protect the stop card from that.

Change: introduce a stateful current-row component keyed by `quoteId`. Render the FAQ disclosure and navigation control as siblings of `.traj-go`. Hold one discriminated state such as `{ kind: "term" | "idea" | "faq"; id } | null` there, so one-open-across-the-card remains simple. If expansion is inserted above the quote, pass the open key or a reflow token to `useFollow`; its present dependencies at [TrajectoryPanel.tsx:359](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:359) do not rerun when local disclosure state changes.

F5 — P1 — The two proposed Trajectory where-card triggers are currently inaccessible and conflict with the row’s existing tooltip.  
[Plan:115](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:115), [TrajectoryPanel.tsx:484](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:484), [TrajectoryPanel.tsx:513](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/TrajectoryPanel.tsx:513)

The position mark and section path are non-focusable descendants of the row button, which is already wrapped in the full-quote tooltip. Wrapping those spans in more `Tooltip`s gives keyboard users no trigger, touch users no durable card, and pointer users competing nested tooltips.

Change: choose one where-card trigger in v1, not both. Make the position mark a separate sibling button with an accessible name and controlled tap-open state, outside `.traj-go`. Alternatively defer the where-card and rely temporarily on the already-visible section path plus sparkline.

F6 — P1 — A tooltip on a non-interactive SVG does not work on touch or keyboard.  
[Plan:100](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:100), [Tooltip.tsx:69](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/Tooltip.tsx:69), [Tooltip.tsx:111](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/Tooltip.tsx:111)

The `sr-only aria-live` count preserves announcements when the stop changes, but it does not make the sparkline tooltip reachable. An SVG is not focusable by default, and an uncontrolled hover tooltip does not survive a tap.

Change: place the SVG inside a real button, mark the SVG `aria-hidden`, give the button an accessible label containing “Stop k of N” and the current article position, and use controlled open state like the existing About button. Keep a separate `role="status"`/`aria-live="polite"` node, preferably `aria-atomic="true"`, for step changes.

F7 — P2 — The head cannot be one row at the 288px band minimum, and missing stop positions are unspecified.  
[Plan:97](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:97), [layout.ts:226](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/layout.ts:226), [trajectory.css:15](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/styles/trajectory.css:15)

The narrowest standard band has about 267px of content. Two 44px arrows plus the 36px About button consume 124px before the sparkline, depth buttons or gaps. Three labelled depth buttons and a usable chart cannot occupy the remaining 143px. Wrapping is therefore mandatory, not merely an edge case.

Also, `TrajectoryRow.position` is nullable for missing/stale quotes, while the plan requires one positioned dot per stop.

Change: specify and test a two-row layout at `MODE_MIN`, with all three depths and two-digit counts; do not promise a one-row head there. Define null positions as gaps in the path with “position unavailable” in accessible text—do not place them at an invented height.

F8 — P1 — Adding FAQ to `CardTarget` will silently make `canOpenFromStopCard` treat it as Timeline.  
[stop-card.ts:82](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/stop-card.ts:82), [Reader.tsx:823](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/src/web/reader/Reader.tsx:823)

The current ternary maps term → Glossary, idea → Ideas, and everything else → Timeline. Adding `{ kind: "faq" }` typechecks there and inherits Timeline’s experimental-switch availability.

Change: replace the ternary with an exhaustive `modeForCardTarget` switch or total mapping, and use it from both `canOpenFromStopCard` and `openFromStopCard`. Add a test that FAQ remains openable while Timeline is hidden. Since FAQ has no `?faq=` selection, keep the simple behavior explicit: its icon opens the FAQ list at the top, not the corresponding question.

F9 — P2 — The proposed `icons.md § Rules` edit requires approval before editing.  
[Plan:144](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md:144), [icons.md:88](/home/greg/code/spideryarn2/.claude/worktrees/fb59-trajectory-snippets-and-situating/docs/project/icons.md:88)

The plan notices that `design-css-overview.md` is a rule doc, but the new wording is itself going into a section literally named “Rules”. Under the repository agreement, that edit also needs the before/after approval set.

Change: add that approval gate to the plan before the `icons.md` edit.

`Idea.statement` is the right expansion text: its type describes it as the idea itself and the Ideas panel already presents it first. The one-open rule is also straightforward once the state is a discriminated value owned by the keyed current-row component.

Verdict: **approve with changes**. Build the snippets and accessible sparkline after the P1 corrections; make the where-card Trajectory-only if a clean sibling trigger is chosen, and defer the spine integration until it has a node-targeted, strictly bounded design.