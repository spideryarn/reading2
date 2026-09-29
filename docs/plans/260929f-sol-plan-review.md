## Findings

1. **High — current in-progress code gives Search the wrong group.** Search is in the correct position but still has `group: "contents"` at [Dock.tsx:858](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:858), rather than `"ask"`. That splits `contents` and puts the separator before Chat instead of Search. The updated expectations at [dock-mode-order.test.ts:29](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/tests/dock-mode-order.test.ts:29) catch it: I ran the file and 3/5 tests failed.

2. **Medium — renaming is worthwhile, but the proposed names are weaker than the rationale claims.** `contents` risks calling model interpretations literal contents: FAQ’s questions are generated, Ideas includes unstated assumptions, and Trajectory is a generated, profile-shaped route ([mode-catalog.ts:306](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/mode-catalog.ts:306), [mode-catalog.ts:440](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/mode-catalog.ts:440), [mode-catalog.ts:464](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/mode-catalog.ts:464)). `ask` is also strained: Search finds, while Remember asks the reader to state what they took away. I would use something like `guides` and `input`; the latter matches the repository’s established “waits on the reader’s own words” category at [new-mode.md:122](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/docs/project/new-mode.md:122).

3. **Low — one source comment still describes the removed dimensions run.** The Quotes comment says it sits ahead of the “one dimension pulled out” group at [Dock.tsx:714](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/src/web/Dock.tsx:714). The plan’s general comment-update check should explicitly catch this.

4. **Low — make the browser expectation state-dependent.** Five switch-on runs produce four separators; the switch-off bar has four surviving runs and therefore three separators. “Desktop and phone widths: … four lines” at [the plan:61](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/docs/plans/260929f-mode-bar-regroup-glossary-ideas-timeline-with-trajectory-search-with-chat.md:61) should say which switch state is being checked.

## Answers

1. **The placement is right.** “Separator-section with Trajectory” supports joining that run, not necessarily immediate adjacency. Putting Glossary/Ideas/Timeline at its end preserves their order and causes the least movement. No alternative is clearly better supported. `Search · Chat · Remember` is particularly strong because it also preserves Greg’s earlier instruction that Chat sit immediately before Recall.

2. **Rename the groups, but reconsider the names.** Leaving `dimensions` empty and putting Search in `talk` would be misleading. I recommend `guides`/`input` over `contents`/`ask`.

3. **No other live order assertion needs changing.** The exact order and runs are uniquely pinned by [dock-mode-order.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/tests/dock-mode-order.test.ts). Experimental-mode tests compare sorted membership, and fit tests derive their counts. The old order in [260929c](/home/greg/code/spideryarn2/.claude/worktrees/fb57-mode-bar-regroup/docs/plans/260929c-mode-bar-order-and-groups-experimental-switch-gutter-icons-diagram-behind-the-switch-reading-time-line-explained.md) and the earlier feedback report is historical and should remain unchanged. No other code/test/doc depends on the literal group keys.

4. **The switch-off bar is correct:**  
   `Plain | Structure Summary | Trajectory Quotes Glossary Ideas | Search Chat`.  
   FAQ, Timeline, Diagram, Referee, Citations, Debate, and Remember are experimental; the remaining nine are not.