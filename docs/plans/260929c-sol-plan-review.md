Verdict: revise before building. The grouping approach is sound, but the reading-time hover target currently creates a real click regression, and the plan misses deterministic test/doc updates.

One note: the worktree changed during this review as another process added an uncommitted draft implementation. I made no edits; line references below use that draft where it exposed concrete consequences.

## High severity

1. The reading-time hover strip steals part of every gutter control’s click target.

The proposed/current strip is 8px wide, positioned `right: -3px`, with `pointer-events: auto` ([gutter.css:927](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/gutter.css:927)). That places 5px inside the 24px control column and 3px into the reserved gap toward the prose. Every control deliberately owns the full gutter width ([gutter.css:342](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/gutter.css:342)), while the span is rendered last ([BlockGutter.tsx:852](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/BlockGutter.tsx:852)) and paints over them.

What goes wrong: clicking the rightmost 5px of Bookmark, Permalink, Chat, Help, or More can hit an inert span instead. With 15px glyphs, the strip begins at x=19 in a 24px slot while centred ink reaches roughly x=19.5, so it can overlap the edge of the icon itself.

It should not overlap the prose: the layout reserves `--blk-gutter-x` between gutter and text ([shell.css:60](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/shell.css:60), [shell.css:81](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/shell.css:81)). Nor will it be clipped; `.blk-gutter` has no clipping rule.

Simplest safe geometry: place the hover target wholly in that reserved gap, for example `left: 100%; width: var(--blk-gutter-x)`, and draw the 2px line back at `left: -2px`. Then explicitly browser-test clicks at the right edge of each icon.

2. The plan misses three deterministic existing-test changes.

- Diagram’s old invariant still requires it in the switch-off bar at [diagram-kind-gating.test.tsx:217](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/diagram-kind-gating.test.tsx:217). `experimental: true` makes that fail.
- The gutter test still requires 12px ink at [block-gutter.test.tsx:410](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/block-gutter.test.tsx:410).
- Its exact direct-child assertion excludes `blk-read` at [block-gutter.test.tsx:422](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/block-gutter.test.tsx:422). Do not merely append `blk-read` to the “tab order” expectation—it is not a control. Filter it out and separately assert that it is last.

The checks section also incorrectly says `public-network-trace` holds the order ([plan:169](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md:169)). That test intentionally sorts both lists and explicitly disclaims order ([public-network-trace.test.tsx:1507](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/public-network-trace.test.tsx:1507)). A dedicated literal-order test is right; the concurrent draft’s [dock-mode-order.test.ts:23](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/dock-mode-order.test.ts:23) has the correct shape.

## Medium severity

3. The mini switch needs a visual-state model separate from `broken`.

An `aria-hidden` decorative switch inside the existing button is accessible in principle: the button retains its name, description and conditional `aria-pressed`. Constant 22px width also poses no special fit-ladder problem.

The problem is state truthfulness. The current draft puts the knob right only for `setting.on && !broken` ([Dock.tsx:3277](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:3277), [Dock.tsx:3383](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:3383)):

- `waiting` and `load-failed` therefore look off even though the code deliberately refuses to report an off value.
- `save-failed` may have reverted to on, but `broken` forces its knob left while `aria-pressed` reports true. The store explicitly restores the real pre-save value ([experimental-store.ts:488](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/experimental-store.ts:488)).
- `stale` has a cached on/off value and is a retry action ([Dock.tsx:1066](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:1066)), but it is not dimmed by `.soon`, contrary to the plan.

Define position independently:

- `ready`, `saving`, `save-failed`: show `setting.on`.
- `stale`: show cached position, visually muted.
- `waiting`, `load-failed`: use an indeterminate appearance rather than left/off.

Add assertions for all six visual classes, especially a save failure where the restored value is on. Fit remains safe: the switch is fixed-width at every rung, and `fitSignature` already carries the switch variant ([Dock.tsx:1107](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:1107)).

4. Moving Diagram leaves several current-policy statements stale.

Beyond the expected flag/list/experimental-features edits, update:

- [reading-view-overview.md:71](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/reading-view-overview.md:71)
- [security-map.md:255](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/security-map.md:255)
- [DiagramPanel.tsx:212](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/DiagramPanel.tsx:212)
- [modes-that-start-themselves.test.tsx:782](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/modes-that-start-themselves.test.tsx:782)
- The remaining “every reader” sentences in [diagram.md:197](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/docs/project/diagram.md:197) and [Dock.tsx:687](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:687).

The old history can remain, but it needs past tense and the 2026-09-29 boundary.

No behavior changes are needed in:

- `MODE_TARGET`: Diagram activation remains correct ([activation.ts:236](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/activation.ts:236)).
- Visitor `POLICY`: it should remain `available`, because hiding is discoverability, not authorization ([visitor.ts:214](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/visitor.ts:214)).
- Command bar: it receives the Dock’s already-filtered mode list, with tests at [command-bar.test.tsx:207](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/tests/command-bar.test.tsx:207).
- Direct `?mode=diagram` access: retaining the current hidden mode is intentional.

5. The FAQ/Search interpretation is plausible, but the “otherwise redundant” argument is too strong.

Moving Timeline and Citations right already moves FAQ and Search left by index, so Greg’s sentence is not logically redundant if they do not cross Glossary and Ideas. Crossing those two is an additional interpretation.

That said, `Trajectory · Quotes · FAQ · Search` is a coherent passages group, so I would keep it—but call it an explicit grouping decision rather than something forced by the wording.

My preferred order is:

```text
Plain | Hierarchy Structure Summary Diagram | Trajectory Quotes FAQ Search |
Glossary Ideas Timeline | Referee Citations Debate | Chat Remember
```

The only difference from the plan is Summary before Diagram. Diagram was not named in the reorder, so this preserves Summary’s existing position while placing Diagram immediately beside it. “The same move Summary makes, with a picture” supports adjacency, not necessarily Diagram-first.

## Low severity / confirmations

6. The reading-time explanation remains mouse-only.

The span is non-focusable and `aria-hidden` ([BlockGutter.tsx:865](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/BlockGutter.tsx:865)); the file already acknowledges native titles are unreliable on keyboard and absent on touch ([BlockGutter.tsx:630](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/BlockGutter.tsx:630)). The plan defers touch but does not mention keyboard or screen readers. Do not add one tab stop per paragraph; a shared legend or one accessible explanation elsewhere is the cleaner follow-up.

The CSS expression itself is valid, provided `--read` resolves to a number: `min()` returns a number and multiplying it by `8px` yields a length under CSS typed arithmetic ([CSS Values and Units Level 4](https://www.w3.org/TR/css-values-4/)). A clearer equivalent is:

```css
width: clamp(0px, calc(var(--read, 0) * 8px), 8px);
```

7. Removing internal hairlines should not break the Dock.

- The selected state remains clear through its filled background ([dock.css:410](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/dock.css:410)).
- `Tooltip` clones its child rather than adding a DOM wrapper ([Tooltip.tsx:272](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Tooltip.tsx:272)), so sibling/direct-child behavior survives.
- `fitSignature` includes visible identities in order ([Dock.tsx:1168](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:1168)). Removing borders actually makes the segment narrower, so the plan’s “no width change” is literally false but harmless.
- The first overall visible mode must not receive `dock-group-start`; otherwise the loose-links arm gains a stray line against preceding non-mode controls. The draft’s `before && …` implementation gets this right ([Dock.tsx:980](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/Dock.tsx:980)).

One visual caveat: the draft uses `--rule-strong` for the segment separator ([dock-fit.css:66](/home/greg/code/spideryarn2/.claude/worktrees/fb4e-mode-bar-toggle-icons/src/web/styles/dock-fit.css:66)), despite the request saying “subtle.” I would start with the former internal-hairline token `--rule` inside the framed segment and reserve `--rule-strong` for loose links if needed.

I attempted the targeted tests, but the repository’s memory-admission guard refused the run before collection. The red assertions above are direct source contradictions rather than inferred test outcomes.