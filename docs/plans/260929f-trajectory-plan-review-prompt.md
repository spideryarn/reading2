# GPT Sol plan review — 260929f, Trajectory snippets in place, a sparkline, a where-card

Read-only review. Read the plan, docs/plans/260929f-trajectory-snippets-in-place-sparkline-and-where-card.md,
and the code it changes: src/web/TrajectoryPanel.tsx (the head `RouteHead`, the row, `StopCardView`),
src/web/stop-card.ts, src/web/modes/trajectory/TrajectoryMode.tsx, src/web/reader/Reader.tsx
(`canOpenFromStopCard`, `openFromStopCard`), src/web/Spine.tsx (`BandCard` and the band tooltips),
src/web/Tooltip.tsx, src/web/section-path.ts, src/types.ts (`Tree`, `FaqQuestion`, `Idea`), and
docs/project/trajectory.md, docs/project/icons.md, docs/project/narrow-windows.md.

**The conclusion I would least like to be wrong about:** that putting the where-card into the spine's
band card (replacing only its crumb line) is safe — the spine's tooltips have a history of breaking
quietly (docs/postmortems/260828g-spine-hover-cards.md) — and that one pure `whereRows(tree, index,
blockId)` can serve both the spine (which knows a band's node, not a block) and Trajectory (which
knows a block). Say whether the spine should take a node rather than a block, or be left for later.

Also check:

1. The FAQ question moved above the quote on the current row, expanding to its *other* answer
   passages: is that a faithful reading of Greg's words, and what breaks (touch, keyboard, the list's
   follow-scroll, the row being a button already — nested interactive elements)?
2. The sparkline replacing "Stop k of N": accessibility (the live region), touch (a tooltip on a
   non-interactive SVG), and the one-row head at the band's narrowest (about 280px).
3. Ideas as chips with the statement in place: is `Idea.statement` the right text, and is "one open
   snippet across the card" simple to hold in state?
4. Anything in the plan that a simpler version would answer as well.

Numbered findings (F1…), each with severity (P0/P1/P2), file and line, and the change you recommend.
End with a verdict: approve, approve with changes, or rethink.
