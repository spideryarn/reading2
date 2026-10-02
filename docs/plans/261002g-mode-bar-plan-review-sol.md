P0: none.

P1 findings

1. Skipping arming removes two existing recovery paths that the plan does not account for.

The plan says a current-mode press can stop arming because every band has its own Generate/Regenerate control ([plan:54](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md:54>)). That is not true in all error states:

- A failed artefact read deliberately retains its activation, and another press causes a reread ([useAutoRun.ts:141](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/useAutoRun.ts:141>)).
- The regression test explicitly records that Ideas, Quotes and Timeline have no retry control in this state; pressing the active mode is the only direct retry ([modes-that-start-themselves.test.tsx:1011](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/modes-that-start-themselves.test.tsx:1011>)).
- A fresh active-mode activation also resets a broken `FeatureBoundary` ([FeatureBoundary.tsx:41](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/FeatureBoundary.tsx:41>)), with dedicated Ideas and Debate coverage ([a-broken-mode-leaves-the-article-readable.test.tsx:841](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/a-broken-mode-leaves-the-article-readable.test.tsx:841>)).

With the proposed behavior in the worktree, the focused suite had 6 failures: the current-mode generation case, failed-read retry, and four boundary-reset cases.

The render-error fallback already has an explicit “Try … again” button, so retiring Dock-as-retry there is defensible. Ordinary read errors do not. The plan should either add an explicit retry to every such error state or knowingly define recovery as “close, then reopen,” and update the load-bearing comments and tests.

2. Command-bar selection should not inherit the Dock’s toggle behavior.

The command bar promises “type a word, press Enter, be in that mode” and was requested to open the appropriate mode ([CommandBar.tsx:1](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/CommandBar.tsx:1>), [reading-view-overview.md:216](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/project/reading-view-overview.md:216>)). Under the plan, choosing the current mode instead closes it ([plan:61](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md:61>)).

That also makes the same command context-dependent:

- On Reading, “Summary” while in Summary closes Summary.
- On Metadata, the same row navigates into Summary because `onMode` is absent ([Dock.tsx:1533](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/Dock.tsx:1533>)).

The Dock button is a toggle gesture; a named command is an idempotent destination. Do not defer this distinction. Pass the source/intent through `onMode`, or provide separate Dock-toggle and command-open callbacks.

3. The behavior is no longer honestly represented as a radio group.

The plan says Enter/Space toggle the current button while radio semantics remain unchanged ([plan:68](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md:68>), [plan:74](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md:74>)). But these buttons are exposed as `role="radio"` with `aria-checked` ([Dock.tsx:2747](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/Dock.tsx:2747>)). Activating an already-checked radio conventionally leaves it checked; here Space on checked Summary silently checks Plain instead while keyboard focus remains on the now-unchecked Summary.

The nested `.dock-frame` divs themselves are fine: radios may be descendants, not necessarily direct DOM children, of the radiogroup. The problem is toggle behavior under radio semantics. Either keep radio behavior non-toggle, or remodel Plain/bands as a labelled group of toggle buttons using `aria-pressed`.

P2 findings

1. Coarse-pointer growth is not actually proportional to the visible button count.

The outer mode cluster still has a hard-coded weight of eight ([narrow-window.css:789](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/styles/narrow-window.css:789>)), while `visibleModes` varies with the experimental switch, current experimental mode and Marginalia state ([Dock.tsx:1066](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/src/web/Dock.tsx:1066>)). Even the ordinary switch-off list currently has ten modes ([dock-mode-order.test.ts:67](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/dock-mode-order.test.ts:67>)).

Weighting the three inner frames by their counts distributes spare width correctly inside the cluster, but cannot correct the cluster’s stale top-level eight-to-one ratio against loose Dock buttons. Give `.dock-modes` a visible-count CSS variable too.

2. The planned activation assertion is insufficient evidence for “no paid run.”

The plan proposes checking `pendingActivation` ([plan:104](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/docs/plans/261002g-plain-closes-both-columns-a-second-press-closes-a-mode-and-plain-and-marginalia-in-frames-of-their-own.md:104>)). The existing integration-test guidance explicitly says a pending-token comparison cannot prove whether a job was posted, because a token may already have been consumed and some paths post without leaving one ([every-mode-draws-its-surface.test.tsx:1016](</home/greg/code/spideryarn2/.claude/worktrees/fb96-mode-click-toggles-off/tests/every-mode-draws-its-surface.test.tsx:1016>)).

Assert both that `armActivationForMode` was not called and that no job POST occurred. Also test Dock and command-bar behavior separately once their semantics diverge.

Verdict

Revise before building. The core state handling is otherwise sound:

- A stepped-aside band should come back rather than close.
- Sub-mode rows correctly bypass whole-mode toggle-off.
- Visitors can toggle without arming.
- Metadata links remain navigation rather than toggles.
- ModeHerald’s close behavior is sensible.
- Skim arrival is unaffected because `armSkimOpening` only acts when entering Skim from another mode.
- The three nested frames are structurally valid, and the measured fit ladder will account for their added borders and gaps.

The blockers are the unacknowledged retry regressions, command-bar semantics, and the radio/toggle accessibility mismatch.